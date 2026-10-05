// BuildReveal.ts
//
// When a building's staged build animation (BuildingZone: walls rise, then the pieces sweep in
// — see BuildingZone.createBuildingMesh()) is still playing. Lets things that should only show
// up once the building is FINISHED wait for it without depending on BuildingZone itself — e.g.
// a Store stays closed (no cashier, storages or clients) until its starter's build is done.

const endsAtMs = new Map<string, number>();

export const BuildReveal = {
    /** `buildingId`'s staged build just started and runs `durationSec`. */
    start(buildingId: string, durationSec: number): void {
        endsAtMs.set(buildingId, performance.now() + durationSec * 1000);
    },

    /** Seconds left in `buildingId`'s staged build — 0 if none is playing. */
    remainingSec(buildingId: string): number {
        const endsAt = endsAtMs.get(buildingId);
        return endsAt === undefined ? 0 : Math.max(0, (endsAt - performance.now()) / 1000);
    },

    isRunning(buildingId: string): boolean {
        return this.remainingSec(buildingId) > 0;
    },
};
