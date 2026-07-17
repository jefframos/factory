// TowerCheckpointController.ts

import type { FaceTowerBlockController } from './FaceTowerBlockController';

export interface TowerCheckpointResult {
    reached: boolean;
    checkpoint: number;
    frozenBlocks: number;
}

export class TowerCheckpointController {
    private lastCheckpoint = 0;

    public constructor(
        private readonly checkpointEvery: number,
        private readonly keepDynamicBlocks: number,
    ) { }

    public process(
        blockController: FaceTowerBlockController,
    ): TowerCheckpointResult {
        const blocks = blockController.getBlocks();
        const completedBlocks = blocks.length;

        const checkpoint = Math.floor(
            completedBlocks / this.checkpointEvery,
        );

        if (
            checkpoint <= 0 ||
            checkpoint <= this.lastCheckpoint
        ) {
            return {
                reached: false,
                checkpoint: this.lastCheckpoint,
                frozenBlocks: 0,
            };
        }

        this.lastCheckpoint = checkpoint;

        const dynamicBlocks = blocks.filter(
            block => !block.checkpointFrozen,
        );

        const blocksToFreeze = Math.max(
            0,
            dynamicBlocks.length - this.keepDynamicBlocks,
        );

        for (let i = 0; i < blocksToFreeze; i++) {
            blockController.freezeBlock(dynamicBlocks[i]);
        }

        return {
            reached: true,
            checkpoint,
            frozenBlocks: blocksToFreeze,
        };
    }

    public reset(): void {
        this.lastCheckpoint = 0;
    }
}