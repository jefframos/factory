// SpotlightStorage.ts
//
// Which one-time camera spotlights (camera/SpotlightDirector.ts) the player has already seen — so
// each new thing is shown once per save, never again on a reload. Same "static class +
// PlatformHandler persistence" shape as TriggerStorage.ts. load() must be awaited at boot.

import PlatformHandler from 'core/platforms/PlatformHandler';

const STORAGE_KEY = 'PIZZA_SPOTLIGHTS';

export class SpotlightStorage {
    private static readonly seen = new Set<string>();

    static async load(): Promise<void> {
        try {
            const raw = await PlatformHandler.instance.platform.getItem(STORAGE_KEY);
            const parsed = raw ? JSON.parse(raw) : [];
            if (Array.isArray(parsed)) {
                for (const key of parsed) {
                    if (typeof key === 'string') {
                        this.seen.add(key);
                    }
                }
            }
        } catch (e) {
            console.error('SpotlightStorage: failed to load save data', e);
        }
    }

    static has(key: string): boolean {
        return this.seen.has(key);
    }

    static add(key: string): void {
        if (this.seen.has(key)) {
            return;
        }
        this.seen.add(key);
        void PlatformHandler.instance.platform.setItem(STORAGE_KEY, JSON.stringify([...this.seen]));
    }

    static async clearAll(): Promise<void> {
        this.seen.clear();
        await PlatformHandler.instance.platform.removeItem(STORAGE_KEY);
    }
}
