import { FaceTowerBlock, FaceTowerConfig, TowerSettleResult } from "./FaceTowerTypes";

export class TowerStabilityController {
    private settledDuration = 0;
    private totalWaitDuration = 0;

    public constructor(
        private readonly config: FaceTowerConfig,
    ) { }

    public beginWaiting(): void {
        this.settledDuration = 0;
        this.totalWaitDuration = 0;
    }

    public update(
        deltaSeconds: number,
        blocks: readonly FaceTowerBlock[],
        deathWorldY: number,
    ): TowerSettleResult {
        this.totalWaitDuration += deltaSeconds;

        if (this.hasBlockFallen(blocks, deathWorldY)) {
            return 'failed';
        }

        if (this.areBlocksSettled(blocks)) {
            this.settledDuration += deltaSeconds;
        } else {
            this.settledDuration = 0;
        }

        if (
            this.settledDuration >=
            this.config.settleDuration
        ) {
            return 'stable';
        }

        if (
            this.totalWaitDuration >=
            this.config.maximumSettleDuration
        ) {
            return 'stable';
        }

        return 'waiting';
    }

    private areBlocksSettled(
        blocks: readonly FaceTowerBlock[],
    ): boolean {
        for (const block of blocks) {
            if (block.checkpointFrozen) {
                continue;
            }

            const body = block.entity.body;

            if (body.isSleeping) {
                continue;
            }

            if (
                body.speed >
                this.config.settleLinearSpeed
            ) {
                return false;
            }

            if (
                Math.abs(body.angularSpeed) >
                this.config.settleAngularSpeed
            ) {
                return false;
            }
        }

        return true;
    }

    private hasBlockFallen(
        blocks: readonly FaceTowerBlock[],
        deathWorldY: number,
    ): boolean {
        return blocks.some(block => {
            if (block.checkpointFrozen) {
                return false;
            }

            return (
                block.entity.body.position.y >
                deathWorldY
            );
        });
    }
}
