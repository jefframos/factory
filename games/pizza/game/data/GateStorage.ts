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
//
// Also tracks per-gate DEPOSIT progress (`depositProgress`) — a RESOURCE-
// type GateRequirement is the one kind that ISN'T satisfied by a passive
// "already holding enough" check the way a building-level/item requirement
// is (see MilestoneRequirement.ts's own doc on why): it needs the player to
// actually walk up and drop the resource at a GateDropZone (see that file's
// own doc), same "deposit, don't just hold" convention BuildingZone's own
// upgrade ladder uses. Persisted separately from `unlockedIds` since a gate
// can have PARTIAL progress deposited without being unlocked yet.

import { Signal } from 'signals';
import PlatformHandler from 'core/platforms/PlatformHandler';
import { GateId } from './GateTypes';

const STORAGE_KEY = 'PIZZA_GATES';

interface GateSaveData {
    unlockedIds: GateId[];
    /** Keyed by gate id (string, not just GateId, so a stale entry from a since-removed gate id doesn't need special-casing to load). */
    depositProgress: Record<string, number>;
}

export class GateStorage {
    private static readonly unlockedIds = new Set<GateId>();
    private static readonly depositProgress = new Map<string, number>();

    /** Fires with the gate id that just got unlocked — see Gate.playUnlockSequence(). */
    static readonly onUnlock: Signal = new Signal();
    /** Fires with the gate id whenever its deposit progress changes — see GateDropZone.ts, the one thing that credits progress, and Gate.ts, which listens to keep its own icon panel current. */
    static readonly onDepositChanged: Signal = new Signal();

    /** Call once at boot (see index.ts), before anything reads isUnlocked()/getDepositProgress(). */
    static async load(): Promise<void> {
        try {
            const raw = await PlatformHandler.instance.platform.getItem(STORAGE_KEY);
            if (!raw) {
                return;
            }

            const parsed = JSON.parse(raw);
            // Tolerates the OLD save shape (a bare array of unlocked ids, from before
            // depositProgress existed) as well as the current `GateSaveData` object — a save
            // written before this field existed should just come back with empty progress,
            // not throw or drop the unlocked-gates list it DOES have.
            const unlockedIds: GateId[] = Array.isArray(parsed) ? parsed : (parsed.unlockedIds ?? []);
            const depositProgress: Record<string, number> = Array.isArray(parsed) ? {} : (parsed.depositProgress ?? {});

            for (const id of unlockedIds) {
                this.unlockedIds.add(id);
            }
            for (const [id, amount] of Object.entries(depositProgress)) {
                if (typeof amount === 'number' && amount > 0) {
                    this.depositProgress.set(id, amount);
                }
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

    /** How much `id` has had deposited toward its own resource requirement's amount so far — 0 if nothing's ever been deposited (or this gate has no resource requirement at all). */
    static getDepositProgress(id: string): number {
        return this.depositProgress.get(id) ?? 0;
    }

    /** Credits `amount` toward `id`'s deposit progress and persists — called once per landed icon by GateDropZone, same "storage mutates on ARRIVAL, not departure" convention every other deposit flow in this game follows. No-ops (returns 0) for a non-positive amount. */
    static addDepositProgress(id: string, amount: number): number {
        if (amount <= 0) {
            return 0;
        }

        this.depositProgress.set(id, this.getDepositProgress(id) + amount);
        this.onDepositChanged.dispatch(id);
        void this.persist();
        return amount;
    }

    private static async persist(): Promise<void> {
        const data: GateSaveData = {
            unlockedIds: Array.from(this.unlockedIds),
            depositProgress: Object.fromEntries(this.depositProgress),
        };
        await PlatformHandler.instance.platform.setItem(STORAGE_KEY, JSON.stringify(data));
    }

    /** Debug/dev reset — see the "Clear Gates" DevGuiManager button in PizzaScene.ts. Note this does NOT respawn any already-destroyed Gate entity this session; it only affects what the NEXT scene load spawns. */
    static async clearAll(): Promise<void> {
        this.unlockedIds.clear();
        this.depositProgress.clear();
        await PlatformHandler.instance.platform.removeItem(STORAGE_KEY);
    }
}
