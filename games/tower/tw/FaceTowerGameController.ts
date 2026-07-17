// FaceTowerGameController.ts

import * as PIXI from 'pixi.js';
import { FaceTowerBlockController } from './FaceTowerBlockController';
import {
    FaceTowerInputController,
} from './FaceTowerInputController';
import {
    FaceTowerState,
    type FaceTowerConfig,
} from './FaceTowerTypes';
import { TowerCheckpointController } from './TowerCheckpointController';
import { TowerStabilityController } from './TowerStabilityController';

export interface FaceTowerGameEvents {
    onScoreChanged?(score: number): void;
    onCheckpointReached?(checkpoint: number): void;
    onGameOver?(score: number): void;
}

export class FaceTowerGameController {
    private readonly blocks: FaceTowerBlockController;
    private readonly stability: TowerStabilityController;
    private readonly checkpoints: TowerCheckpointController;
    private readonly input: FaceTowerInputController;

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

        this.blocks = new FaceTowerBlockController(
            worldRoot,
            config,
        );

        this.stability = new TowerStabilityController(config);

        this.checkpoints = new TowerCheckpointController(
            config.checkpointEvery,
            config.checkpointKeepBlocks,
        );

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

        this.score = 0;
        this.events.onScoreChanged?.(this.score);

        this.spawnNextBlock();
    }

    public update(delta: number): void {
        this.blocks.update(delta);

        if (this.state !== FaceTowerState.WaitingForTower) {
            return;
        }

        /*
         * Change this conversion if your engine already supplies milliseconds.
         *
         * Pixi commonly supplies a frame-based delta where approximately
         * 1 means one 60 Hz frame.
         */

        const result = this.stability.update(
            delta,
            this.blocks.getBlocks(),
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

    public getScore(): number {
        return this.score;
    }

    public destroy(): void {
        this.input.destroy();
        this.blocks.destroy();

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

        const checkpointResult = this.checkpoints.process(
            this.blocks,
        );

        if (checkpointResult.reached) {
            this.events.onCheckpointReached?.(
                checkpointResult.checkpoint,
            );

            /*
             * This is where you would also:
             *
             * - save the score;
             * - save the checkpoint;
             * - move the camera;
             * - discard or visually merge old tower blocks.
             */
        }

        this.spawnNextBlock();
    }

    private spawnNextBlock(): void {
        if (this.state === FaceTowerState.GameOver) {
            return;
        }

        this.blocks.spawnHeldBlock(this.targetX);
        this.state = FaceTowerState.MovingBlock;
    }

    private gameOver(): void {
        if (this.state === FaceTowerState.GameOver) {
            return;
        }

        this.state = FaceTowerState.GameOver;
        this.events.onGameOver?.(this.score);
    }
}