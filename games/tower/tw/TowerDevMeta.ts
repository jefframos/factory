// TowerDevMeta.ts

/**
 * Dev-only persisted settings (see IslandViewScene.setupVisualDevGui()) —
 * saved to localStorage so render2D/render3D/speedup survive a page
 * reload instead of resetting to FaceTowerConfig's defaults every time,
 * which made iterating on visual/physics testing tedious.
 */
export interface TowerDevMeta {
    render2D: boolean;
    render3D: boolean;
    /** Whether the 2x speedup is on — see IslandViewScene's speedMultiplier. */
    speedup: boolean;
}

const STORAGE_KEY = 'tower.devMeta';

function getSafeLocalStorage(): Storage | null {
    try {
        return window.localStorage ?? null;
    } catch {
        // Storage can throw in some embedded/sandboxed contexts (e.g. some
        // platform webviews with cookies/storage disabled) — dev-only
        // persistence just silently no-ops rather than breaking the game.
        return null;
    }
}

/** Loads whatever's been saved — a partial object, since older saves may predate a newly added field. Returns null if nothing's saved yet, storage is unavailable, or the saved blob doesn't parse. */
export function loadTowerDevMeta(): Partial<TowerDevMeta> | null {
    const storage = getSafeLocalStorage();

    if (!storage) {
        return null;
    }

    const raw = storage.getItem(STORAGE_KEY);

    if (!raw) {
        return null;
    }

    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

/** Merges `patch` on top of whatever's already saved and persists the result — call whenever a dev toggle changes. */
export function saveTowerDevMeta(patch: Partial<TowerDevMeta>): void {
    const storage = getSafeLocalStorage();

    if (!storage) {
        return;
    }

    const merged = { ...loadTowerDevMeta(), ...patch };
    storage.setItem(STORAGE_KEY, JSON.stringify(merged));
}
