// SaveStorage.ts
//
// Where a game keeps its save: the platform's own storage (PlatformHandler's setItem/getItem), read once at boot and kept
// here, so the game reads and writes at once, as with localStorage. Never localStorage itself: YouTube Playables throws it
// away (only what goes through its SDK is kept), so a game saving there loses everything there but its mute setting.
//
// Boot: after PlatformHandler.initialize(), `await SaveStorage.load(keys)`, then have whatever read its save as it was
// imported read it again (a module reading before load() gets the browser's, which on YouTube is nothing).

import PlatformHandler from './PlatformHandler';

const cache = new Map<string, string>();
let loaded = false;

/** The browser's own copy (a save from before it went through the platform; where there's no platform yet). */
function local(key: string): string | null {
    try {
        return window.localStorage.getItem(key);
    } catch {
        return null;
    }
}

export const SaveStorage = {
    /** Reads these keys from the platform. One it hasn't got is taken from the browser, if it's there (and is moved over with the next save). */
    async load(keys: readonly string[]): Promise<void> {
        await Promise.all(keys.map(async (key) => {
            let value: string | null = null;
            try {
                value = (await PlatformHandler.instance.platform?.getItem(key)) ?? null;
            } catch (error) {
                console.warn('[SaveStorage] could not read', key, error);
            }
            value ??= local(key);
            if (value !== null) cache.set(key, value);
        }));
        loaded = true;
    },

    getItem(key: string): string | null {
        return cache.get(key) ?? (loaded ? null : local(key));
    },

    setItem(key: string, value: string): void {
        cache.set(key, value);
        try {
            const written = PlatformHandler.instance.platform?.setItem(key, value) as Promise<void> | undefined;
            written?.catch?.((error: unknown) => console.warn('[SaveStorage] could not save', key, error));
        } catch (error) {
            console.warn('[SaveStorage] could not save', key, error);
        }
    },

    removeItem(key: string): void {
        cache.delete(key);
        try {
            const removed = PlatformHandler.instance.platform?.removeItem(key) as Promise<void> | undefined;
            removed?.catch?.(() => undefined);
        } catch {
            // Nothing to remove it from.
        }
        try {
            window.localStorage.removeItem(key);
        } catch {
            // No browser storage.
        }
    },

    /** `save` runs whenever the game may be about to go: the page hidden or closed, or the platform pausing it. Call once. */
    saveOnLeave(save: () => void): void {
        window.addEventListener('pagehide', save);
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) save();
        });
        PlatformHandler.instance.onPause.add(save);
    },
};
