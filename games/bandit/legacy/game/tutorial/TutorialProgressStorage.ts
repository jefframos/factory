// TutorialProgressStorage.ts
//
// Persists ONLY the completed-step INDEX per zone (see ZoneTutorialTypes.ts/
// ZoneTutorialController.ts) — which PHASE the player is currently in (gather vs deliver,
// see ZoneTutorialController.resolvePhase()) is NEVER saved here; it's re-derived live from
// BackpackStorage's current count vs the current step's own required amount every time this
// loads. That's deliberate: a player who's already gathered enough of the resource before a
// reload should land right back on the deliver-phase arrow, not replay a gather arrow for
// something already sitting in their backpack.
//
// Same static-class + PlatformHandler persistence shape as PlayerPositionStorage.ts.
//
// load() must be awaited once at boot (see index.ts), before ZoneTutorialController reads
// getCompletedStepCount() for whatever zone the player starts in.

import PlatformHandler from 'core/platforms/PlatformHandler';

const STORAGE_KEY = 'PIZZA_TUTORIAL_PROGRESS';

export class TutorialProgressStorage {
    private static readonly completedByZone = new Map<number, number>();

    /** Call once at boot (see index.ts), before anything reads getCompletedStepCount(). */
    static async load(): Promise<void> {
        try {
            const raw = await PlatformHandler.instance.platform.getItem(STORAGE_KEY);
            if (!raw) {
                return;
            }
            const parsed: Record<string, number> = JSON.parse(raw);
            for (const [zoneNumber, count] of Object.entries(parsed)) {
                if (typeof count === 'number' && count > 0) {
                    this.completedByZone.set(Number(zoneNumber), count);
                }
            }
        } catch (e) {
            console.error('TutorialProgressStorage: failed to load save data', e);
        }
    }

    /** How many of `zoneNumber`'s tutorial steps are already completed — that same number also indexes the CURRENT step in ZONE_TUTORIAL_CONFIG[zoneNumber].steps (see ZoneTutorialTypes.ts's own doc). 0 if nothing's ever been saved for this zone. */
    static getCompletedStepCount(zoneNumber: number): number {
        return this.completedByZone.get(zoneNumber) ?? 0;
    }

    /** Overwrites the completed-step count for `zoneNumber` — fire-and-forget persist, same convention as every other *Storage.ts here. */
    static setCompletedStepCount(zoneNumber: number, count: number): void {
        this.completedByZone.set(zoneNumber, count);
        void this.persist();
    }

    private static async persist(): Promise<void> {
        const data: Record<string, number> = Object.fromEntries(this.completedByZone);
        await PlatformHandler.instance.platform.setItem(STORAGE_KEY, JSON.stringify(data));
    }

    /** Debug/dev reset — same convention as every other *Storage.ts's own clearAll(). */
    static async clearAll(): Promise<void> {
        this.completedByZone.clear();
        await PlatformHandler.instance.platform.removeItem(STORAGE_KEY);
    }
}
