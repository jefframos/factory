// TowerZoneController.ts

import type { TowerZoneResult } from './FaceTowerTypes';

/**
 * Tracks the total-board-weight milestone the current zone must reach (see
 * FaceTowerBlockController.getTotalWeight) — once it's cleared, the caller
 * triggers a trapdoor (see TowerTrapdoorController) that drops the floor and
 * this hands back the next zone's own (higher) target weight.
 *
 * Same "one target + completeZone() advances it" shape the old world-Y
 * target-line version had — just weight instead of a screen height, since
 * the milestone that matters now is how much is sitting on the board, not
 * how tall the pile has climbed.
 */
export class TowerZoneController {
    private zoneIndex = 0;
    private targetWeight: number;

    public constructor(initialTargetWeight: number) {
        this.targetWeight = initialTargetWeight;
    }

    public getTargetWeight(): number {
        return this.targetWeight;
    }

    /** Zones completed so far — used as the piece-difficulty "level" (level = zoneIndex + 1) and (via TowerIslandProgression) island/sky progression. */
    public getZoneIndex(): number {
        return this.zoneIndex;
    }

    public hasReachedWeight(currentWeight: number): boolean {
        return currentWeight >= this.targetWeight;
    }

    public reset(initialTargetWeight: number): void {
        this.zoneIndex = 0;
        this.targetWeight = initialTargetWeight;
    }

    /** `nextTargetWeight` is the weight milestone the zone about to begin needs — see TowerLevelController, whose per-zone config drives this. */
    public completeZone(nextTargetWeight: number): TowerZoneResult {
        this.zoneIndex++;
        this.targetWeight = nextTargetWeight;

        return { zoneIndex: this.zoneIndex };
    }
}
