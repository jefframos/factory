// FaceTowerBlockController.ts

import Pool from 'core/Pool';
import { CollisionLayer } from 'core/phyisics/core/CollisionLayer';
import type { BasePhysicsEntity } from 'core/phyisics/entities/BaseEntity';
import { BoxEntity } from 'core/phyisics/entities/BoxEntity';
import { PolygonEntity } from 'core/phyisics/entities/PolygonEntity';
import Physics from 'core/phyisics/Physics';
import {
    Body,
    Sleeping
} from 'matter-js';
import * as PIXI from 'pixi.js';
import { BlockBodyTextureCache } from './BlockBodyTextureCache';
import type {
    FaceTowerBlock,
    FaceTowerConfig,
    PowerupEffectConfig,
} from './FaceTowerTypes';
import { PieceAnimations } from './PieceAnimations';
import { getPolygonAnchorFraction, getPolygonCentroid, getPolygonHorizontalBounds, resolvePieceImagePath, type PieceDefinition } from './PieceStorage';
import { buildStaticPieceView } from './StaticPieceView2D';
import { getStaticPiece } from './StaticPieceStorage';
import type { TowerCameraController } from './TowerCameraController';

function hexStringToNumber(hex: string): number {
    return parseInt(hex.replace('#', ''), 16);
}

export class FaceTowerBlockController {
    private readonly blocks: FaceTowerBlock[] = [];
    private readonly bases: BoxEntity[] = [];
    private readonly bodyTexture: BlockBodyTextureCache;

    /**
     * The "landing preview" glow — ONE standalone sprite, not a child of any
     * block's own view. Shown/repositioned for whichever piece is currently
     * held (see spawnHeldBlock/moveHeldBlock) and hidden the instant it's
     * dropped or discarded (see releaseHeldBlock/discardHeldBlock) — it
     * previews where the CURRENT held piece will land, not a permanent
     * decoration every piece carries around after it's already fallen.
     */
    private readonly previewStrip: PIXI.Sprite;

    private heldBlock?: FaceTowerBlock;

    private nextBlockId = 1;

    public constructor(
        private readonly root: PIXI.Container,
        private readonly config: FaceTowerConfig,
        private readonly camera: TowerCameraController,
        /** Notified the instant a block's jiggle actually fires (its first physical contact) — the 3D mirror layer has no physics of its own, so this is how it learns to play the matching cube jiggle. See FaceTowerGameEvents.onBlockFirstHit. */
        private readonly onBlockFirstHit?: (block: FaceTowerBlock) => void,
    ) {
        this.bodyTexture = new BlockBodyTextureCache(config);

        this.previewStrip = PIXI.Sprite.from(resolvePieceImagePath('vfx/grad.webp'));
        this.previewStrip.anchor.set(0.5, 0);
        this.previewStrip.visible = false;
        this.root.addChild(this.previewStrip);
    }

    public initialise(): void {
        this.addBase(this.config.floorY);
    }

    public spawnHeldBlock(x: number, piece: PieceDefinition): FaceTowerBlock {
        if (this.heldBlock) {
            throw new Error('Cannot spawn another block while a block is held.');
        }

        const w = this.config.blockWidth * piece.scale.x;
        const h = this.config.blockHeight * piece.scale.y;

        const entity = piece.polygon
            ? this.buildPolygonEntity(piece.polygon, w, h)
            : this.buildBoxEntity(w, h);

        /*
         * The block must not fall while the player is positioning it.
         * Making it static is simpler than manually cancelling gravity.
         */
        entity.isStatic = true;
        Body.setStatic(entity.body, true);

        Body.setPosition(entity.body, {
            x: this.clampBlockX(x, w),
            y: this.camera.toWorldY(this.config.spawnScreenY),
        });

        Body.setAngle(entity.body, 0);

        entity.body.friction = 0.65;
        entity.body.frictionStatic = 0.8;
        entity.body.restitution = 0.05;
        entity.body.frictionAir = 0.025;

        entity.syncView();
        this.styleBlockView(entity, piece, w, h);
        this.updatePreviewStrip(piece, entity.body.position.x, entity.body.position.y, w, h);

        this.root.addChild(entity.view);

        const block: FaceTowerBlock = {
            id: this.nextBlockId++,
            entity,
            checkpointFrozen: false,
            piece,
            shootRemaining: 0,
            jiggleRemaining: 0,
            hasJiggled: false,
            shrinkScale: 1,
        };

        this.blocks.push(block);
        this.heldBlock = block;

        return block;
    }

    /**
     * Tags the currently held block as a powerup's dropped piece — call
     * right after spawnHeldBlock() (see FaceTowerGameController.spawnPowerup).
     * releaseHeldBlock() reads this to make the body a sensor instead of a
     * normal collider once dropped; PowerupSystem reads it for the effect
     * (freeze/destroy), pacing, and cap once it starts acting on whatever
     * this piece touches.
     */
    public markHeldBlockAsPowerup(effect: PowerupEffectConfig): void {
        if (!this.heldBlock) {
            return;
        }

        this.heldBlock.powerup = effect;
    }

    private buildBoxEntity(w: number, h: number): BoxEntity {
        const entity = Pool.instance.getElement(BoxEntity) as BoxEntity;

        entity.build({
            w,
            h,
            layer: CollisionLayer.DEFAULT,
        });

        return entity;
    }

    /**
     * Collision matches the piece's own outline instead of its rectangular
     * bounding box — vertices are the same unit-square points as the piece's
     * `polygon` (see PieceStorage), converted to pixel space and centered on
     * the origin (top-left 0,0 → -w/2,-h/2 etc.) so they line up with
     * PieceBoxBuilder's 3D mesh and BlockBodyTextureCache's 2D texture.
     * Built at (0, 0) — spawnHeldBlock repositions it via Body.setPosition
     * right after, same as the rect path.
     */
    private buildPolygonEntity(polygon: NonNullable<PieceDefinition['polygon']>, w: number, h: number): PolygonEntity {
        const entity = Pool.instance.getElement(PolygonEntity) as PolygonEntity;

        const vertices = polygon.map(p => ({
            x: (p.x - 0.5) * w,
            y: (p.y - 0.5) * h,
        }));

        entity.build({
            x: 0,
            y: 0,
            vertices,
            layer: CollisionLayer.DEFAULT,
        });

        return entity;
    }

    /**
     * Replaces the box's default debug graphic with a Sprite of the shared,
     * pre-rasterized body texture (see BlockBodyTextureCache) — white fill
     * tinted to the piece's own color (black outline stays black under a
     * multiply tint), at the config's global alpha — instead of every block
     * drawing its own vector Graphics. Unless render2DFaces is off, also
     * adds the piece's face texture on top.
     *
     * The sprite's anchor is NOT a flat 0.5 — entity.view (and thus this
     * sprite's parent) is positioned at the physics body's centroid every
     * frame (see BasePhysicsEntity.syncView), and for a rect that centroid
     * IS the visual center, but for a `polygon` piece it generally isn't
     * (e.g. an off-center triangle). getPolygonAnchorFraction gives the
     * fraction of the rasterized texture's own silhouette where that
     * centroid actually falls, so the sprite stays aligned with collision
     * instead of just centering on its own bounding box.
     */
    private styleBlockView(
        entity: BasePhysicsEntity,
        piece: PieceDefinition,
        w: number,
        h: number,
    ): void {
        const debugGraphic = entity.view.children[0] as PIXI.Graphics;
        debugGraphic.visible = false;

        const body = new PIXI.Sprite(this.bodyTexture.getTexture(piece));
        const anchor = getPolygonAnchorFraction(piece.polygon);

        body.anchor.set(anchor.x, anchor.y);
        body.tint = hexStringToNumber(piece.color);
        body.alpha = this.config.blockFillAlpha;

        entity.view.addChildAt(body, 0);

        const faceScale = piece.faceScale ?? { x: 1, y: 1 };
        const faceHidden = faceScale.x <= 0 || faceScale.y <= 0;

        if (this.config.render2DFaces && piece.texture && !faceHidden) {
            const face = PIXI.Sprite.from(resolvePieceImagePath(piece.texture));
            const faceSize = Math.min(w, h) * 0.8;
            const faceOffset = piece.faceOffset ?? { x: 0, y: 0 };

            face.anchor.set(0.5);
            face.width = faceSize * faceScale.x;
            face.height = faceSize * faceScale.y;
            face.position.set(faceOffset.x, faceOffset.y);

            entity.view.addChild(face);
        }
    }

    /**
     * Repositions/restyles the single standalone preview strip (see the
     * `previewStrip` field doc) for the held piece at world position
     * (x, y) — a vfx/grad.webp gradient (opaque at the top, fading to
     * transparent) tinted to the piece's color, anchored to the piece's own
     * base plus previewMargin2D, and extending downward toward the floor.
     *
     * Sized/centered off the polygon's own LEFT/RIGHT extremes (see
     * getPolygonHorizontalBounds), not the area centroid — entity.view (and
     * so `x`) sits at the centroid every frame (see BasePhysicsEntity.syncView),
     * which is correct for collision, but for an asymmetric outline (e.g. a
     * triangle whose mass leans to one side) that point isn't the visual
     * middle of the shape. Anchoring/sizing the strip off the centroid made
     * it visibly off-center and the wrong width for anything that wasn't a
     * plain rect; the bbox center and (right - left) span fix both.
     *
     * Independent nudges stack on top of that corrected anchor, all in
     * plain 2D design px (not a fraction of the piece's size):
     * PieceDefinition.previewOffset (per-piece, for shape-specific tuning —
     * e.g. an arch's legs sit lower than its notch), previewGlobalOffset2D
     * (applied to every piece alike). No-ops (and hides the strip) if
     * previewStripHeight is 0.
     *
     * Margin (previewMargin2D + PieceDefinition.margin) is NOT a Y gap — it
     * insets the strip's WIDTH symmetrically, same as a CSS margin: a
     * margin of 1 removes half a px from the LEFT edge and half from the
     * RIGHT, so the strip stays centered but reads narrower than the
     * piece's own visual span.
     */
    private updatePreviewStrip(piece: PieceDefinition, x: number, y: number, w: number, h: number): void {
        if (this.config.previewStripHeight <= 0) {
            this.previewStrip.visible = false;
            return;
        }

        const centroid = getPolygonCentroid(piece.polygon);
        const bounds = getPolygonHorizontalBounds(piece.polygon);
        const totalMargin = this.config.previewMargin2D + (piece.margin ?? 0);
        const visualWidth = Math.max(0, (bounds.right - bounds.left) * w - totalMargin);
        const centerShiftX = (bounds.center - centroid.x) * w;

        const baseLocalY = (1 - centroid.y) * h;
        const offset = piece.previewOffset ?? { x: 0, y: 0 };
        const globalOffset = this.config.previewGlobalOffset2D;

        this.previewStrip.width = visualWidth;
        this.previewStrip.height = this.config.previewStripHeight;
        this.previewStrip.tint = hexStringToNumber(piece.color);
        this.previewStrip.position.set(
            x + centerShiftX + offset.x + globalOffset.x,
            y + baseLocalY + offset.y + globalOffset.y,
        );
        this.previewStrip.visible = true;
    }

    public moveHeldBlock(x: number): void {
        if (!this.heldBlock) {
            return;
        }

        const piece = this.heldBlock.piece;
        const w = this.config.blockWidth * piece.scale.x;
        const h = this.config.blockHeight * piece.scale.y;
        const body = this.heldBlock.entity.body;

        Body.setPosition(body, {
            x: this.clampBlockX(x, w),
            y: this.camera.toWorldY(this.config.spawnScreenY),
        });

        Body.setVelocity(body, {
            x: 0,
            y: 0,
        });

        Body.setAngularVelocity(body, 0);
        Body.setAngle(body, 0);

        this.heldBlock.entity.syncView();
        this.updatePreviewStrip(piece, body.position.x, body.position.y, w, h);
    }

    public releaseHeldBlock(): FaceTowerBlock | undefined {
        const block = this.heldBlock;

        if (!block) {
            return undefined;
        }

        this.previewStrip.visible = false;
        block.shootRemaining = PieceAnimations.SHOOT_DURATION;

        const body = block.entity.body;

        Body.setStatic(body, false);

        if (block.powerup) {
            // Passes through everything instead of colliding — falls under
            // gravity same as any piece, but never bounces off or pushes
            // anything it touches. PowerupSystem registers its own onStart
            // listener on this same body (see FaceTowerGameController.dropBlock)
            // to learn what it touched; the normal first-hit jiggle below is
            // skipped entirely for a powerup piece, so there's no
            // Physics.events.clear() call here to fight over that listener.
            body.isSensor = true;
        }

        Body.setVelocity(body, {
            x: this.config.dropForceX,
            // A powerup piece can override the drop's downward kick (see
            // PowerupDefinition.dropForceY) — e.g. the lightning falling
            // noticeably faster than a normal piece — falling back to the
            // usual config value when it doesn't set one.
            y: block.powerup?.dropForceY ?? this.config.dropForceY,
        });

        Body.setAngularVelocity(body, 0);
        Body.setAngle(body, 0);

        // Ensure Matter wakes the body after changing it from static.
        Sleeping.set(body, false);

        if (!block.powerup) {
            /*
             * First physical contact with anything (a base, another block, a
             * wall) — not the release itself — is the jiggle's trigger. onStart
             * fires again on every later collision too, so hasJiggled guards it
             * to play exactly once per block; Physics.events.clear() then drops
             * the listener outright since there's nothing left for it to do.
             */
            Physics.events.onStart(body, () => {
                if (block.hasJiggled) {
                    return;
                }

                block.hasJiggled = true;
                block.jiggleRemaining = PieceAnimations.JIGGLE_DURATION;
                this.onBlockFirstHit?.(block);
                Physics.events.clear(body);
            });
        }

        this.heldBlock = undefined;

        return block;
    }

    /**
     * Removes the currently held block outright — no drop, no physics —
     * instead of releasing it. Meant for the dev-only "swap piece" GUI (see
     * IslandViewScene.setupPieceDevGui) where picking a piece from the list
     * should replace whatever's hovering over the drop area, not drop it
     * first.
     */
    public discardHeldBlock(): void {
        const block = this.heldBlock;

        if (!block) {
            return;
        }

        this.previewStrip.visible = false;

        const index = this.blocks.indexOf(block);
        if (index >= 0) {
            this.blocks.splice(index, 1);
        }

        block.entity.destroy();
        this.heldBlock = undefined;
    }

    public freezeBlock(block: FaceTowerBlock): void {
        if (block.checkpointFrozen) {
            return;
        }

        block.checkpointFrozen = true;
        block.entity.isStatic = true;

        Body.setStatic(block.entity.body, true);
        Body.setVelocity(block.entity.body, {
            x: 0,
            y: 0,
        });
        Body.setAngularVelocity(block.entity.body, 0);
    }

    public update(delta: number): void {
        for (const block of this.blocks) {
            block.entity.update(delta);
            this.updatePieceAnim(block, delta);
        }

        for (const base of this.bases) {
            base.update(delta);
        }
    }

    /**
     * Applied after entity.update()'s syncView() so all three layer on top
     * of the physics-driven position/rotation instead of being overwritten
     * by it. Shoot and jiggle can't actually overlap in practice (jiggle
     * only starts once the piece has hit something, well after its own
     * shoot bounce finishes) but combine cleanly regardless: scale
     * multiplies, rotation adds. shrinkScale is folded into that same scale
     * multiply every frame — unlike shoot/jiggle it isn't a timed animation
     * (nothing decrements it), so it has to be applied unconditionally
     * rather than only while shootRemaining/jiggleRemaining are still
     * ticking, or a shrunk piece would snap back to full size the instant
     * its last shoot/jiggle animation finished.
     */
    private updatePieceAnim(block: FaceTowerBlock, delta: number): void {
        block.shootRemaining = Math.max(0, block.shootRemaining - delta);
        block.jiggleRemaining = Math.max(0, block.jiggleRemaining - delta);

        const shoot = PieceAnimations.sampleShoot(block.shootRemaining);
        const jiggle = PieceAnimations.sampleJiggle(block.jiggleRemaining);

        block.entity.view.scale.set(
            shoot.scaleX * jiggle.scaleX * block.shrinkScale,
            shoot.scaleY * jiggle.scaleY * block.shrinkScale,
        );
        block.entity.view.rotation += shoot.rotation + jiggle.rotation;
    }

    public getBlocks(): readonly FaceTowerBlock[] {
        return this.blocks;
    }

    /**
     * Freezes `block` in place (static, zero velocity/angular velocity) and
     * tints its body sprite grey — the 2D half of a powerup's freeze effect
     * (see PowerupSystem.drainQueue). Deliberately doesn't touch
     * `checkpointFrozen` — that flag excludes a block from
     * getHighestTopWorldY()'s zone-completion height check, which a
     * powerup-frozen block (still part of the live stack) should still
     * count toward.
     */
    public freezeBlockForPowerup(block: FaceTowerBlock, greyColorHex: number): void {
        const body = block.entity.body;

        Body.setStatic(body, true);
        Body.setVelocity(body, { x: 0, y: 0 });
        Body.setAngularVelocity(body, 0);

        const bodySprite = block.entity.view.children[0] as PIXI.Sprite;
        bodySprite.tint = greyColorHex;
    }

    /**
     * Shrinks `block` — physics body included, via Matter's Body.scale (which
     * recomputes vertices/area/mass/bounds around the body's own centroid),
     * not just its view — so a shrunk piece genuinely takes up less room in
     * the stack instead of only looking smaller. `shrinkFactor` multiplies
     * the block's CURRENT `shrinkScale` (compounding on repeat hits from
     * later shrink rays), floored at MIN_SHRINK_SCALE so it can never shrink
     * to a degenerate near-zero-area body. `block.shrinkScale` itself is
     * applied to the view every frame in updatePieceAnim(), independent of
     * the shoot/jiggle animations, so the visual shrink persists after they
     * finish instead of being snapped back to full size.
     */
    private static readonly MIN_SHRINK_SCALE = 0.35;

    public shrinkBlockForPowerup(block: FaceTowerBlock, shrinkFactor: number): void {
        const nextScale = Math.max(
            FaceTowerBlockController.MIN_SHRINK_SCALE,
            block.shrinkScale * shrinkFactor,
        );

        const appliedFactor = nextScale / block.shrinkScale;

        if (appliedFactor >= 1) {
            return;
        }

        Body.scale(block.entity.body, appliedFactor, appliedFactor);
        block.shrinkScale = nextScale;
    }

    /**
     * Removes and destroys `block` outright — used when a powerup's dropped
     * piece falls past the bottom of the play column (see PowerupSystem),
     * "leaving the scene" instead of ever settling into the tower.
     */
    public removeBlock(block: FaceTowerBlock): void {
        const index = this.blocks.indexOf(block);

        if (index >= 0) {
            this.blocks.splice(index, 1);
        }

        block.entity.destroy();
    }

    /** Excludes checkpoint-frozen blocks (already part of a settled base) AND powerup pieces (never part of the stack — see FaceTowerBlock.powerup). */
    public getDynamicBlocks(): FaceTowerBlock[] {
        return this.blocks.filter(block => !block.checkpointFrozen && !block.powerup);
    }

    public getHeldBlock(): FaceTowerBlock | undefined {
        return this.heldBlock;
    }

    public getBases(): readonly BoxEntity[] {
        return this.bases;
    }

    /** Call after changing block size/bevel/stroke config at runtime — new blocks will rebuild the shared body texture. */
    public invalidateBodyTexture(): void {
        this.bodyTexture.invalidate();
    }

    /**
     * Highest point (smallest world Y) among the blocks actually placed on
     * the board — excludes checkpoint-frozen blocks, powerup pieces, the
     * currently held block, and a just-dropped block that hasn't had its
     * first hit yet (see `hasJiggled`, set once a block first physically
     * touches something in releaseHeldBlock()'s onStart listener). Without
     * that last exclusion, a piece still mid-air right after release —
     * dropped from well above the stack — would spike the reported height
     * to wherever it currently is falling through, instead of only
     * counting once it's actually settled onto the board. The held block
     * hovers at the spawn point, not wherever it'll actually land, so
     * counting it would report the tower as however tall the spawn point
     * happens to be instead of what's really stacked — it only starts
     * counting once released (see releaseHeldBlock(), which clears
     * heldBlock).
     */
    public getHighestTopWorldY(): number {
        let top = Infinity;

        for (const block of this.blocks) {
            if (block.checkpointFrozen || block.powerup || block === this.heldBlock || !block.hasJiggled) {
                continue;
            }

            top = Math.min(top, block.entity.body.bounds.min.y);
        }

        return top;
    }

    public freezeAll(): void {
        for (const block of this.getDynamicBlocks()) {
            this.freezeBlock(block);
        }
    }

    /**
     * Places a new static base — the "fresh start" floor for the next zone.
     * The very first call (see initialise()) is the tower's starting floor
     * and uses the 'base' static piece (see StaticPieceStorage); every call
     * after that (one per completed zone — see
     * FaceTowerGameController.completeTurn) uses 'milestone' instead — same
     * role split as TowerBaseSync3D's 3D panels.
     */
    public addBase(y: number): void {
        const isStartingFloor = this.bases.length === 0;
        const piece = getStaticPiece(isStartingFloor ? 'base' : 'milestone');

        const base = Pool.instance.getElement(BoxEntity) as BoxEntity;

        base.build({
            w: this.config.floorWidth,
            h: this.config.floorHeight,
            layer: CollisionLayer.DEFAULT,
            debugColor: 0x00ff00,
        });

        base.isStatic = true;
        Body.setStatic(base.body, true);

        Body.setPosition(base.body, {
            x: this.config.floorX,
            y,
        });

        base.syncView();

        (base.view.children[0] as PIXI.Graphics).visible = false;
        base.view.addChildAt(
            buildStaticPieceView(
                piece,
                this.config.floorWidth,
                this.config.floorHeight,
                0x33cc66,
                this.config.blockStrokeColor,
                this.config.blockStrokeWidth,
                this.config.blockBevelRadius,
            ),
            0,
        );

        this.root.addChild(base.view);
        this.bases.push(base);
    }

    public destroy(): void {
        this.heldBlock = undefined;

        for (const block of this.blocks) {
            block.entity.destroy();
        }

        this.blocks.length = 0;

        for (const base of this.bases) {
            base.destroy();
        }

        this.bases.length = 0;

        this.bodyTexture.destroy();
    }

    private clampBlockX(x: number, width: number): number {
        const halfWidth = width * 0.5;

        return Math.max(
            this.config.minBlockX + halfWidth,
            Math.min(this.config.maxBlockX - halfWidth, x),
        );
    }
}
