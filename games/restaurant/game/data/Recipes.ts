// Recipes.ts
//
// What can go in a dish and what customers order. The MVP's one dish: the burger — a bun (its bottom on the plate from the
// start, its top on when it's served), a cooked patty, and the toppings the customer asked for (one to three of cheese,
// lettuce, tomato). An order's right when the patty's there and the toppings are exactly the ones asked for (any order on
// the bun, none extra, none twice).

export type Topping = 'cheese' | 'lettuce' | 'tomato';
export type Ingredient = 'patty' | Topping;

export const TOPPINGS: Topping[] = ['cheese', 'lettuce', 'tomato'];

/** Each ingredient's model (models/kitchen/<model>.gltf), as it sits in the burger, and how tall it adds (model units). */
export const PARTS: Record<Ingredient | 'bunBottom' | 'bunTop' | 'rawPatty', { model: string; height: number }> = {
    bunBottom: { model: 'food_ingredient_bun_bottom', height: 0.2 },
    bunTop: { model: 'food_ingredient_bun_top', height: 0.31 },
    rawPatty: { model: 'food_ingredient_burger_uncooked', height: 0.2 },
    patty: { model: 'food_ingredient_burger_cooked', height: 0.2 },
    cheese: { model: 'food_ingredient_cheese_slice', height: 0.08 },
    lettuce: { model: 'food_ingredient_lettuce_slice', height: 0.07 },
    tomato: { model: 'food_ingredient_tomato_slice', height: 0.1 },
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

/** Whether what was built (`patty`, the toppings in the order they went on) is what was ordered. */
export function matches(order: Order, patty: boolean, toppings: readonly Topping[]): boolean {
    if (!patty || toppings.length !== order.toppings.length) return false;
    return order.toppings.every((topping) => toppings.includes(topping)) && new Set(toppings).size === toppings.length;
}

/** Coins for a dish served right: a base, and a little for each topping. */
export const payFor = (order: Order): number => 10 + order.toppings.length * 5;
