// GarbageCarryStorage.ts
//
// What each piece of garbage on the player's back WAS — the original item
// types, bottom to top. BackpackStorage only counts ResourceType.Garbage (what
// the trash takes, what fills a stack slot); this list is what lets the back
// stack keep drawing each piece as the darkened item it was picked up as (see
// CarrierStackVisual's displayFor, ItemPileLayout.displayFor) instead of
// switching to a generic garbage model.
//
// push() right BEFORE BackpackStorage.add(Garbage) (see Store's garbage
// pickup). Removals need no call: whenever the backpack's garbage count drops
// (the trash taking one, a clear), the list trims its top to match — the
// topmost garbage is always what leaves first.
//
// Same static-class + PlatformHandler shape as the other *Storage.ts files;
// load() is awaited at boot (index.ts), after BackpackStorage.

import PlatformHandler from 'core/platforms/PlatformHandler';
import { ResourceType } from '../actions/ResourceTypes';
import { BackpackStorage } from './BackpackStorage';

const STORAGE_KEY = 'PIZZA_GARBAGE_CARRY';

/** Multiplier on every material color of a garbage item — "slightly darker" than the fresh one, on the floor and on the back alike. */
export const GARBAGE_DARKEN = 0.55;

export class GarbageCarryStorage {
    private static readonly types: ResourceType[] = [];
    private static listening = false;

    static async load(): Promise<void> {
        try {
            const raw = await PlatformHandler.instance.platform.getItem(STORAGE_KEY);
            const parsed: unknown = raw ? JSON.parse(raw) : [];
            if (Array.isArray(parsed)) {
                this.types.push(...parsed.filter((type): type is ResourceType => typeof type === 'string'));
            }
        } catch (e) {
            console.error('GarbageCarryStorage: failed to load save data', e);
        }
        this.trim();
        if (!this.listening) {
            this.listening = true;
            BackpackStorage.onChange.add((type: ResourceType) => {
                if (type === ResourceType.Garbage) {
                    this.trim();
                }
            });
        }
    }

    /**
     * What the `ordinal`-th carried garbage piece (0 = bottom) was — undefined if unknown (drawn as
     * the plain garbage model). The list is aligned to the TOP of the stack: with more garbage carried
     * than the list knows about (e.g. picked up before this list existed), the unknown pieces are the
     * bottom ones, so every newly picked-up piece still finds its own entry.
     */
    static getAt(ordinal: number): ResourceType | undefined {
        const unknownBelow = Math.max(0, BackpackStorage.getCount(ResourceType.Garbage) - this.types.length);
        return ordinal >= unknownBelow ? this.types[ordinal - unknownBelow] : undefined;
    }

    /** What the topmost carried garbage piece was — the next one to leave. */
    static peekTop(): ResourceType | undefined {
        return this.types[this.types.length - 1];
    }

    /** One more piece on top — call right before BackpackStorage.add(ResourceType.Garbage, 1). */
    static push(type: ResourceType): void {
        this.types.push(type);
        void this.persist();
    }

    static async clearAll(): Promise<void> {
        this.types.length = 0;
        await PlatformHandler.instance.platform.removeItem(STORAGE_KEY);
    }

    /** Drops pieces off the top until the list is no longer than the backpack's garbage count. */
    private static trim(): void {
        const count = BackpackStorage.getCount(ResourceType.Garbage);
        if (this.types.length <= count) {
            return;
        }
        this.types.length = count;
        void this.persist();
    }

    private static async persist(): Promise<void> {
        await PlatformHandler.instance.platform.setItem(STORAGE_KEY, JSON.stringify(this.types));
    }
}
