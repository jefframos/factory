// FaceTowerBlockController.ts

import Pool from 'core/Pool';
import { CollisionLayer } from 'core/phyisics/core/CollisionLayer';
import type { BasePhysicsEntity } from 'core/phyisics/entities/BaseEntity';
import { BoxEntity } from 'core/phyisics/entities/BoxEntity';
import { PolygonEntity } from 'core/phyisics/entities/PolygonEntity';
import {
    Body,
    Sleeping
} from 'matter-js';
import * as PIXI from 'pixi.js';
import { BlockBodyTextureCache } from './BlockBodyTextureCache';
import type {
    FaceTowerBlock,
    FaceTowerConfig,
} from './FaceTowerTypes';
import { getPolygonAnchorFraction, resolvePieceImagePath, type PieceDefinition } from './PieceStorage';
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

    private heldBlock?: FaceTowerBlock;

    private nextBlockId = 1;

    public constructor(
        private readonly root: PIXI.Container,
        private readonly config: FaceTowerConfig,
        private readonly camera: TowerCameraController,
    ) {
        this.bodyTexture = new BlockBodyTextureCache(config);
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

        this.root.addChild(entity.view);

        const block: FaceTowerBlock = {
            id: this.nextBlockId++,
            entity,
            checkpointFrozen: false,
            piece,
        };

        this.blocks.push(block);
        this.heldBlock = block;

        return block;
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

        if (this.config.render2DFaces && piece.texture) {
            const face = PIXI.Sprite.from(resolvePieceImagePath(piece.texture));
            const faceSize = Math.min(w, h) * 0.8;
            const faceScale = piece.faceScale ?? { x: 1, y: 1 };
            const faceOffset = piece.faceOffset ?? { x: 0, y: 0 };

            face.anchor.set(0.5);
            face.width = faceSize * faceScale.x;
            face.height = faceSize * faceScale.y;
            face.position.set(faceOffset.x * w, faceOffset.y * h);

            entity.view.addChild(face);
        }
    }

    public moveHeldBlock(x: number): void {
        if (!this.heldBlock) {
            return;
        }

        const w = this.config.blockWidth * this.heldBlock.piece.scale.x;
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
    }

    public releaseHeldBlock(): FaceTowerBlock | undefined {
        const block = this.heldBlock;

        if (!block) {
            return undefined;
        }

        const body = block.entity.body;

        Body.setStatic(body, false);

        Body.setVelocity(body, {
            x: this.config.dropForceX,
            y: this.config.dropForceY,
        });

        Body.setAngularVelocity(body, 0);
        Body.setAngle(body, 0);

        // Ensure Matter wakes the body after changing it from static.
        Sleeping.set(body, false);

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
        }

        for (const base of this.bases) {
            base.update(delta);
        }
    }

    public getBlocks(): readonly FaceTowerBlock[] {
        return this.blocks;
    }

    public getDynamicBlocks(): FaceTowerBlock[] {
        return this.blocks.filter(block => !block.checkpointFrozen);
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

    /** Highest point (smallest world Y) among the still-dynamic blocks. */
    public getHighestTopWorldY(): number {
        let top = Infinity;

        for (const block of this.blocks) {
            if (block.checkpointFrozen) {
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
