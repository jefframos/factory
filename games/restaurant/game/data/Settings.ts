// Settings.ts
//
// The game's numbers, from settings.json at the game's root — one plain file, so a web editor (as Mob's / Pizza's) can
// edit it later without touching code: each day's customers and what they may order, the restaurant's stages (a food
// truck first; each one's goal: the coins that fill its bar and upgrade it to the next), how long a patty takes, what a
// dish pays, the customers' height and pace, and the supermarket's goods (each item: its crate and its picture; an item
// whose id is a burger part — bun, patty, a topping — is what the shopping list asks for), and the street round the
// restaurant: its road kit, traffic and people (core/town; where they are is the layout's).

import settings from '../../settings.json';
import type { TownRoadKit } from 'core/town/Ground';
import type { TrafficSettings } from 'core/town/Traffic';
import type { CrowdSettings } from 'core/town/Crowd';
import type { Flavor, Topping } from './Recipes';

export interface DaySettings {
    /** How many customers come that day. */
    customers: number;
    /** The most toppings one order asks for (1 to 3). */
    maxToppings: number;
}

export interface MarketItem {
    id: string;
    name: string;
    /** Its crate on the market floor (models/kitchen/<crate>.gltf). */
    crate: string;
    /** The model its picture's rendered from. */
    icon: string;
    /** A crate with no produce of its own (the plain 'crate'): this model, a few of them, on top (raw patties, pickles). */
    top?: string;
}

export interface StageSettings {
    id: string;
    name: string;
    /** The coins that fill this stage's bar (and upgrade the restaurant to the next stage). */
    goal: number;
    /**
     * How customers are served: 'counter' (the food truck: they queue at the counter and order there) or 'seated' (they
     * take a free seat — the layout's `seats` — and wait to be tapped; their plate stays on the table until it's cleared).
     */
    service?: 'counter' | 'seated';
    /** The stage's first day: fewer seats (the rest stay empty) and how many customers come (e.g. one too many, to teach clearing). */
    firstDay?: { seats?: number; customers?: number };
    /** The toppings its customers order (unset: cheese, lettuce, tomato). Its station needs a pile of each (levels/restaurant.json). */
    toppings?: Topping[];
    /** Ice cream (a stage whose room has the ice cream machine; not on its first day): `share` of the orders are cones, of `flavors` (unset: all). */
    iceCream?: { share: number; flavors?: Flavor[] };
}

export interface RestaurantSettings {
    /** Day 1, 2, ...; past the last, the last one's. */
    days: DaySettings[];
    /** The restaurant's stages, smallest first. */
    stages: StageSettings[];
    cookSeconds: number;
    pay: { base: number; perTopping: number; iceCream?: number };
    customer: { height: number; walkSpeed: number };
    market: MarketItem[];
    /** The street round the restaurant: the road kit, the traffic, the people (levels/restaurant.json says where). */
    /**
     * `people.restaurant`: the crowd while the game's in the restaurant (game/world/Town.ts 'restaurant' mode): at most
     * `people` wanderers (the areas nearest the restaurant first) and `walkers` on the paths. The delivery mode has them all.
     */
    town: { roadKit: TownRoadKit; traffic: TrafficSettings; people: CrowdSettings & { restaurant?: { people: number; walkers: number } } };
}

export const SETTINGS = settings as unknown as RestaurantSettings;

/** Day `day` (0-based)'s settings. */
export const daySettings = (day: number): DaySettings => SETTINGS.days[Math.min(day, SETTINGS.days.length - 1)];

/** Stage `stage` (0-based; past the last, the last one). */
export const stageSettings = (stage: number): StageSettings => SETTINGS.stages[Math.min(stage, SETTINGS.stages.length - 1)];

/** Whether `stage` is the last (its bar fills, but there's nothing after it yet). */
export const isLastStage = (stage: number): boolean => stage >= SETTINGS.stages.length - 1;
