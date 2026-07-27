// TowerZoneController.ts

import type { TowerZoneResult } from './FaceTowerTypes';

/**
 * Tracks the target line the current base must be built up to. Once the
 * tallest block reaches it, the caller freezes everything below into a new
 * base placed exactly on that line, and this hands back the next line.
 */
export class TowerZoneController {
    private zoneIndex = 0;
    private targetLineWorldY: number;

    public constructor(
        initialZoneHeight: number,
        baseWorldY: number,
    ) {
        this.targetLineWorldY = baseWorldY - initialZoneHeight;
    }

    public getTargetLineWorldY(): number {
        return this.targetLineWorldY;
    }

    /** Zones completed so far — used as the piece-difficulty "level" (level = zoneIndex + 1). */
    public getZoneIndex(): number {
        return this.zoneIndex;
    }

    public hasReachedLine(topWorldY: number): boolean {
        return topWorldY <= this.targetLineWorldY;
    }

    public reset(baseWorldY: number, initialZoneHeight: number): void {
        this.zoneIndex = 0;
        this.targetLineWorldY = baseWorldY - initialZoneHeight;
    }

    /** `nextZoneHeight` is the world-space height (px) of the zone about to begin — see TowerLevelController, whose per-zone config drives this instead of a single fixed height. */
    public completeZone(nextZoneHeight: number): TowerZoneResult {
        const lineWorldY = this.targetLineWorldY;

        this.zoneIndex++;
        this.targetLineWorldY = lineWorldY - nextZoneHeight;

        return {
            zoneIndex: this.zoneIndex,
            lineWorldY,
        };
    }
}
