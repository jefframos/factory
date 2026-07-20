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
        private readonly zoneHeight: number,
        baseWorldY: number,
    ) {
        this.targetLineWorldY = baseWorldY - zoneHeight;
    }

    public getTargetLineWorldY(): number {
        return this.targetLineWorldY;
    }

    public hasReachedLine(topWorldY: number): boolean {
        return topWorldY <= this.targetLineWorldY;
    }

    public reset(baseWorldY: number): void {
        this.zoneIndex = 0;
        this.targetLineWorldY = baseWorldY - this.zoneHeight;
    }

    public completeZone(): TowerZoneResult {
        const lineWorldY = this.targetLineWorldY;

        this.zoneIndex++;
        this.targetLineWorldY = lineWorldY - this.zoneHeight;

        return {
            zoneIndex: this.zoneIndex,
            lineWorldY,
        };
    }
}
