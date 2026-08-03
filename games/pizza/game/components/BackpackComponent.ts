// BackpackComponent.ts
//
// Carries gathered resources for the player — a total item cap (the design
// doc's "player starts with room for 5 items," upgradeable later) plus a
// per-resource-type count. Deliberately dumb: it doesn't know about
// gathering (AutoGatherController) or depositing (DropZone) — those just
// call add()/drainAll() on whichever entity has this component.

import Component from '../ecs/Component';
import { ResourceType } from '../actions/ResourceTypes';

export default class BackpackComponent extends Component {
    private capacity: number;
    private readonly counts = new Map<ResourceType, number>();

    public constructor(capacity: number = 5) {
        super();
        this.capacity = capacity;
    }

    public get totalCount(): number {
        let total = 0;
        for (const amount of this.counts.values()) {
            total += amount;
        }
        return total;
    }

    public get isFull(): boolean {
        return this.totalCount >= this.capacity;
    }

    public getCount(type: ResourceType): number {
        return this.counts.get(type) ?? 0;
    }

    /** Adds up to `amount` of `type`, clamped by remaining capacity — returns how much was actually added (0 if already full), since a caller may want to know a gather was wasted. */
    public add(type: ResourceType, amount: number): number {
        const room = this.capacity - this.totalCount;
        const added = Math.max(0, Math.min(amount, room));

        if (added > 0) {
            this.counts.set(type, this.getCount(type) + added);
        }

        return added;
    }

    /** Empties the backpack and returns everything it held — see DropZone, which deposits whatever this returns. */
    public drainAll(): Map<ResourceType, number> {
        const drained = new Map(this.counts);
        this.counts.clear();
        return drained;
    }

    /** Raises the total-item cap — see the design doc's carry-capacity upgrades (M4). */
    public upgradeCapacity(newCapacity: number): void {
        this.capacity = Math.max(this.capacity, newCapacity);
    }
}
