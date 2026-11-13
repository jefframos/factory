// Recipes.ts
//
// What can go in a dish and what customers order. The MVP's one dish: the burger — a bottom bun, a cooked patty, the
// toppings the customer asked for (one to three of cheese, lettuce, tomato), a top bun. An order's right when the plate
// has, bottom up: the bottom bun first, the top bun last, one patty, and exactly the toppings asked for in between (in
// any order, none extra, none twice).
//
// A day's orders are dealt before it starts: the supermarket's shopping list is made from them (what they use).

import { SETTINGS, daySettings } from './Settings';

export type Topping = 'cheese' | 'lettuce' | 'tomato';
export type Part = 'bunBottom' | 'bunTop' | 'rawPatty' | 'patty' | Topping;
/** What the player taps on the bench to put on the plate (or, the raw patties, in the pan). */
export type Piece = 'bunBottom' | 'bunTop' | 'patty' | Topping;

export const TOPPINGS: Topping[] = ['cheese', 'lettuce', 'tomato'];
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
};

export interface Order {
    toppings: Topping[];
}

/** A customer's order: a patty and 1 to `most` different toppings, at random. */
export function randomOrder(most = 3): Order {
    const pool = [...TOPPINGS].sort(() => Math.random() - 0.5);
    const count = 1 + Math.floor(Math.random() * Math.min(most, pool.length));
    // Shown in a fixed order (cheese, lettuce, tomato): easier to read.
    return { toppings: pool.slice(0, count).sort((a, b) => TOPPINGS.indexOf(a) - TOPPINGS.indexOf(b)) };
}

/** Day `day`'s orders, dealt. */
export function dealDay(day: number, customersOverride?: number): Order[] {
    const { customers, maxToppings } = daySettings(day);
    return Array.from({ length: customersOverride ?? customers }, () => randomOrder(maxToppings));
}

/** What `orders` use, as the market's item ids: buns, patties, and every topping any of them asks for. */
export function ingredientsFor(orders: readonly Order[]): string[] {
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

/** Coins for a dish served right: a base, and a little for each topping. */
export const payFor = (order: Order): number => SETTINGS.pay.base + order.toppings.length * SETTINGS.pay.perTopping;
