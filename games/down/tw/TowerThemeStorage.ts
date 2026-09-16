// TowerThemeStorage.ts

import PlatformHandler from 'core/platforms/PlatformHandler';
import { isGameThemeId, type GameThemeId } from './GameThemeStorage';

const KEY = 'TOWER_LAST_THEME';

/**
 * Persists whichever level (see GameThemeStorage.GameThemeId — 'cats'/
 * 'dogs'/'penguin' today) the player last played, so the NEXT boot opens
 * straight into that level instead of always defaulting to 'cats' — see
 * IslandViewScene's build() (initialThemeId resolution) and
 * handleThemeToggle() (which saves here on every switch). Independent of
 * TowerDevMeta's own themeId field, which is dev-only and takes priority
 * over this for a dev session specifically.
 */
export class TowerThemeStorage {
    private static cached: GameThemeId | null = null;

    /** Call once at boot, before build() resolves its initial theme — see index.ts's loadAssets(), alongside GemStorage.load(). */
    static async load(): Promise<void> {
        try {
            const raw = await PlatformHandler.instance.platform.getItem(KEY);
            this.cached = isGameThemeId(raw) ? raw : null;
        } catch (e) {
            console.error('TowerThemeStorage: failed to load', e);
            this.cached = null;
        }
    }

    /** Null if nothing's ever been saved (a fresh install) — callers fall back to the real default ('cats') themselves. */
    static get(): GameThemeId | null {
        return this.cached;
    }

    static save(themeId: GameThemeId): void {
        this.cached = themeId;
        void PlatformHandler.instance.platform.setItem(KEY, themeId);
    }

    static async clearAll(): Promise<void> {
        this.cached = null;
        await PlatformHandler.instance.platform.removeItem(KEY);
    }
}
