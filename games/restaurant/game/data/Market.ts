// Market.ts
//
// The supermarket's shopping list: the items the next day's orders use (buns, patties, the toppings they ask for) — no
// quantities: buying an item gets the kitchen all it needs of it. The game's in tapping the right crates.

import { MarketItem, SETTINGS } from './Settings';
import { Order, ingredientsFor } from './Recipes';

/** The list, in the market's order. */
export function shoppingList(orders: readonly Order[]): MarketItem[] {
    const used = new Set(ingredientsFor(orders));
    return SETTINGS.market.filter((item) => used.has(item.id));
}
