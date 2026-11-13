// Recipes.ts
//
// What can go in a dish and what customers order. The MVP's one dish: the burger — a bottom bun, a cooked patty, the
// toppings the customer asked for (one to three of the stage's: the food truck's cheese, lettuce, tomato; from the small
// diner on, pickles and onion rings too: settings.json stages[].toppings), a top bun. An order's right when the plate
// has, bottom up: the bottom bun first, the top bun last, one patty, and exactly the toppings asked for in between (in
// any order, none extra, none twice).
//
// The other dish: an ice cream cone (a stage with an ice cream machine and settings.json stages[].iceCream: that share of
// its orders), in one of the FLAVORS — made at the machine (world/IceCream.ts), right when it's the flavour asked for.
//
// A day's orders are dealt before it starts: the supermarket's shopping list is made from them (what they use).

import { SETTINGS, daySettings, stageSettings } from './Settings';

export type Topping = 'cheese' | 'lettuce' | 'tomato' | 'pickles' | 'onion';
export type Part = 'bunBottom' | 'bunTop' | 'rawPatty' | 'patty' | Topping;
/** What the player taps on the bench to put on the plate (or, the raw patties, in the pan). */
export type Piece = 'bunBottom' | 'bunTop' | 'patty' | Topping;

/** Every topping (the order bubbles show them in this order). A topping's id is its market item's (settings.json market). */
export const TOPPINGS: Topping[] = ['cheese', 'lettuce', 'tomato', 'pickles', 'onion'];
/** A stage's toppings when settings.json doesn't say. */
export const BASIC_TOPPINGS: Topping[] = ['cheese', 'lettuce', 'tomato'];
export const PIECES: Piece[] = ['bunBottom', 'patty', ...TOPPINGS, 'bunTop'];

/** Each part's model: models/kitchen/<model>.gltf (KayKit Restaurant Bits). */
export const PART_MODELS: Record<Part, string> = {
    bunBottom: 'food_ingredient_bun_bottom',
    bunTop: 'food_ingredient_bun_top',
    rawPatty: 'food_ingredient_burger_uncooked',
    patty: 'food_ingredient_burger_cooked',
    cheese: 'food_ingredient_cheese_slice',
    lettuce: 'food_ingredient_lettuce_slice',
    tomato: 'food_ingredient_tomato_slice',
    /** Made by tools/make-pickles.mjs (the kit has none). */
    pickles: 'food_ingredient_pickle_slices',
    onion: 'food_ingredient_onion_rings',
};

export interface Order {
    toppings: Topping[];
    /** An ice cream cone of this flavour instead of a burger (its toppings then empty). */
    iceCream?: Flavor;
}

export type Flavor = 'vanilla' | 'chocolate' | 'strawberry';
export const FLAVORS: Flavor[] = ['vanilla', 'chocolate', 'strawberry'];
/** The ice cream's models (KayKit Restaurant Bits): an empty cone, the stack of them, each flavour's swirl, the finished cone. */
export const CONE_MODEL = 'icecream_cone';
export const CONE_STACK_MODEL = 'icecream_cone_stacked';
export const SWIRL_MODELS: Record<Flavor, string> = {
    vanilla: 'icecream_softserve_icecream_vanilla',
    chocolate: 'icecream_softserve_icecream_chocolate',
    strawberry: 'icecream_softserve_icecream_strawberry',
};
export const ICE_CREAM_MODELS: Record<Flavor, string> = {
    vanilla: 'food_icecream_cone_vanilla',
    chocolate: 'food_icecream_cone_chocolate',
    strawberry: 'food_icecream_cone_strawberry',
};

/** A customer's order: a patty and 1 to `most` different toppings of `toppings`, at random. */
export function randomOrder(most = 3, toppings: readonly Topping[] = BASIC_TOPPINGS): Order {
    const pool = [...toppings].sort(() => Math.random() - 0.5);
    const count = 1 + Math.floor(Math.random() * Math.min(most, pool.length));
    // Shown in a fixed order (TOPPINGS'): easier to read.
    return { toppings: pool.slice(0, count).sort((a, b) => TOPPINGS.indexOf(a) - TOPPINGS.indexOf(b)) };
}

/**
 * Day `day`'s orders, dealt, from the stage's toppings. `iceCream`: the stage has its machine (and it's not the stage's
 * first day): settings.json stages[].iceCream's share of them are cones.
 */
export function dealDay(day: number, stage: number, customersOverride?: number, iceCream = false): Order[] {
    const { customers, maxToppings } = daySettings(day);
    const settings = stageSettings(stage);
    const toppings = settings.toppings ?? BASIC_TOPPINGS;
    const cones = iceCream ? settings.iceCream : undefined;
    return Array.from({ length: customersOverride ?? customers }, () => {
        if (cones && Math.random() < cones.share) {
            const flavors = cones.flavors ?? FLAVORS;
            return { toppings: [], iceCream: flavors[Math.floor(Math.random() * flavors.length)] };
        }
        return randomOrder(maxToppings, toppings);
    });
}

/** What `orders` use, as the market's item ids: buns, patties, and every topping any of them asks for. */
export function ingredientsFor(orders: readonly Order[]): string[] {
    // (The ice cream machine's always stocked: cones aren't on the list.)
    const used = new Set<string>(['bun', 'patty']);
    for (const order of orders) order.toppings.forEach((t) => used.add(t));
    return [...used];
}

/** Whether the plate (its parts, bottom up) is what was ordered. */
export function matches(order: Order, parts: readonly Part[]): boolean {
    const count = (part: Part) => parts.filter((p) => p === part).length;
    if (parts[0] !== 'bunBottom' || parts[parts.length - 1] !== 'bunTop') return false;
    if (count('bunBottom') !== 1 || count('bunTop') !== 1 || count('patty') !== 1) return false;
    const toppings = parts.filter((p): p is Topping => (TOPPINGS as string[]).includes(p));
    return toppings.length === order.toppings.length && order.toppings.every((t) => toppings.includes(t)) && new Set(toppings).size === toppings.length;
}

/** Coins for a dish served right: a base, and a little for each topping (a cone: settings.json pay.iceCream, else the base). */
export const payFor = (order: Order): number => (order.iceCream ? SETTINGS.pay.iceCream ?? SETTINGS.pay.base : SETTINGS.pay.base + order.toppings.length * SETTINGS.pay.perTopping);
