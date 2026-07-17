// FaceTowerBlockController.ts

import Pool from 'core/Pool';
import { CollisionLayer } from 'core/phyisics/core/CollisionLayer';
import { BoxEntity } from 'core/phyisics/entities/BoxEntity';
import {
    Body,
    Sleeping
} from 'matter-js';
import * as PIXI from 'pixi.js';
import type {
    FaceTowerBlock,
    FaceTowerConfig,
} from './FaceTowerTypes';

export class FaceTowerBlockController {
    private readonly blocks: FaceTowerBlock[] = [];

    private floor?: BoxEntity;
    private heldBlock?: FaceTowerBlock;

    private nextBlockId = 1;

    public constructor(
        private readonly root: PIXI.Container,
        private readonly config: FaceTowerConfig,
    ) { }

    public initialise(): void {
        this.createFloor();
    }

    public spawnHeldBlock(x: number): FaceTowerBlock {
        if (this.heldBlock) {
            throw new Error('Cannot spawn another block while a block is held.');
        }

        const entity = Pool.instance.getElement(BoxEntity) as BoxEntity;

        entity.build({
            w: this.config.blockWidth,
            h: this.config.blockHeight,
            layer: CollisionLayer.DEFAULT,
            debugColor: Math.floor(Math.random() * 0xffffff),
        });

        /*
         * The block must not fall while the player is positioning it.
         * Making it static is simpler than manually cancelling gravity.
         */
        entity.isStatic = true;
        Body.setStatic(entity.body, true);

        Body.setPosition(entity.body, {
            x: this.clampBlockX(x),
            y: this.config.spawnY,
        });

        Body.setAngle(entity.body, 0);

        entity.body.friction = 0.65;
        entity.body.frictionStatic = 0.8;
        entity.body.restitution = 0.05;
        entity.body.frictionAir = 0.025;

        entity.syncView();

        this.root.addChild(entity.view);

        const block: FaceTowerBlock = {
            id: this.nextBlockId++,
            entity,
            checkpointFrozen: false,
        };

        this.blocks.push(block);
        this.heldBlock = block;

        return block;
    }

    public moveHeldBlock(x: number): void {
        if (!this.heldBlock) {
            return;
        }

        const body = this.heldBlock.entity.body;

        Body.setPosition(body, {
            x: this.clampBlockX(x),
            y: this.config.spawnY,
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
            x: 0,
            y: 0,
        });

        Body.setAngularVelocity(body, 0);
        Body.setAngle(body, 0);

        // Ensure Matter wakes the body after changing it from static.
        Sleeping.set(body, false);

        this.heldBlock = undefined;

        return block;
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

        this.floor?.update(delta);
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

    public destroy(): void {
        this.heldBlock = undefined;

        for (const block of this.blocks) {
            block.entity.destroy();
        }

        this.blocks.length = 0;

        this.floor?.destroy();
        this.floor = undefined;
    }

    private createFloor(): void {
        const floor = Pool.instance.getElement(BoxEntity) as BoxEntity;

        floor.build({
            w: this.config.floorWidth,
            h: this.config.floorHeight,
            layer: CollisionLayer.DEFAULT,
            debugColor: 0x00ff00,
        });

        floor.isStatic = true;
        Body.setStatic(floor.body, true);

        Body.setPosition(floor.body, {
            x: this.config.floorX,
            y: this.config.floorY,
        });

        floor.syncView();

        this.root.addChild(floor.view);
        this.floor = floor;
    }

    private clampBlockX(x: number): number {
        const halfWidth = this.config.blockWidth * 0.5;

        return Math.max(
            this.config.minBlockX + halfWidth,
            Math.min(this.config.maxBlockX - halfWidth, x),
        );
    }
}