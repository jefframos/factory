// CarryStack.ts
//
// Runtime bookkeeping for the player's carry stack — the farm items piled in
// the backpack (see BackpackStackVisual.ts). Three numbers decide whether
// something can be collected:
//
//   carried    — farm-category units already in BackpackStorage (the stack itself)
//   in flight  — items launched toward the stack but not landed yet (see
//                FlyToStack.ts); they already count, or a burst of harvests
//                could overshoot the limit before the first one lands
//   capacity   — BackpackCapacityStorage.getCapacity() (upgradeable, starts at 3)
//
// Flights are tracked in launch order so each one knows WHICH stack slot it's
// heading for (see flightIndex()) — the Nth in-flight item aims N slots above
// the current top, so a burst lands as a neat column instead of all converging
// on one spot.

import * as PIXI from 'pixi.js';
import { BackpackStorage } from '../data/BackpackStorage';
import { BackpackCapacityStorage } from '../data/BackpackCapacityStorage';
import { RESOURCE_CONFIG, ResourceType } from '../actions/ResourceTypes';
import type MainPlayer from './MainPlayer';
import PlayerNotificationComponent from '../components/PlayerNotificationComponent';

/** Backpack icon shown in the "stack is full" balloon — same texture BackpackButton uses. */
const FULL_ICON_TEXTURE = 'survival-backpack';
/** Minimum gap between two "stack is full" balloons — the farm checks every frame while the player stands on a ready crop, so this is what stops it re-popping constantly. */
const FULL_NOTIFY_COOLDOWN_MS = 1500;

let nextFlightId = 1;
const flights: number[] = [];
let lastFullNotifyMs = -Infinity;

export const CarryStack = {
    /** Farm-category units currently in BackpackStorage — what the stack visibly holds. */
    carriedCount(): number {
        let total = 0;
        for (const type of Object.values(ResourceType)) {
            if (RESOURCE_CONFIG[type]?.category === 'farm') {
                total += BackpackStorage.getCount(type);
            }
        }
        return total;
    },

    capacity(): number {
        return BackpackCapacityStorage.getCapacity();
    },

    /** Room left right now, counting items already in flight. Can be negative (e.g. a save carrying more than today's capacity). */
    freeSlots(): number {
        return this.capacity() - this.carriedCount() - flights.length;
    },

    hasRoomFor(amount: number): boolean {
        return this.freeSlots() >= amount;
    },

    /** Reserves one slot for an item about to fly — pair with endFlight() once it lands (or is abandoned). Returns the flight's id. */
    beginFlight(): number {
        const id = nextFlightId++;
        flights.push(id);
        return id;
    },

    endFlight(id: number): void {
        const index = flights.indexOf(id);
        if (index !== -1) {
            flights.splice(index, 1);
        }
    },

    /** 0 for the oldest still-flying item, 1 for the next, ... — see this file's own doc. -1 if `id` isn't in flight. */
    flightIndex(id: number): number {
        return flights.indexOf(id);
    },

    /** Pops the "!" + backpack balloon over the player's head — rate-limited (see FULL_NOTIFY_COOLDOWN_MS). */
    notifyFull(player: MainPlayer): void {
        const now = performance.now();
        if (now - lastFullNotifyMs < FULL_NOTIFY_COOLDOWN_MS) {
            return;
        }
        lastFullNotifyMs = now;
        player.getComponent(PlayerNotificationComponent)?.showBlocked(PIXI.Texture.from(FULL_ICON_TEXTURE));
    },
};
