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
// And a pizza (a stage with a pizza oven and settings.json stages[].pizza: that share of its orders): dough, tomato
// sauce, cheese and 0 to `maxToppings` of the stage's pizza toppings (pepperoni, mushroom, onion, tomato, pickles), baked
// — made on the board by the oven (world/Pizza.ts). Right when it was baked and has exactly those.
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
    /** A pizza with these toppings instead of a burger (none: a cheese pizza; the order's `toppings` then empty). */
    pizza?: PizzaTopping[];
    /** A scooped ice cream (a cone or a bowl) instead of a burger (the order's `toppings` then empty). */
    sundae?: Sundae;
}

// ---------------------------------------------------------------- the sundae bar (scooped ice cream)

/** A scoop's flavour: the kit's three, and three more (the vanilla scoop, tinted: SCOOP_TINTS). */
export type ScoopFlavor = 'vanilla' | 'chocolate' | 'strawberry' | 'mint' | 'blueberry' | 'mango';
export const SCOOP_FLAVORS: ScoopFlavor[] = ['vanilla', 'chocolate', 'strawberry', 'mint', 'blueberry', 'mango'];
export type SundaeBase = 'cone' | 'bowl';
export type SundaeSauce = 'chocolate' | 'caramel' | 'strawberry';
/** The sauces the bar has (strawberry's left out: next to chocolate it looked the same; settings.json can still add it). */
export const SUNDAE_SAUCES: SundaeSauce[] = ['chocolate', 'caramel'];
export type SundaeTopping = 'sprinkles' | 'cherry' | 'cookie' | 'waffle';
export const SUNDAE_TOPPINGS: SundaeTopping[] = ['sprinkles', 'cherry', 'cookie', 'waffle'];

/** A sundae: its base, its scoops (bottom up; which order doesn't matter), a sauce over them or none, its toppings. */
export interface Sundae {
    base: SundaeBase;
    scoops: ScoopFlavor[];
    sauce: SundaeSauce | null;
    toppings: SundaeTopping[];
}

/** The kit's scoop and tub models for a flavour (the tinted ones are vanilla's: SCOOP_TINTS). */
export const SCOOP_MODEL = (flavor: ScoopFlavor): string => `icecream_bowl_icecream_${flavor === 'chocolate' || flavor === 'strawberry' ? flavor : 'vanilla'}`;
export const TUB_FILL_MODEL = (flavor: ScoopFlavor): string => `icecream_container_icecream_${flavor === 'chocolate' || flavor === 'strawberry' ? flavor : 'vanilla'}`;
/** The colour the vanilla scoop's tinted to (x its own) for the flavours the kit hasn't got. */
export const SCOOP_TINTS: Partial<Record<ScoopFlavor, string>> = { mint: '#9fefc4', blueberry: '#b7a6ff', mango: '#ffc04a' };
/** Each sauce's colour (a cap over the scoops, and its bowl on the bar). */
export const SAUCE_COLORS: Record<SundaeSauce, string> = { chocolate: '#4a2a17', caramel: '#c7812f', strawberry: '#e0405a' };
/** Each topping's bowl on the bar (the kit has bowls of cherries, cookie sticks, waffles; sprinkles: an empty one, filled). */
export const SUNDAE_TOPPING_SOURCES: Record<SundaeTopping, string> = { sprinkles: 'icecream_bowl', cherry: 'icecream_bowl_cherries', cookie: 'icecream_bowl_cookiesticks', waffle: 'icecream_bowl_waffles' };
/** Every model the sundae bar uses. */
export const SUNDAE_MODELS = [
    'icecream_bowl', 'icecream_bowl_cherries', 'icecream_bowl_cookiesticks', 'icecream_bowl_waffles', 'icecream_cherry', 'icecream_cookiestick',
    'icecream_waffle', 'icecream_container', 'icecream_cone', 'icecream_cone_stacked', 'bowl', 'food_ingredient_tomato_sauce',
    ...['vanilla', 'chocolate', 'strawberry'].flatMap((f) => [`icecream_bowl_icecream_${f}`, `icecream_container_icecream_${f}`]),
];

/** Whether the sundae made is the one ordered: its base, the same scoops (in any order), its sauce, exactly its toppings. */
export function sundaeMatches(order: Sundae, made: Sundae): boolean {
    const sorted = (list: readonly string[]) => [...list].sort().join(',');
    return order.base === made.base && sorted(order.scoops) === sorted(made.scoops) && order.sauce === made.sauce && sorted(order.toppings) === sorted(made.toppings);
}

/** A random sundae: a cone or a bowl, 1 to `maxScoops` scoops (a flavour can come twice), maybe a sauce, 0 to `maxToppings` toppings. */
export function randomSundae(options: { maxScoops?: number; maxToppings?: number; flavors?: ScoopFlavor[]; sauces?: SundaeSauce[]; toppings?: SundaeTopping[] } = {}): Sundae {
    const pick = <T>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)];
    const flavors = options.flavors ?? SCOOP_FLAVORS;
    const count = 1 + Math.floor(Math.random() * (options.maxScoops ?? 2));
    const toppingPool = [...(options.toppings ?? SUNDAE_TOPPINGS)].sort(() => Math.random() - 0.5);
    return {
        base: Math.random() < 0.45 ? 'cone' : 'bowl',
        scoops: Array.from({ length: count }, () => pick(flavors)),
        sauce: Math.random() < 0.6 ? pick(options.sauces ?? SUNDAE_SAUCES) : null,
        toppings: toppingPool.slice(0, Math.floor(Math.random() * ((options.maxToppings ?? 1) + 1))).sort((a, b) => SUNDAE_TOPPINGS.indexOf(a) - SUNDAE_TOPPINGS.indexOf(b)),
    };
}

/** What can go on a pizza over its cheese. A topping's id is its market item's (settings.json market). */
export type PizzaTopping = 'pepperoni' | 'mushroom' | 'onion' | 'tomato' | 'pickles';
export const PIZZA_TOPPINGS: PizzaTopping[] = ['pepperoni', 'mushroom', 'onion', 'tomato', 'pickles'];
/** A stage's pizza toppings when settings.json doesn't say. */
export const BASIC_PIZZA_TOPPINGS: PizzaTopping[] = ['pepperoni', 'mushroom', 'onion', 'tomato'];
/** What goes on a pizza, in the order it's made (bottom up): the base, then the toppings. */
export type PizzaLayer = 'dough' | 'sauce' | 'cheese' | PizzaTopping;
export const PIZZA_BASE: PizzaLayer[] = ['dough', 'sauce', 'cheese'];
export const PIZZA_LAYERS: PizzaLayer[] = [...PIZZA_BASE, ...PIZZA_TOPPINGS];
/** A pizza's layers when it's made right: the base and its toppings (in PIZZA_TOPPINGS' order). */
export const pizzaRecipe = (toppings: readonly PizzaTopping[]): PizzaLayer[] => [...PIZZA_BASE, ...PIZZA_TOPPINGS.filter((t) => toppings.includes(t))];
/**
 * Each layer on the pizza (KayKit Restaurant Bits: the dough base, sauce, grated cheese, pepperoni slices and mushroom
 * pieces stack as they are; onion rings, tomato and pickle slices are scattered pieces: world/PizzaLook.ts).
 */
export const PIZZA_LAYER_MODELS: Record<PizzaLayer, string> = {
    dough: 'food_ingredient_dough_base',
    sauce: 'food_ingredient_tomato_sauce',
    cheese: 'food_ingredient_cheese_grated',
    pepperoni: 'food_ingredient_pepperoni_slices',
    mushroom: 'food_ingredient_mushroom_pieces',
    onion: 'food_ingredient_onion_rings',
    tomato: 'food_ingredient_tomato_slice',
    /** Made by tools/make-pickles.mjs (the kit has none). */
    pickles: 'food_ingredient_pickle_slices',
};
/** Where each layer comes from on the table (what the player taps). The sauce's is a bowl (with sauce in it). */
export const PIZZA_SOURCE_MODELS: Record<PizzaLayer, string> = {
    dough: 'food_ingredient_dough',
    sauce: 'bowl',
    cheese: 'food_ingredient_cheese',
    pepperoni: 'food_ingredient_pepperoni',
    mushroom: 'food_ingredient_mushroom',
    onion: 'food_ingredient_onion',
    tomato: 'food_ingredient_tomato',
    pickles: 'food_ingredient_pickle',
};
export const PIZZA_OVEN_MODEL = 'pizza_oven';

/** Whether a pizza (its layers, baked or not) is the one ordered (`toppings`): baked, and exactly its recipe's layers. */
export function pizzaMatches(toppings: readonly PizzaTopping[], layers: readonly PizzaLayer[], baked: boolean): boolean {
    const recipe = pizzaRecipe(toppings);
    return baked && layers.length === recipe.length && recipe.every((layer) => layers.includes(layer));
}

/** A pizza order: 0 (a cheese pizza) to `most` different toppings of `toppings`, at random (in PIZZA_TOPPINGS' order). */
export function randomPizza(most = 2, toppings: readonly PizzaTopping[] = BASIC_PIZZA_TOPPINGS): PizzaTopping[] {
    const pool = [...toppings].sort(() => Math.random() - 0.5);
    const count = Math.floor(Math.random() * (Math.min(most, pool.length) + 1));
    return pool.slice(0, count).sort((a, b) => PIZZA_TOPPINGS.indexOf(a) - PIZZA_TOPPINGS.indexOf(b));
}

/** An order saved before pizzas had toppings ('cheese' | 'pepperoni' | 'mushroom'): as its toppings. */
export function pizzaFromSave(saved: unknown): PizzaTopping[] | undefined {
    if (Array.isArray(saved)) return saved.filter((t): t is PizzaTopping => (PIZZA_TOPPINGS as string[]).includes(t));
    if (saved === 'cheese') return [];
    if (saved === 'pepperoni' || saved === 'mushroom') return [saved];
    return undefined;
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
 * first day): settings.json stages[].iceCream's share of them are cones. `sundae`, the same with its sundae bar
 * (stages[].sundae: scooped cones and bowls). `pizza`, the same with its oven:
 * stages[].pizza's share are pizzas.
 */
export function dealDay(day: number, stage: number, customersOverride?: number, iceCream = false, pizza = false, sundae = false): Order[] {
    const { customers, maxToppings } = daySettings(day);
    const settings = stageSettings(stage);
    const toppings = settings.toppings ?? BASIC_TOPPINGS;
    const cones = iceCream ? settings.iceCream : undefined;
    const pizzas = pizza ? settings.pizza : undefined;
    const sundaes = sundae ? settings.sundae : undefined;
    const pick = <T>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)];
    return Array.from({ length: customersOverride ?? customers }, () => {
        const roll = Math.random();
        if (cones && roll < cones.share) return { toppings: [], iceCream: pick(cones.flavors ?? FLAVORS) };
        if (pizzas && roll < (cones?.share ?? 0) + pizzas.share) return { toppings: [], pizza: randomPizza(pizzas.maxToppings ?? 2, pizzas.toppings ?? BASIC_PIZZA_TOPPINGS) };
        if (sundaes && roll < (cones?.share ?? 0) + (pizzas?.share ?? 0) + sundaes.share) return { toppings: [], sundae: randomSundae(sundaes) };
        return randomOrder(maxToppings, toppings);
    });
}

/**
 * What `orders` use, as the market's item ids: buns and patties (a burger), every topping any burger asks for, and a
 * pizza's dough, tomatoes (its sauce), cheese and its topping.
 */
export function ingredientsFor(orders: readonly Order[]): string[] {
    // (The ice cream machine's always stocked: cones aren't on the list.)
    const used = new Set<string>();
    for (const order of orders) {
        if (order.pizza) {
            ['dough', 'tomato', 'cheese', ...order.pizza].forEach((id) => used.add(id));
        } else if (!order.iceCream && !order.sundae) {
            used.add('bun');
            used.add('patty');
            order.toppings.forEach((t) => used.add(t));
        }
    }
    // (Never an empty list: a day of only cones still shops for the burgers.)
    if (!used.size) ['bun', 'patty'].forEach((id) => used.add(id));
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

/**
 * Coins for a dish served right: a base, and a little for each topping (a cone: settings.json pay.iceCream, else the
 * base; a pizza: pay.pizza, else the base, and a topping's for each of its toppings).
 */
export function payFor(order: Order): number {
    if (order.iceCream) return SETTINGS.pay.iceCream ?? SETTINGS.pay.base;
    if (order.pizza) return (SETTINGS.pay.pizza ?? SETTINGS.pay.base) + order.pizza.length * SETTINGS.pay.perTopping;
    // A sundae: its base pay, and a topping's for each scoop past the first, its sauce and each topping.
    if (order.sundae) {
        const { scoops, sauce, toppings } = order.sundae;
        return (SETTINGS.pay.sundae ?? SETTINGS.pay.base) + (scoops.length - 1 + (sauce ? 1 : 0) + toppings.length) * SETTINGS.pay.perTopping;
    }
    return SETTINGS.pay.base + order.toppings.length * SETTINGS.pay.perTopping;
}
