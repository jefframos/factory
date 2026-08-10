// GateStorage.ts
//
// Persisted set of gate ids that have already been unlocked — same static-
// class + Signal + PlatformHandler shape as BuildingStorage/BackpackStorage.
// This is the actual "game progression" record: a gate whose collider has
// been removed this session but never got persisted here would come back
// (and block the player again) on the next reload, exactly as if nothing
// had happened.
//
// load() must be awaited once at boot (see index.ts) before PizzaScene
// decides which gates to even spawn — see PizzaScene.setupGates(), which
// skips spawning a Gate entity at all for an id already unlocked (an
// already-cleared gate has no collider to block anything, so there's
// nothing for the entity to do).

import { Signal } from 'signals';
import PlatformHandler from 'core/platforms/PlatformHandler';
import { GateId } from './GateTypes';

const STORAGE_KEY = 'PIZZA_GATES';

export class GateStorage {
    private static readonly unlockedIds = new Set<GateId>();

    /** Fires with the gate id that just got unlocked — see Gate.playUnlockSequence(). */
    static readonly onUnlock: Signal = new Signal();

    /** Call once at boot (see index.ts), before anything reads isUnlocked(). */
    static async load(): Promise<void> {
        try {
            const raw = await PlatformHandler.instance.platform.getItem(STORAGE_KEY);
            const parsed: GateId[] = raw ? JSON.parse(raw) : [];
            for (const id of parsed) {
                this.unlockedIds.add(id);
            }
        } catch (e) {
            console.error('GateStorage: failed to load save data', e);
        }
    }

    static isUnlocked(id: GateId): boolean {
        return this.unlockedIds.has(id);
    }

    /** Marks `id` permanently unlocked and persists. Idempotent — returns false (no dispatch, no persist) if it was already unlocked, so a caller can call this unconditionally. */
    static unlock(id: GateId): boolean {
        if (this.unlockedIds.has(id)) {
            return false;
        }

        this.unlockedIds.add(id);
        this.onUnlock.dispatch(id);
        void this.persist();
        return true;
    }

    private static async persist(): Promise<void> {
        await PlatformHandler.instance.platform.setItem(STORAGE_KEY, JSON.stringify(Array.from(this.unlockedIds)));
    }

    /** Debug/dev reset — see the "Clear Gates" DevGuiManager button in PizzaScene.ts. Note this does NOT respawn any already-destroyed Gate entity this session; it only affects what the NEXT scene load spawns. */
    static async clearAll(): Promise<void> {
        this.unlockedIds.clear();
        await PlatformHandler.instance.platform.removeItem(STORAGE_KEY);
    }
}
