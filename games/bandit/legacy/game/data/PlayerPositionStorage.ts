// PlayerPositionStorage.ts
//
// Persists the last world position the player was confirmed standing on a
// STABLE tile — walkable (see TileWalkability.isWalkable()) AND with no
// resource node occupying it (see WorldManager.hasResourceAt()) — so a
// reload respawns the player there instead of back at the map's
// "playerStart" object every time. Same static-class + PlatformHandler
// persistence shape as BackpackStorage.ts/QueueStorage.ts.
//
// Deliberately NOT saved on every physics tick — PizzaScene.fixedUpdate()
// only calls save() every PLAYER_POSITION_CHECK_INTERVAL_SEC (see that
// constant's own doc), and only while the player's CURRENT position already
// passes the stable-tile check itself; a position mid-walk over water or
// standing on a tree stays un-persisted, so this can never save somewhere
// the player couldn't actually stand.
//
// load() must be awaited once at boot (see index.ts), before PizzaScene's
// constructor reads getPosition() to decide where to place the player.

import PlatformHandler from 'core/platforms/PlatformHandler';

const STORAGE_KEY = 'PIZZA_PLAYER_POSITION';

interface StoredPosition {
    x: number;
    z: number;
}

export class PlayerPositionStorage {
    private static position: StoredPosition | undefined;

    /** Call once at boot (see index.ts), before anything reads getPosition(). */
    static async load(): Promise<void> {
        try {
            const raw = await PlatformHandler.instance.platform.getItem(STORAGE_KEY);
            if (!raw) {
                return;
            }
            const parsed = JSON.parse(raw);
            if (typeof parsed?.x === 'number' && typeof parsed?.z === 'number') {
                this.position = { x: parsed.x, z: parsed.z };
            }
        } catch (e) {
            console.error('PlayerPositionStorage: failed to load save data', e);
        }
    }

    /** The last known-stable position, or undefined if none has ever been saved (a brand-new save, or one from before this feature existed) — callers should fall back to their own default spawn (e.g. the map's "playerStart" object) in that case. */
    static getPosition(): StoredPosition | undefined {
        return this.position;
    }

    /** Overwrites the saved position — see this file's own doc on when PizzaScene actually calls this (only once the CURRENT position has already passed the stable-tile check). Fire-and-forget, same convention as every other *Storage.ts here. */
    static save(x: number, z: number): void {
        this.position = { x, z };
        void this.persist();
    }

    private static async persist(): Promise<void> {
        if (!this.position) {
            return;
        }
        await PlatformHandler.instance.platform.setItem(STORAGE_KEY, JSON.stringify(this.position));
    }

    /** Debug/dev reset — see other *Storage.ts's own clearAll(). */
    static async clearAll(): Promise<void> {
        this.position = undefined;
        await PlatformHandler.instance.platform.removeItem(STORAGE_KEY);
    }
}
