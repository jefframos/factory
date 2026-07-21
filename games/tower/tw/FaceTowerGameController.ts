// FaceTowerGameController.ts

import * as PIXI from 'pixi.js';
import { FaceTowerBlockController } from './FaceTowerBlockController';
import {
    FaceTowerInputController,
} from './FaceTowerInputController';
import {
    FaceTowerState,
    type FaceTowerBlock,
    type FaceTowerConfig,
} from './FaceTowerTypes';
import { PieceManager } from './PieceManager';
import type { PieceDefinition } from './PieceStorage';
import { TowerCameraController } from './TowerCameraController';
import { TowerDeadZoneController } from './TowerDeadZoneController';
import { TowerStabilityController } from './TowerStabilityController';
import { TowerZoneController } from './TowerZoneController';

export interface FaceTowerGameEvents {
    onScoreChanged?(score: number): void;
    onMilestoneReached?(zoneIndex: number): void;
    onGameOver?(score: number): void;
}

export class FaceTowerGameController {
    private readonly camera: TowerCameraController;
    private readonly blocks: FaceTowerBlockController;
    private readonly stability: TowerStabilityController;
    private readonly zones: TowerZoneController;
    private readonly deadZones: TowerDeadZoneController;
    private readonly pieces: PieceManager;
    private readonly input: FaceTowerInputController;
    private readonly targetLine: PIXI.Graphics;

    private state = FaceTowerState.Initialising;
    private score = 0;

    private targetX: number;

    public constructor(
        worldRoot: PIXI.Container,
        overlayRoot: PIXI.Container,
        coordinateRoot: PIXI.Container,
        private readonly config: FaceTowerConfig,
        private readonly events: FaceTowerGameEvents = {},
    ) {
        this.targetX =
            (config.minBlockX + config.maxBlockX) * 0.5;

        this.camera = new TowerCameraController(
            worldRoot,
            config.cameraPanSpeed,
        );

        this.blocks = new FaceTowerBlockController(
            worldRoot,
            config,
            this.camera,
        );

        this.stability = new TowerStabilityController(config);

        this.zones = new TowerZoneController(
            config.zoneHeight,
            config.floorY,
        );

        this.pieces = new PieceManager();
        this.pieces.build();

        this.deadZones = new TowerDeadZoneController(
            worldRoot,
            config,
        );

        this.deadZones.setOnHit(() => this.gameOver());

        this.targetLine = new PIXI.Graphics();
        worldRoot.addChild(this.targetLine);
        this.drawTargetLine(this.zones.getTargetLineWorldY());

        this.input = new FaceTowerInputController(
            overlayRoot,
            coordinateRoot,
            {
                onMove: x => this.moveBlock(x),
                onRelease: () => this.dropBlock(),
            },
        );
    }

    public start(): void {
        this.blocks.initialise();
        this.deadZones.rebuild(this.config.floorY);

        this.score = 0;
        this.events.onScoreChanged?.(this.score);

        this.spawnNextBlock();
    }

    /** Tears the run down and starts a brand-new tower from scratch. */
    public reset(): void {
        this.blocks.destroy();
        this.deadZones.clear();
        this.camera.reset();
        this.zones.reset(this.config.floorY);

        this.state = FaceTowerState.Initialising;

        this.drawTargetLine(this.zones.getTargetLineWorldY());
        this.start();
    }

    public update(delta: number): void {
        this.camera.update(delta);
        this.blocks.update(delta);

        if (this.state === FaceTowerState.PanningCamera) {
            if (!this.camera.isPanning()) {
                this.spawnNextBlock();
            }

            return;
        }

        if (this.state !== FaceTowerState.WaitingForTower) {
            return;
        }

        /*
         * Change this conversion if your engine already supplies milliseconds.
         *
         * Pixi commonly supplies a frame-based delta where approximately
         * 1 means one 60 Hz frame.
         */

        const deathWorldY = this.camera.toWorldY(
            this.config.deathScreenY,
        );

        const result = this.stability.update(
            delta,
            this.blocks.getBlocks(),
            deathWorldY,
        );

        if (result === 'failed') {
            this.gameOver();
            return;
        }

        if (result === 'stable') {
            this.completeTurn();
        }
    }

    public resizeInput(
        x: number,
        y: number,
        width: number,
        height: number,
    ): void {
        this.input.resize(x, y, width, height);
    }

    public getState(): FaceTowerState {
        return this.state;
    }

    /** How far (design-space px) the 2D camera has scrolled — for pairing a 3D camera to it. */
    public getCameraOffsetY(): number {
        return this.camera.getOffsetY();
    }

    /** Live physics blocks — for mirroring each one as a 3D cube. */
    public getBlocks(): readonly FaceTowerBlock[] {
        return this.blocks.getBlocks();
    }

    /** Every base placed so far (the original floor plus one per completed zone). */
    public getBases() {
        return this.blocks.getBases();
    }

    /** The side containment poles for the current zone — see TowerDeadZoneController. */
    public getWalls() {
        return this.deadZones.getWalls();
    }

    public getScore(): number {
        return this.score;
    }

    /** Call after changing block size/bevel/stroke config at runtime — see FaceTowerBlockController.invalidateBodyTexture(). */
    public invalidateBlockTexture(): void {
        this.blocks.invalidateBodyTexture();
    }

    /**
     * Dev-only: swaps whatever's currently hovering over the drop area for
     * `piece` — a no-op unless a block is actually being held (i.e. the
     * player hasn't already dropped it), since there's nothing to replace
     * otherwise. See IslandViewScene.setupPieceDevGui.
     */
    public replaceHeldBlockWithPiece(piece: PieceDefinition): void {
        if (this.state !== FaceTowerState.MovingBlock) {
            return;
        }

        this.blocks.discardHeldBlock();
        this.blocks.spawnHeldBlock(this.targetX, piece);
    }

    public destroy(): void {
        this.input.destroy();
        this.blocks.destroy();
        this.deadZones.clear();

        this.targetLine.removeFromParent();
        this.targetLine.destroy();

        this.state = FaceTowerState.GameOver;
    }

    private moveBlock(x: number): void {
        if (this.state !== FaceTowerState.MovingBlock) {
            return;
        }

        this.targetX = x;
        this.blocks.moveHeldBlock(x);
    }

    private dropBlock(): void {
        if (this.state !== FaceTowerState.MovingBlock) {
            return;
        }

        const releasedBlock = this.blocks.releaseHeldBlock();

        if (!releasedBlock) {
            return;
        }

        this.state = FaceTowerState.DroppingBlock;

        /*
         * DroppingBlock immediately becomes WaitingForTower.
         * Keeping the two states separate makes it easy to add:
         *
         * - a release animation;
         * - sound effects;
         * - a short input lock;
         * - block face animation.
         */
        this.beginTowerWait();
    }

    private beginTowerWait(): void {
        this.state = FaceTowerState.WaitingForTower;
        this.stability.beginWaiting();
    }

    private completeTurn(): void {
        this.score++;
        this.events.onScoreChanged?.(this.score);

        const topWorldY = this.blocks.getHighestTopWorldY();

        if (this.zones.hasReachedLine(topWorldY)) {
            const result = this.zones.completeZone();

            /*
             * Everything built so far becomes the permanent base, and a
             * fresh floor is placed exactly on the line it just reached —
             * the tower effectively restarts on top of its own progress.
             */
            this.blocks.freezeAll();
            this.blocks.addBase(result.lineWorldY);
            this.deadZones.rebuild(result.lineWorldY);

            const newOffsetY =
                this.config.floorScreenY - result.lineWorldY;

            this.camera.panTo(newOffsetY);
            this.drawTargetLine(this.zones.getTargetLineWorldY());

            this.events.onMilestoneReached?.(result.zoneIndex);

            /*
             * Held block spawns only once the pan finishes, so it never
             * appears mid-scroll. See PanningCamera handling in update().
             */
            this.state = FaceTowerState.PanningCamera;
            return;
        }

        this.spawnNextBlock();
    }

    private spawnNextBlock(): void {
        if (this.state === FaceTowerState.GameOver) {
            return;
        }

        const level = this.zones.getZoneIndex() + 1;
        const piece = this.pieces.getPieceForLevel(level);

        this.blocks.spawnHeldBlock(this.targetX, piece);
        this.state = FaceTowerState.MovingBlock;
    }

    private gameOver(): void {
        if (this.state === FaceTowerState.GameOver) {
            return;
        }

        this.state = FaceTowerState.GameOver;
        this.events.onGameOver?.(this.score);
    }

    private drawTargetLine(worldY: number): void {
        const halfWidth = this.config.floorWidth * 0.5;
        const startX = this.config.floorX - halfWidth;
        const endX = this.config.floorX + halfWidth;

        const dash = 14;
        const gap = 8;

        this.targetLine.clear();
        this.targetLine.lineStyle(3, 0xffe066, 0.9);

        for (let x = startX; x < endX; x += dash + gap) {
            const segmentEnd = Math.min(x + dash, endX);

            this.targetLine
                .moveTo(x, worldY)
                .lineTo(segmentEnd, worldY);
        }
    }
}
