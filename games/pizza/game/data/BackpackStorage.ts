// BackpackStorage.ts
//
// Global, entity-independent backpack — replaces the old per-entity
// BackpackComponent. "Global game data" the same way ShopStorage/
// HighScoreStorage are: a static class, not something living on MainPlayer,
// so anything (AutoGatherController when gathering, DropZone when
// depositing, BackpackUI when rendering) reads/writes the SAME state without
// needing a reference to the player entity. Observable via onChange (a
// Signal, same convention as ShopStorage.onEquipChanged) — BackpackUI
// subscribes once and updates only the slot whose resource actually
// changed, instead of polling every frame.
//
// No per-type cap for now (removed — re-add one here first if a cap comes
// back later; nothing else needs to change). removeOne() is what DropZone
// calls per-unit as resources fly out to the drop zone over time (see
// DropZone.ts) — depositing is gradual, not an instant drainAll().

import { Signal } from 'signals';
import { ResourceType } from '../actions/ResourceTypes';

export class BackpackStorage {
    private static readonly counts = new Map<ResourceType, number>();

    /** Fires with the resource type whose count just changed — see this file's own doc. */
    static readonly onChange: Signal = new Signal();

    static getCount(type: ResourceType): number {
        return this.counts.get(type) ?? 0;
    }

    /** Snapshot of every currently-nonzero count — see DropZone.tryDeposit(). */
    static getAll(): Map<ResourceType, number> {
        return new Map(this.counts);
    }

    /** Adds `amount` — returns it unchanged (no cap right now, see this file's own doc); kept as a return value so callers don't need to change if a cap comes back. */
    static add(type: ResourceType, amount: number): number {
        if (amount <= 0) {
            return 0;
        }

        this.counts.set(type, this.getCount(type) + amount);
        this.onChange.dispatch(type);
        return amount;
    }

    /** Removes exactly one, if any remain — see DropZone.ts's per-chip drain. Returns false (no-op) once already at 0. */
    static removeOne(type: ResourceType): boolean {
        const current = this.getCount(type);
        if (current <= 0) {
            return false;
        }

        this.counts.set(type, current - 1);
        this.onChange.dispatch(type);
        return true;
    }

    /** Empties everything at once and returns what it held — see DropZone.tryDeposit()'s fallback for when there's no loaded backpack cube to animate a gradual drain from (e.g. the FBX character hasn't finished loading yet). Prefer removeOne() for the normal animated path. */
    static drainAll(): Map<ResourceType, number> {
        const drained = this.getAll();
        this.clearAll();
        return drained;
    }

    /** Test/dev hook — wipes every count back to empty and notifies subscribers. */
    static clearAll(): void {
        for (const type of this.counts.keys()) {
            this.counts.set(type, 0);
            this.onChange.dispatch(type);
        }
        this.counts.clear();
    }
}
