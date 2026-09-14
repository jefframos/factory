// FaceTowerBlockController.ts

import Pool from 'core/Pool';
import { CollisionLayer } from 'core/phyisics/core/CollisionLayer';
import type { BasePhysicsEntity } from 'core/phyisics/entities/BaseEntity';
import { BoxEntity } from 'core/phyisics/entities/BoxEntity';
import { PolygonEntity } from 'core/phyisics/entities/PolygonEntity';
import Physics from 'core/phyisics/Physics';
import {
    Body, Sleeping
} from 'matter-js';
import * as PIXI from 'pixi.js';
import { BlockBodyTextureCache } from './BlockBodyTextureCache';
import { getFlapPolygon } from './FlapShape';
import type {
    FaceTowerBlock,
    FaceTowerConfig,
    PowerupEffectConfig,
} from './FaceTowerTypes';
import { PieceAnimations } from './PieceAnimations';
import { getPieceWeight, getPolygonAnchorFraction, getPolygonCentroid, getPolygonHorizontalBounds, resolvePieceImagePath, type PieceDefinition } from './PieceStorage';
import { buildStaticPieceView } from './StaticPieceView2D';
import { getStaticPiece, getStaticPieceById, type StaticPieceDefinition } from './StaticPieceStorage';
import type { TowerCameraController } from './TowerCameraController';

function hexStringToNumber(hex: string): number {
    return parseInt(hex.replace('#', ''), 16);
}

/**
 * Per-flap bookkeeping for the two-flap floor (see
 * FaceTowerBlockController.addBase()/setFlapAngle()) — everything needed to
 * keep a fixed WORLD-space hinge point in place while the flap's body
 * rotates around it.
 *
 * `localHingeX` is the hinge's position in the flap's own unrotated,
 * body-center-relative space (its outer edge — negative/left for the left
 * flap, positive/right for the right flap; the hinge is always at local Y 0,
 * so there's no localHingeY field). `sign` is which direction (+1 or -1)
 * this flap's own angle must go so that INCREASING a shared, always-positive
 * "how far open" magnitude swings its INNER edge further down — left and
 * right flaps use opposite signs so a single shared magnitude opens both
 * symmetrically (see setFlapAngle()).
 */
interface FlapInfo {
    side: 'left' | 'right';
    hingeX: number;
    hingeY: number;
    localHingeX: number;
    sign: number;
}

export class FaceTowerBlockController {
    private readonly blocks: FaceTowerBlock[] = [];
    /**
     * Two half-width BoxEntity flaps per floor — see addBase(). A trapdoor
     * removes both of the current floor's flaps before the next floor's
     * pair is placed (see removeBase()), so this holds exactly 0 or 2
     * entries in practice, never 1. Still a flat array (not e.g. a
     * left/right pair) since TowerBaseSync3D/callers already diff/iterate it
     * generically.
     */
    private readonly bases: BasePhysicsEntity[] = [];
    /** Which STATIC_PIECES id each base actually resolved to — see addBase()/getBasePieceId(). Both flaps of a floor share the same resolved piece/id. */
    private readonly basePieceIds = new WeakMap<BasePhysicsEntity, string | undefined>();
    /** Hinge/side/angle-sign bookkeeping per flap — see FlapInfo, setFlapAngle(). */
    private readonly flapInfo = new Map<BasePhysicsEntity, FlapInfo>();
    /**
     * The current floor's own rest row Y — i.e. exactly the `y` addBase()
     * was called with, NOT any individual flap's own (tilted, and so
     * slightly offset) body.position.y. Tracked separately because once
     * flaps have a nonzero rest tilt, `body.position.y` for either flap is
     * a little below this row (the pivot math trades a flat body center for
     * a fixed hinge point) — anything that needs "the floor's own Y" (the
     * next trapdoor's fall distance, the height gauge, dev tools) should
     * read this instead of reaching into a flap body directly. See
     * getCurrentFloorY().
     */
    private currentFloorY: number;
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

    /** True once addBase() has ever been called for this run — used to pick the 'base' vs 'milestone' static-piece role (see addBase()). Can't just check `bases.length === 0` any more since a trapdoor genuinely empties `bases` for a beat between removeBase() and the next addBase(). */
    private hasPlacedInitialBase = false;

    /** Running sum of getPieceWeight() across every live, non-powerup block — see getTotalWeight(). Kept incremental (bumped on release/merge-spawn, trimmed on removal) rather than resummed every frame. */
    private totalWeight = 0;

    public constructor(
        private readonly root: PIXI.Container,
        private readonly config: FaceTowerConfig,
        private readonly camera: TowerCameraController,
        /**
         * Notified the instant a block's jiggle actually fires (its first
         * physical contact) — the 3D mirror layer has no physics of its own,
         * so this is how it learns to play the matching cube jiggle. Also
         * feeds TowerVfxUtils.onFirstTouchVfx (see IslandViewScene) for the
         * juice pass — `contactPoint` is a best-effort 2D physics position
         * (Matter's own contact point when available, else the midpoint
         * between the two bodies), and `hitBlock` is whichever OTHER block
         * was struck, undefined when it hit a base/wall/something that isn't
         * a tracked block. See FaceTowerGameEvents.onBlockFirstHit.
         */
        private readonly onBlockFirstHit?: (
            block: FaceTowerBlock,
            contactPoint: { x: number; y: number },
            hitBlock: FaceTowerBlock | undefined,
        ) => void,
        /**
         * Fired on EVERY collision a (non-powerup) block ever has, forever —
         * not just its first — whenever the other body also resolves to a
         * tracked block (never fires for a base/wall hit). See
         * TowerMergeController.notifyTouch, the sole consumer: same-tier
         * pieces touching is exactly what queues a merge.
         */
        private readonly onBlockTouch?: (
            block: FaceTowerBlock,
            otherBlock: FaceTowerBlock,
            contactPoint: { x: number; y: number },
        ) => void,
        /** Fired the instant removeBlock() actually removes a block — see TowerMergeController.cancelBlock(), so a bomb destroying a block mid-merge-queue can't leave a pending pair pointing at a dead body. */
        private readonly onBlockRemoved?: (blockId: number) => void,
    ) {
        this.currentFloorY = config.floorY;
        this.bodyTexture = new BlockBodyTextureCache(config);

        this.previewStrip = PIXI.Sprite.from(resolvePieceImagePath('vfx/grad.webp'));
        this.previewStrip.anchor.set(0.5, 0);
        this.previewStrip.visible = false;
        this.root.addChild(this.previewStrip);
    }

    public initialise(basePieceId?: string): void {
        this.addBase(this.config.floorY, basePieceId);
    }

    public spawnHeldBlock(x: number, piece: PieceDefinition): FaceTowerBlock {
        if (this.heldBlock) {
            throw new Error('Cannot spawn another block while a block is held.');
        }

        // Defense-in-depth: `this.heldBlock` is the single source of truth
        // above, but if any OTHER block were still tagged 'held' — heldBlock
        // cleared without that block's own state following — that's exactly
        // the "two pieces in the drop zone" bug this field exists to catch.
        // Fail loudly here instead of silently spawning a second held piece.
        const staleHeld = this.blocks.find(existing => existing.state === 'held');
        if (staleHeld) {
            throw new Error(`FaceTowerBlockController: found a stale 'held' block (id ${staleHeld.id}) not tracked by heldBlock — this must never happen.`);
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
        entity.body.restitution = 0.6;
        entity.body.frictionAir = 0.012;

        entity.syncView();
        this.styleBlockView(entity, piece, w, h);
        this.updatePreviewStrip(piece, entity.body.position.x, entity.body.position.y, w, h);

        this.root.addChild(entity.view);

        const block: FaceTowerBlock = {
            id: this.nextBlockId++,
            entity,
            piece,
            state: 'held',
            shootRemaining: 0,
            jiggleRemaining: 0,
            hasJiggled: false,
            mergeGraceRemaining: 0,
        };

        this.blocks.push(block);
        this.heldBlock = block;

        return block;
    }

    /**
     * Tags the currently held block as a powerup's dropped piece — call
     * right after spawnHeldBlock() (see FaceTowerGameController.spawnPowerup).
     * releaseHeldBlock() reads this to make the body a sensor instead of a
     * normal collider once dropped; PowerupSystem reads it for the destroy
     * effect's pacing/cap once it starts acting on whatever this piece
     * touches.
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
     * Built at (0, 0) — spawnHeldBlock/spawnMergedBlock reposition it via
     * Body.setPosition right after, same as the rect path.
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
        block.state = 'dropped';
        block.shootRemaining = PieceAnimations.SHOOT_DURATION;

        const body = block.entity.body;

        Body.setStatic(body, false);

        if (block.powerup) {
            // Passes through everything instead of colliding — falls under
            // gravity same as any piece, but never bounces off or pushes
            // anything it touches. PowerupSystem registers its own onStart
            // listener on this same body (see FaceTowerGameController.dropBlock)
            // to learn what it touched; the normal first-hit jiggle/merge
            // listener below is skipped entirely for a powerup piece.
            //
            // Set on every part, not just `body` itself: a CONCAVE polygon
            // gets decomposed by poly-decomp into multiple convex sub-parts
            // (see PhysicsBodyFactory.createPolygon — body.parts.length > 1
            // for those), and Matter's actual narrowphase collision check
            // reads each PART's own isSensor flag, not the parent body's —
            // so setting only `body.isSensor` left those parts still solid,
            // and the piece landed/collided like a normal one instead of
            // passing through. `body.parts` always includes `body` itself
            // at index 0 for a single-part (convex) body, so this is safe
            // either way.
            for (const part of body.parts) {
                part.isSensor = true;
            }
        } else {
            // Persistent collision listener — plays the one-shot jiggle on
            // first contact AND keeps firing onBlockTouch for the rest of
            // this block's life (merge detection needs a touch that can
            // fire again and again, long after the jiggle has already
            // played once). Deliberately never cleared while the block is
            // alive — see registerCollisionListener()'s own doc for why an
            // earlier version of this code calling Physics.events.clear()
            // here was a real bug.
            this.registerCollisionListener(block);
        }

        Body.setVelocity(body, {
            x: this.config.dropForceX,
            // A powerup piece can override the drop's downward kick (see
            // PowerupDefinition.dropForceY) — e.g. the bomb falling
            // noticeably faster than a normal piece — falling back to the
            // usual config value when it doesn't set one.
            y: block.powerup?.dropForceY ?? this.config.dropForceY,
        });

        Body.setAngularVelocity(body, 0);
        Body.setAngle(body, 0);

        // Ensure Matter wakes the body after changing it from static.
        Sleeping.set(body, false);

        if (!block.powerup) {
            this.totalWeight += getPieceWeight(block.piece);
        }

        this.heldBlock = undefined;

        return block;
    }

    /**
     * Registers a PERSISTENT onStart listener on `block`'s own body — used
     * by both releaseHeldBlock() (a normal drop) and spawnMergedBlock() (a
     * freshly-merged piece). Plays the one-shot "jiggle" wobble + fires
     * onBlockFirstHit exactly once (guarded by hasJiggled), same as before,
     * but then keeps going: on EVERY collision, for as long as the block
     * exists, it also fires onBlockTouch whenever the other body resolves
     * to a tracked block — that's what lets TowerMergeController notice two
     * same-tier pieces touching well after either one's own first-ever hit.
     *
     * Deliberately never calls Physics.events.clear(body) — that wipes a
     * body's ENTIRE listener array (see PhysicsEventManager.clear()), which
     * would silently kill this same listener the very first time it fired.
     * Real destruction (Physics.removeBody(), called from
     * BasePhysicsEntity.destroy()) already clears listeners on its own, so
     * cleanup when the block is actually removed is unaffected.
     */
    private registerCollisionListener(block: FaceTowerBlock): void {
        const body = block.entity.body;

        Physics.events.onStart(body, (otherBody, pair) => {
            const support = pair.collision?.supports?.[0];
            const contactPoint = support
                ? { x: support.x, y: support.y }
                : { x: (body.position.x + otherBody.position.x) / 2, y: (body.position.y + otherBody.position.y) / 2 };

            if (!block.hasJiggled) {
                block.hasJiggled = true;
                block.jiggleRemaining = PieceAnimations.JIGGLE_DURATION;

                this.onBlockFirstHit?.(block, contactPoint, this.findBlockByBodyId(otherBody.id));
            }

            const otherBlock = this.findBlockByBodyId(otherBody.id);

            if (otherBlock) {
                this.onBlockTouch?.(block, otherBlock, contactPoint);
            }
        });
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

        block.state = 'dropped';
        block.entity.destroy();
        this.heldBlock = undefined;
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
     * Applied after entity.update()'s syncView() so both layer on top of
     * the physics-driven position/rotation instead of being overwritten by
     * it. Shoot and jiggle can't actually overlap in practice (jiggle only
     * starts once the piece has hit something, well after its own shoot
     * bounce finishes) but combine cleanly regardless: scale multiplies,
     * rotation adds.
     */
    private updatePieceAnim(block: FaceTowerBlock, delta: number): void {
        block.shootRemaining = Math.max(0, block.shootRemaining - delta);
        block.jiggleRemaining = Math.max(0, block.jiggleRemaining - delta);
        block.mergeGraceRemaining = Math.max(0, block.mergeGraceRemaining - delta);

        const shoot = PieceAnimations.sampleShoot(block.shootRemaining);
        const jiggle = PieceAnimations.sampleJiggle(block.jiggleRemaining);

        block.entity.view.scale.set(
            shoot.scaleX * jiggle.scaleX,
            shoot.scaleY * jiggle.scaleY,
        );
        block.entity.view.rotation += shoot.rotation + jiggle.rotation;
    }

    public getBlocks(): readonly FaceTowerBlock[] {
        return this.blocks;
    }

    public hasBlock(blockId: number): boolean {
        return this.blocks.some(block => block.id === blockId);
    }

    /** Best-effort lookup for onBlockFirstHit's `hitBlock`/onBlockTouch's `otherBlock` — undefined for anything not a tracked block (a base, a wall). */
    private findBlockByBodyId(bodyId: number): FaceTowerBlock | undefined {
        return this.blocks.find(block => block.entity.body.id === bodyId);
    }

    /**
     * Removes and destroys `block` outright — used when a powerup's dropped
     * piece falls past the bottom of the play column (see PowerupSystem),
     * the bomb destroying whatever it touches, or a merge consuming its two
     * source pieces (see TowerMergeController).
     */
    public removeBlock(block: FaceTowerBlock): void {
        const index = this.blocks.indexOf(block);

        if (index >= 0) {
            this.blocks.splice(index, 1);
        }

        if (!block.powerup) {
            this.totalWeight = Math.max(0, this.totalWeight - getPieceWeight(block.piece));
        }

        block.entity.destroy();
        this.onBlockRemoved?.(block.id);
    }

    /**
     * Removes every live, non-powerup block whose `piece.tier` is in
     * `tiers` — see FaceTowerGameController.triggerClearLowTierPowerup().
     * Snapshots `this.blocks` first since removeBlock() mutates that same
     * array. Excludes a 'held' block (the piece currently hovering, waiting
     * to be dropped, not yet part of the board) — same guard
     * getHighestTopWorldY()/getHighestSettledTopWorldY() use; without it,
     * this could destroy the piece out of the player's hand mid-hold,
     * breaking the drop/spawn flow.
     *
     * Returns each removed block's 2D world position, captured BEFORE
     * removeBlock() destroys its physics body — the caller uses these to
     * spawn a VFX burst per piece (see TowerVfxUtils.onDiscardLowTierVfx()),
     * same raw-(x,y)-not-a-block convention TowerVfxUtils.onScorePopVfx()
     * already uses, so this stays free of any 3D/THREE dependency.
     */
    public removeBlocksByTiers(tiers: readonly number[]): readonly { x: number; y: number }[] {
        const removedPositions: { x: number; y: number }[] = [];

        for (const block of [...this.blocks]) {
            if (block.powerup || block.state === 'held') {
                continue;
            }

            if (block.piece.tier !== undefined && tiers.includes(block.piece.tier)) {
                const { x, y } = block.entity.body.position;
                removedPositions.push({ x, y });
                this.removeBlock(block);
            }
        }

        return removedPositions;
    }

    /**
     * Spawns `piece` directly as a live, already-falling block at world
     * position (x, y) — the result of two same-tier pieces merging (see
     * TowerMergeController.resolvePair). Never held/static — it pops into
     * existence mid-pile with a small impulse plus BOTH the same "shoot"
     * launch stretch AND "jiggle" squash-wobble a normal drop's first
     * landing contact gets (see PieceAnimations) — the same visible "bounce"
     * a piece plays hitting the pile for the first time, just triggered
     * synthetically here instead of waiting for a real collision event,
     * since a merge result is created already touching its neighbors rather
     * than falling in from off-screen. Immediately counts toward the
     * board's height/weight (hasJiggled starts true for that reason too —
     * setting jiggleRemaining directly above doesn't reopen that gate, so
     * this doesn't also make it wait for a "real" first hit that may never
     * distinctly fire). Can't merge AGAIN itself until mergeGraceRemaining
     * (see FaceTowerConfig.mergeGraceDuration) ticks down to 0 — a readable
     * beat between each link of a cascade instead of it all resolving at
     * once.
     */
    public spawnMergedBlock(piece: PieceDefinition, x: number, y: number): FaceTowerBlock {
        const w = this.config.blockWidth * piece.scale.x;
        const h = this.config.blockHeight * piece.scale.y;

        const entity = piece.polygon
            ? this.buildPolygonEntity(piece.polygon, w, h)
            : this.buildBoxEntity(w, h);

        Body.setPosition(entity.body, { x, y });
        Body.setAngle(entity.body, 0);

        entity.body.friction = 0.65;
        entity.body.frictionStatic = 0.8;
        entity.body.restitution = 0.6;
        entity.body.frictionAir = 0.012;

        entity.syncView();
        this.styleBlockView(entity, piece, w, h);

        this.root.addChild(entity.view);

        const block: FaceTowerBlock = {
            id: this.nextBlockId++,
            entity,
            piece,
            state: 'dropped',
            shootRemaining: PieceAnimations.SHOOT_DURATION,
            jiggleRemaining: PieceAnimations.JIGGLE_DURATION,
            hasJiggled: true,
            mergeGraceRemaining: this.config.mergeGraceDuration,
        };

        this.blocks.push(block);
        this.totalWeight += getPieceWeight(piece);

        // Small pop impulse — a merge should read as the two pieces
        // nudging apart/settling into their new combined shape, not just
        // silently swapping. Matter's applyForce is mass-relative, so this
        // stays a subtle nudge regardless of the merged piece's own size.
        const popImpulse = 0.002;
        Body.applyForce(entity.body, entity.body.position, {
            x: (Math.random() - 0.5) * popImpulse,
            y: -Math.abs(popImpulse),
        });

        this.registerCollisionListener(block);

        return block;
    }

    public getHeldBlock(): FaceTowerBlock | undefined {
        return this.heldBlock;
    }

    /**
     * Approximate world-px "radius" of `piece` — half its shorter scaled
     * dimension, since every current piece is roughly circular (or at
     * least reads fine approximated as one for a rough proximity check).
     * See TowerMergeProximityController, the sole consumer — a forgiving
     * center-distance-based merge safety net, not exact collision geometry.
     */
    public getPieceRadius(piece: PieceDefinition): number {
        const w = this.config.blockWidth * piece.scale.x;
        const h = this.config.blockHeight * piece.scale.y;

        return Math.min(w, h) * 0.5;
    }

    public getBases(): readonly BasePhysicsEntity[] {
        return this.bases;
    }

    /** Call after changing block size/bevel/stroke config at runtime — new blocks will rebuild the shared body texture. */
    public invalidateBodyTexture(): void {
        this.bodyTexture.invalidate();
    }

    /** Every block that isn't a powerup piece — i.e. everything actually part of the live board. */
    public getDynamicBlocks(): FaceTowerBlock[] {
        return this.blocks.filter(block => !block.powerup);
    }

    /**
     * Highest point (smallest world Y) among the blocks actually placed on
     * the board — excludes powerup pieces, the currently held block, and a
     * just-dropped/just-merged block that hasn't had its first hit yet (see
     * `hasJiggled`). Without that last exclusion, a piece still mid-air
     * right after release — dropped from well above the stack — would
     * spike the reported height to wherever it currently is falling
     * through, instead of only counting once it's actually settled onto
     * the board. The held block hovers at the spawn point, not wherever
     * it'll actually land, so counting it would report the tower as
     * however tall the spawn point happens to be instead of what's really
     * stacked — it only starts counting once released (see
     * releaseHeldBlock(), which clears heldBlock).
     *
     * Deliberately does NOT also require the block to currently be at rest
     * (no speed/angularSpeed check) — this used to be split into this
     * cosmetic variant plus a separate getHighestSettledTopWorldY() for
     * FaceTowerGameController.updateGameOverLine(), but that speed gate
     * caused the game-over timer to spuriously RESET: a piece already
     * sitting at the line would momentarily exceed the resting-speed
     * threshold every time a NEW piece landed/jostled nearby, dropping out
     * of the "settled" tally for a frame and reading as "nothing's up
     * there any more" even though it never actually left. `hasJiggled`
     * alone (has this block ever made real contact with anything) is
     * enough to mean "this is genuinely part of the pile, not still
     * falling through on its very first drop" — one shared definition for
     * both the cosmetic gauge and the game-over check.
     */
    public getHighestTopWorldY(): number {
        let top = Infinity;

        for (const block of this.blocks) {
            if (block.powerup || block.state === 'held' || !block.hasJiggled) {
                continue;
            }

            top = Math.min(top, block.entity.body.bounds.min.y);
        }

        return top;
    }

    /** Sum of getPieceWeight() across every live, non-powerup block — see FaceTowerConfig/TowerZoneController's weight milestone. */
    public getTotalWeight(): number {
        return this.totalWeight;
    }

    /**
     * Zeroes the weight counter WITHOUT touching any actual block — called
     * the instant a trapdoor's milestone is consumed (see
     * FaceTowerGameController.beginTrapdoor()), even though the same
     * pieces are about to crash down onto a new floor rather than being
     * removed. The milestone system measures "progress built up since the
     * last floor reset," not "total physical mass on the board" — without
     * this, totalWeight would just keep climbing for the whole run (merges
     * conserve weight, they never reduce it), so each new zone's threshold
     * — only a little higher than the last — would already be exceeded by
     * whatever's left over from before, triggering the next trapdoor after
     * a single extra drop instead of a genuinely fresh zone's worth of play.
     */
    public resetWeight(): void {
        this.totalWeight = 0;
    }

    /**
     * Places a new floor — the tower's very first (see initialise()), or a
     * fresh one under the pile once a trapdoor's fall finishes (see
     * TowerTrapdoorController, which calls removeBase() on both of the old
     * floor's flaps first). Built as TWO half-width flap bodies side by
     * side, meeting in the middle, rather than one full-width panel — see
     * the two-flap trapdoor doc on FlapInfo/setFlapAngle(). The very first
     * floor ever placed for this run uses the 'base' static piece (see
     * StaticPieceStorage); every one after that uses 'milestone' instead —
     * tracked via hasPlacedInitialBase rather than `bases.length === 0`,
     * since a trapdoor genuinely empties `bases` for a beat between
     * removeBase() and this call — same role split as TowerBaseSync3D's 3D
     * panels.
     *
     * `basePieceId` (see IslandConfig.basePieceId) overrides that role-based
     * lookup outright when it resolves to a real STATIC_PIECES entry — lets
     * the currently-active island swap in its own base shape/color instead
     * of the single global default. Stashed in basePieceIds so
     * TowerBaseSync3D.createPanel() (which only ever sees the base entity
     * itself, not this call's params) can mirror the same choice in 3D — see
     * getBasePieceId().
     *
     * Both flaps are ALWAYS plain half-width rects (BoxEntity), even when
     * the resolved piece defines a custom `polygon` (e.g. the starting
     * 'base' piece's two-legs-and-an-arch shape, or an island's own
     * basePieceId override) — splitting an arbitrary authored polygon in
     * half into two physically-sane convex hinged halves isn't tractable in
     * general (concave notches, off-center silhouettes), so this
     * deliberately trades that per-floor custom silhouette for two plain
     * flaps in the piece's own color/texture. The piece's `polygon` is
     * stripped before handing it to buildStaticPieceView() for the same
     * reason — rendering half of a full-width authored outline would look
     * wrong, not just be structurally simplified.
     */
    public addBase(y: number, basePieceId?: string): void {
        const isStartingFloor = !this.hasPlacedInitialBase;
        this.hasPlacedInitialBase = true;
        this.currentFloorY = y;

        const piece = (basePieceId ? getStaticPieceById(basePieceId) : undefined) ?? getStaticPiece(isStartingFloor ? 'base' : 'milestone');
        const flatPiece = piece ? { ...piece, polygon: undefined } : undefined;

        const flapWidth = this.config.floorWidth / 2;
        const halfFlapWidth = flapWidth / 2;
        const halfFloorWidth = this.config.floorWidth / 2;

        this.createFlap('left', flatPiece, flapWidth, halfFlapWidth, halfFloorWidth, y);
        this.createFlap('right', flatPiece, flapWidth, halfFlapWidth, halfFloorWidth, y);
    }

    /**
     * Builds one half-width flap (see addBase()) — a plain BoxEntity, hinged
     * at its own OUTER edge (against the wall, `hingeX` below), and set to
     * FaceTowerConfig.floorFlapRestAngle's idle tilt via setFlapAngle()
     * right away so it never appears perfectly flat, even for one frame.
     */
    private createFlap(
        side: 'left' | 'right',
        piece: StaticPieceDefinition | undefined,
        flapWidth: number,
        halfFlapWidth: number,
        halfFloorWidth: number,
        y: number,
    ): void {
        const sign = side === 'left' ? 1 : -1;
        const centerX = this.config.floorX + (side === 'left' ? -halfFlapWidth : halfFlapWidth);
        // The hinge sits at this flap's own OUTER edge — the left flap's
        // left edge / the right flap's right edge, i.e. the far edges of
        // the whole floor.
        const hingeX = this.config.floorX + (side === 'left' ? -halfFloorWidth : halfFloorWidth);
        // Local (unrotated, body-center-relative) X of that same hinge —
        // negative for the left flap (hinge is to the left of center),
        // positive for the right flap (hinge is to the right of center).
        const localHingeX = side === 'left' ? -halfFlapWidth : halfFlapWidth;

        const base = this.buildBoxEntity(flapWidth, this.config.floorHeight);

        base.isStatic = true;
        Body.setStatic(base.body, true);
        Body.setPosition(base.body, { x: centerX, y });

        this.flapInfo.set(base, {
            side,
            hingeX,
            hingeY: y,
            localHingeX,
            sign,
        });

        this.setFlapAngle(base, this.config.floorFlapRestAngle);

        (base.view.children[0] as PIXI.Graphics).visible = false;
        base.view.addChildAt(
            buildStaticPieceView(
                piece,
                flapWidth,
                this.config.floorHeight,
                0x33cc66,
                this.config.blockStrokeColor,
                this.config.blockStrokeWidth,
                this.config.blockBevelRadius,
                getFlapPolygon(side),
            ),
            0,
        );

        this.root.addChild(base.view);
        this.bases.push(base);
        this.basePieceIds.set(base, piece?.id);
    }

    /**
     * Rotates `base` (one flap of a two-flap floor — see addBase()) to
     * `magnitude` radians away from flat (0 = perfectly flat), using this
     * flap's own recorded `sign` (see FlapInfo) so a single shared,
     * always-positive `magnitude` swings BOTH flaps' INNER (center-seam)
     * edges further down at once, mirrored around the middle — the idle
     * rest tilt (FaceTowerConfig.floorFlapRestAngle) and the trapdoor's
     * open swing (interpolating up to floorFlapOpenAngle — see
     * TowerTrapdoorController) both just call this with a different
     * `magnitude`.
     *
     * Rotates around the flap's own fixed WORLD-space hinge point (its
     * outer edge, against the wall) rather than its center — standard
     * "rotate around an arbitrary pivot" math: translate the hinge to the
     * origin, rotate by the body's own angle, translate back. Both Matter
     * (for collision) and this engine's BasePhysicsEntity.syncView() (for
     * the Pixi view, driven by `body.angle`/`body.position` every frame —
     * see FaceTowerBlockController.update()) use the same plain rotation
     * matrix for a body's own angle, so computing the flap's CENTER this
     * way keeps the hinge point exactly fixed in world space as it swings,
     * in both 2D physics and the 2D view alike.
     */
    public setFlapAngle(base: BasePhysicsEntity, magnitude: number): void {
        const info = this.flapInfo.get(base);

        if (!info) {
            return;
        }

        const angle = magnitude * info.sign;
        const lx = info.localHingeX;

        Body.setAngle(base.body, angle);
        Body.setPosition(base.body, {
            x: info.hingeX - lx * Math.cos(angle),
            y: info.hingeY - lx * Math.sin(angle),
        });

        base.syncView();
    }

    /**
     * The current floor's own rest row Y — exactly the `y` addBase() was
     * last called with, NOT any individual flap body's own (tilted, so
     * slightly offset) position.y. See the `currentFloorY` field doc.
     */
    public getCurrentFloorY(): number {
        return this.currentFloorY;
    }

    /**
     * Destroys `base`'s physics body outright — no freeze/static toggling,
     * symmetric to addBase()/createFlap(). Called by TowerTrapdoorController
     * once per flap, right before the pile free-falls through the gap this
     * leaves behind.
     */
    public removeBase(base: BasePhysicsEntity): void {
        const index = this.bases.indexOf(base);

        if (index >= 0) {
            this.bases.splice(index, 1);
        }

        this.basePieceIds.delete(base);
        this.flapInfo.delete(base);
        base.destroy();
    }

    /** Whichever STATIC_PIECES id addBase() actually resolved for `base` (role-based default or an island's own basePieceId override) — see TowerBaseSync3D.createPanel(), the sole consumer. */
    public getBasePieceId(base: BasePhysicsEntity): string | undefined {
        return this.basePieceIds.get(base);
    }

    /** Which flap (left/right) `base` is — see FlapInfo/createFlap(). TowerBaseSync3D's sole consumer, to mirror the same FlapShape.getFlapPolygon() choice onto the 3D panel mesh. */
    public getFlapSide(base: BasePhysicsEntity): 'left' | 'right' | undefined {
        return this.flapInfo.get(base)?.side;
    }

    public destroy(): void {
        this.heldBlock = undefined;

        for (const block of this.blocks) {
            block.entity.destroy();
        }

        this.blocks.length = 0;
        this.totalWeight = 0;

        for (const base of this.bases) {
            base.destroy();
        }

        this.bases.length = 0;
        this.flapInfo.clear();
        this.hasPlacedInitialBase = false;
        this.currentFloorY = this.config.floorY;

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
