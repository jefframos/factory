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
import { Order, dealDay, pizzaFromSave } from './Recipes';
import { SETTINGS, isLastStage, stageSettings } from './Settings';
import { hasIceCreamMachine, hasPizzaOven, hasSundaeBar } from '../world/RestaurantLayout';

const KEY = 'restaurant.save';

/** Where the player is: cooking, delivering pizzas (after a day with the pizza oven), or shopping for the next day. */
export type Place = 'restaurant' | 'phone' | 'delivery' | 'market';

interface SaveData {
    day: number;
    place: Place;
    stage: number;
    /** Days played at this stage (0: its first day: settings.json stages[].firstDay). */
    stageDay: number;
    /** Coins in the stage's bar. */
    progress: number;
    orders: Order[];
    /** Whether they've served an ice cream right yet (till then, a hand shows each step at the machine). */
    iceCreamLearned?: boolean;
    /** The same for a pizza (a hand at each step at the oven). */
    pizzaLearned?: boolean;
    /** The same for a sundae (a hand at each step at the sundae bar). */
    sundaeLearned?: boolean;
    /** Ingredients and dishes the player's been shown (a ticket marks the others NEW! the first time). */
    seen?: string[];
    /** Whether they've finished a phone-orders session (its step hints stop then). */
    phoneLearned?: boolean;
}

/** How much of stage `stage`'s bar coins past a full bar may fill (settings.json carryOver). */
export function carryRoom(stage: number): number {
    const share = SETTINGS.carryOver;
    return share === undefined ? Infinity : Math.floor(Math.max(0, share) * stageSettings(stage).goal);
}

/** A new player: day 1's orders (the kitchen's stocked for the first day). */
function fresh(): SaveData {
    return { day: 0, place: 'restaurant', stage: 0, stageDay: 0, progress: 0, orders: dealFor(0, 0, 0) };
}

/** Day `day`'s orders, at `stage`'s `stageDay`-th day: its first day can ask for its own number of customers. */
function dealFor(day: number, stage: number, stageDay: number): Order[] {
    // Ice cream once the stage's room has its machine, pizza once it has its oven: from its second day (its first
    // teaches what's new about it).
    // A dish new at this stage (its station wasn't in the last stage's room) is shown on its first day too: one order.
    const introduce = stageDay === 0 && stage > 0
        ? ([['iceCream', hasIceCreamMachine], ['pizza', hasPizzaOven], ['sundae', hasSundaeBar]] as const).filter(([, has]) => has(stage) && !has(stage - 1)).map(([dish]) => dish)
        : [];
    return dealDay(day, stage, stageDay === 0 ? stageSettings(stage).firstDay?.customers : undefined, stageDay > 0 && hasIceCreamMachine(stage), stageDay > 0 && hasPizzaOven(stage), stageDay > 0 && hasSundaeBar(stage), introduce);
}

function parse(text: string | null): SaveData {
    try {
        const saved = JSON.parse(text ?? 'null') as Partial<SaveData> | null;
        if (!saved || !Array.isArray(saved.orders)) return fresh();
        return {
            day: Math.max(0, Math.floor(saved.day ?? 0)),
            place: saved.place === 'market' || saved.place === 'delivery' || saved.place === 'phone' ? saved.place : 'restaurant',
            stage: Math.max(0, Math.floor(saved.stage ?? 0)),
            stageDay: Math.max(0, Math.floor(saved.stageDay ?? 0)),
            progress: Math.max(0, Math.floor(saved.progress ?? 0)),
            orders: saved.orders,
            iceCreamLearned: saved.iceCreamLearned === true,
            pizzaLearned: saved.pizzaLearned === true,
            sundaeLearned: saved.sundaeLearned === true,
            phoneLearned: saved.phoneLearned === true,
            seen: Array.isArray(saved.seen) ? saved.seen.filter((s): s is string => typeof s === 'string') : [],
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

    /** Days played at this stage (0: its first). */
    get stageDay(): number {
        return state.stageDay;
    },

    get progress(): number {
        return state.progress;
    },

    get iceCreamLearned(): boolean {
        return state.iceCreamLearned === true;
    },

    /** An ice cream served right: no more hints at the machine. */
    learnIceCream(): void {
        if (state.iceCreamLearned) return;
        state.iceCreamLearned = true;
        save();
    },

    get pizzaLearned(): boolean {
        return state.pizzaLearned === true;
    },

    /** Whether they've done a phone-orders session (till then, the hand shows each step there, pizza learned or not). */
    get phoneLearned(): boolean {
        return state.phoneLearned === true;
    },

    /** The first phone orders all boxed: no more step hints there. */
    learnPhone(): void {
        if (state.phoneLearned) return;
        state.phoneLearned = true;
        save();
    },

    /** A pizza served right: no more hints at the oven. */
    learnPizza(): void {
        if (state.pizzaLearned) return;
        state.pizzaLearned = true;
        save();
    },

    get orders(): Order[] {
        // (A pizza saved as its old kind — 'pepperoni' — comes back as its toppings.)
        return state.orders.map((o) => {
            const pizza = pizzaFromSave(o.pizza);
            return {
                toppings: [...o.toppings],
                ...(o.iceCream ? { iceCream: o.iceCream } : {}),
                ...(pizza ? { pizza } : {}),
                ...(o.sundae ? { sundae: { ...o.sundae, scoops: [...o.sundae.scoops], toppings: [...o.sundae.toppings] } } : {}),
            };
        });
    },

    /** Whether the player's been shown `key` (an ingredient, a dish) before. */
    hasSeen(key: string): boolean {
        return (state.seen ?? []).includes(key);
    },

    /** `keys` shown now (the next time, no NEW!). */
    markSeen(keys: readonly string[]): void {
        const seen = new Set(state.seen ?? []);
        const before = seen.size;
        keys.forEach((k) => seen.add(k));
        if (seen.size === before) return;
        state.seen = [...seen];
        save();
    },

    /** Today's orders, corrected (the restaurant found some its kitchen can't make). */
    replaceOrders(orders: readonly Order[]): void {
        state.orders = orders.map((o) => ({ ...o, toppings: [...o.toppings] }));
        save();
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
            // Past the goal: into the next stage's bar, only as much as settings.json carryOver lets (0: none).
            const left = state.progress - goal;
            state.stage++;
            state.stageDay = 0;
            state.progress = Math.min(left, carryRoom(state.stage));
        }
        save();
    },

    /** The debug panel's jump to a stage (its bar empty). */
    setStage(stage: number): void {
        state.stage = Math.max(0, Math.floor(stage));
        state.progress = 0;
        // As if just upgraded: the stage's first day, its orders dealt for it.
        state.stageDay = 0;
        state.orders = dealFor(state.day, state.stage, 0);
        save();
    },

    /**
     * The debug panel's minigames: a day set up to try one thing (`stage`, which of its days — 0 its first — and the
     * orders), in the restaurant. It replaces the day the player was on (the stage's bar starts empty).
     */
    practice(stage: number, stageDay: number, orders: Order[]): void {
        state.stage = Math.max(0, Math.floor(stage));
        state.stageDay = Math.max(0, Math.floor(stageDay));
        state.progress = 0;
        state.orders = orders.map((o) => ({ ...o, toppings: [...o.toppings] }));
        state.place = 'restaurant';
        save();
    },

    /** Forgets that an ice cream was served right (its hints at the machine show again). */
    forgetIceCream(): void {
        state.iceCreamLearned = false;
        save();
    },

    get sundaeLearned(): boolean {
        return state.sundaeLearned === true;
    },

    /** A sundae served right: no more hints at the sundae bar. */
    learnSundae(): void {
        if (state.sundaeLearned) return;
        state.sundaeLearned = true;
        save();
    },

    /** Forgets that a sundae was served right (its hints show again). */
    forgetSundae(): void {
        state.sundaeLearned = false;
        save();
    },

    /** Forgets that a pizza was served right (its hints at the oven show again). */
    forgetPizza(): void {
        state.pizzaLearned = false;
        save();
    },

    /**
     * A day's over: its coins into the bar, the next day's orders dealt, and off to deliver pizzas (a day played with the
     * pizza oven) or straight to the supermarket.
     */
    endDay(earned: number): void {
        const stageBefore = state.stage;
        RestaurantSave.addProgress(earned);
        state.day++;
        state.stageDay = state.stage === stageBefore ? state.stageDay + 1 : 0;
        state.orders = dealFor(state.day, state.stage, state.stageDay);
        // A day with the pizza oven: the phone orders (box the pizzas), then their delivery; else the supermarket.
        state.place = hasPizzaOven(stageBefore) ? 'phone' : 'market';
        save();
    },

    /** To the phone orders (the debug panel's areas: stand-alone); the day's orders stay. */
    openPhone(): void {
        state.place = 'phone';
        save();
    },

    /** To the pizza delivery (after the phone orders, or the debug panel's areas: stand-alone); the day's orders stay. */
    openDelivery(): void {
        state.place = 'delivery';
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
