// RestaurantSave.ts
//
// What the player keeps: the day they're on, where they are (the restaurant, or the supermarket before it), the
// restaurant's stage and how full its bar is (coins: each stage's goal fills it and upgrades it to the next), and the
// day's orders (dealt ahead: the shopping list is made from them). One small entry kept
// through the platform (PlatformHandler's getItem / setItem — on YouTube Playables its cloud save) and in localStorage
// too (read at once; init() then takes the platform's). As Ant's AntSave.
//
// A restaurant day's coins are only saved when the day ends (a reload mid-day plays it again from its start).

import PlatformHandler from 'core/platforms/PlatformHandler';
import { Order, dealDay } from './Recipes';
import { isLastStage, stageSettings } from './Settings';

const KEY = 'restaurant.save';

export type Place = 'restaurant' | 'market';

interface SaveData {
    day: number;
    place: Place;
    stage: number;
    /** Coins in the stage's bar. */
    progress: number;
    orders: Order[];
}

/** A new player: day 1's orders (the kitchen's stocked for the first day). */
function fresh(): SaveData {
    return { day: 0, place: 'restaurant', stage: 0, progress: 0, orders: dealDay(0) };
}

function parse(text: string | null): SaveData {
    try {
        const saved = JSON.parse(text ?? 'null') as Partial<SaveData> | null;
        if (!saved || !Array.isArray(saved.orders)) return fresh();
        return {
            day: Math.max(0, Math.floor(saved.day ?? 0)),
            place: saved.place === 'market' ? 'market' : 'restaurant',
            stage: Math.max(0, Math.floor(saved.stage ?? 0)),
            progress: Math.max(0, Math.floor(saved.progress ?? 0)),
            orders: saved.orders,
        };
    } catch {
        return fresh();
    }
}

function localCopy(): string | null {
    try {
        return window.localStorage.getItem(KEY);
    } catch {
        return null;
    }
}

const state = parse(localCopy());

function save(): void {
    const text = JSON.stringify(state);
    try {
        window.localStorage.setItem(KEY, text);
    } catch {
        // No storage (private mode): the platform's copy, or this session only.
    }
    void PlatformHandler.instance.platform?.setItem(KEY, text).catch(() => undefined);
}

export const RestaurantSave = {
    /** Once the platform's up: its save, if it has one, is the one played. */
    async init(): Promise<void> {
        try {
            const text = await PlatformHandler.instance.platform?.getItem(KEY);
            if (!text) {
                if (localCopy()) save();
                return;
            }
            Object.assign(state, parse(text));
        } catch {
            // No platform storage: the browser's copy stands.
        }
    },

    get day(): number {
        return state.day;
    },

    get place(): Place {
        return state.place;
    },

    get stage(): number {
        return state.stage;
    },

    get progress(): number {
        return state.progress;
    },

    get orders(): Order[] {
        return state.orders.map((o) => ({ toppings: [...o.toppings] }));
    },

    /** Coins into the bar: each time it fills, the restaurant's upgraded (the rest carries on into the next bar; the last
     *  stage's just stays full). */
    addProgress(coins: number): void {
        state.progress += Math.max(0, Math.floor(coins));
        for (;;) {
            const goal = stageSettings(state.stage).goal;
            if (state.progress < goal) break;
            if (isLastStage(state.stage)) {
                state.progress = goal;
                break;
            }
            state.progress -= goal;
            state.stage++;
        }
        save();
    },

    /** The debug panel's jump to a stage (its bar empty). */
    setStage(stage: number): void {
        state.stage = Math.max(0, Math.floor(stage));
        state.progress = 0;
        save();
    },

    /** A day's over: its coins into the bar, the next day's orders dealt, and off to the supermarket. */
    endDay(earned: number): void {
        RestaurantSave.addProgress(earned);
        state.day++;
        state.orders = dealDay(state.day);
        state.place = 'market';
        save();
    },

    /** To the supermarket without ending the day (the debug panel's areas): the day's orders stay. */
    openMarket(): void {
        state.place = 'market';
        save();
    },

    /** Done shopping: the restaurant opens. */
    openRestaurant(): void {
        state.place = 'restaurant';
        save();
    },

    erase(): void {
        Object.assign(state, fresh());
        try {
            window.localStorage.removeItem(KEY);
        } catch {
            // No storage: nothing to erase.
        }
        void PlatformHandler.instance.platform?.removeItem(KEY).catch(() => undefined);
    },
};
