// TowerDeadZoneController.ts

import Physics from 'core/phyisics/Physics';
import Pool from 'core/Pool';
import { CollisionLayer } from 'core/phyisics/core/CollisionLayer';
import { BoxEntity } from 'core/phyisics/entities/BoxEntity';
import { TriggerEntity } from 'core/phyisics/entities/TriggerEntity';
import { Body } from 'matter-js';
import * as PIXI from 'pixi.js';
import type { FaceTowerConfig } from './FaceTowerTypes';

/**
 * Containment for the current build column, laid out like:
 *
 *   [dead][ wall ][ open air ][ wall ][dead]
 *   [dead][ wall ][   base    ][ wall ][dead]
 *
 * Solid (non-sensor) walls flush against the base's edges keep blocks in
 * the column under normal play. The sensors beyond them — plus one under
 * the base — are a backstop: only reachable if something gets knocked past
 * a wall (e.g. a violent collapse), and touching one ends the run instantly.
 *
 * Rebuilt every time a new base is placed so everything tracks the column
 * the player is currently building in.
 */
export class TowerDeadZoneController {
    private walls: BoxEntity[] = [];
    private zones: TriggerEntity[] = [];
    private onHit?: () => void;

    public constructor(
        private readonly root: PIXI.Container,
        private readonly config: FaceTowerConfig,
    ) { }

    public setOnHit(callback: () => void): void {
        this.onHit = callback;
    }

    public getWalls(): readonly BoxEntity[] {
        return this.walls;
    }

    public rebuild(baseWorldY: number): void {
        this.clear();

        // Gap between the wall and its dead zone so Matter.js never reports
        // a collisionStart from mere contact between the two.
        const gap = 6;

        const halfFloor = this.config.floorWidth * 0.5;
        const wallWidth = this.config.wallWidth;
        const wallHeight = this.config.wallHeight;
        const zoneWidth = this.config.deadZoneWidth;

        const bottomOffset =
            this.config.deathScreenY - this.config.floorScreenY;

        // Flush with the base's top edge, extending upward — just enough
        // to bumper the first block or two off the base, not the full column.
        const wallCenterY =
            baseWorldY - this.config.floorHeight * 0.5 - wallHeight * 0.5;

        const wallLeftX =
            this.config.floorX - halfFloor - wallWidth * 0.5;
        const wallRightX =
            this.config.floorX + halfFloor + wallWidth * 0.5;

        this.createWall(wallLeftX, wallCenterY, wallWidth, wallHeight);
        this.createWall(wallRightX, wallCenterY, wallWidth, wallHeight);

        /*
         * Side sensors sit only at the base's own height, not the full
         * column — touching a wall higher up just means a block is leaning
         * on it while still resting on the stack, which is fine. Reaching
         * all the way down to base level beside the tower means it missed
         * the base entirely, regardless of the block's shape.
         */
        const zoneLeftX =
            wallLeftX - wallWidth * 0.5 - gap - zoneWidth * 0.5;
        const zoneRightX =
            wallRightX + wallWidth * 0.5 + gap + zoneWidth * 0.5;
        const sideZoneHeight = this.config.floorHeight + 60;

        this.createZone(zoneLeftX, baseWorldY, zoneWidth, sideZoneHeight);
        this.createZone(zoneRightX, baseWorldY, zoneWidth, sideZoneHeight);

        const bottomWidth =
            this.config.floorWidth +
            (wallWidth + gap + zoneWidth) * 2;

        this.createZone(
            this.config.floorX,
            baseWorldY + bottomOffset + gap,
            bottomWidth,
            40,
        );
    }

    private createWall(
        x: number,
        y: number,
        w: number,
        h: number,
    ): void {
        const wall = Pool.instance.getElement(BoxEntity) as BoxEntity;

        wall.build({
            w,
            h,
            layer: CollisionLayer.DEFAULT,
            debugColor: 0x3388ff,
        });

        wall.isStatic = true;
        Body.setStatic(wall.body, true);
        Body.setPosition(wall.body, { x, y });

        wall.body.friction = 0.4;
        wall.body.restitution = 0.05;

        wall.syncView();

        this.root.addChild(wall.view);
        this.walls.push(wall);
    }

    private createZone(
        x: number,
        y: number,
        w: number,
        h: number,
    ): void {
        const zone = Pool.instance.getElement(TriggerEntity) as TriggerEntity;

        zone.build({
            w,
            h,
            layer: CollisionLayer.DEFAULT,
        });

        Body.setStatic(zone.body, true);
        Body.setPosition(zone.body, { x, y });
        zone.syncView();

        const debugGraphic = zone.view.children[0] as PIXI.Graphics;

        if (debugGraphic) {
            debugGraphic.tint = 0xff3333;
        }

        this.root.addChild(zone.view);

        Physics.events.onStart(zone.body, otherBody => {
            // Ignore static bodies (bases, frozen blocks) — only a block
            // still actively falling/tipping should end the run.
            if (otherBody.isStatic) {
                return;
            }

            this.onHit?.();
        });

        this.zones.push(zone);
    }

    public clear(): void {
        for (const wall of this.walls) {
            wall.destroy();
        }

        this.walls.length = 0;

        for (const zone of this.zones) {
            zone.destroy();
        }

        this.zones.length = 0;
    }
}
