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
import type { Flavor, PizzaTopping, ScoopFlavor, SundaeSauce, SundaeTopping, Topping } from './Recipes';

export interface DaySettings {
    /** How many customers come that day. */
    customers: number;
    /** The most toppings one order asks for (1 to 3). */
    maxToppings: number;
    /** Only these of the stage's toppings this day (unset: all): day 1 keeps it simple. */
    toppings?: Topping[];
    /** Toppings new this day: one order asks for each (the ticket marks it NEW!). */
    introduce?: Topping[];
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
    /** How many of `top` (unset: 3) and their scale (unset: 0.8): small fruit, more of it. */
    topCount?: number;
    topScale?: number;
    /** Only sold once the restaurant serves this dish (ice cream's milk and fruit). */
    with?: 'iceCream' | 'sundae';
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
    /**
     * Seated, with a wait at the door (the diner on): customers come one at a time and wait just inside the door till a
     * seat's free (only one waits: the next comes once they've sat down or gone). After this many seconds waiting they
     * get annoyed and leave (an unhappy customer). Unset: everyone comes in and they all wait as long as it takes.
     */
    patience?: number;
    /** The stage's first day: fewer seats (the rest stay empty) and how many customers come (e.g. one too many, to teach clearing). */
    firstDay?: { seats?: number; customers?: number };
    /** The toppings its customers order (unset: cheese, lettuce, tomato). Its station needs a pile of each (levels/restaurant.json). */
    toppings?: Topping[];
    /** Ice cream (a stage whose room has the ice cream machine; not on its first day): `share` of the orders are cones, of `flavors` (unset: all). */
    iceCream?: { share: number; flavors?: Flavor[] };
    /**
     * Pizza (a stage whose room has a pizza oven; not on its first day): `share` of the orders are pizzas, each with 0 to
     * `maxToppings` (unset: 2) of `toppings` (unset: pepperoni, mushroom, onion, tomato).
     */
    pizza?: { share: number; toppings?: PizzaTopping[]; maxToppings?: number };
    /**
     * Sundaes (a stage whose room has the sundae bar — its freezer and bar props; not on its first day): `share` of the
     * orders, each 1 to `maxScoops` scoops (unset: 2) of `flavors`, maybe one of `sauces`, 0 to `maxToppings` (unset: 1)
     * of `toppings` (unset: all of each).
     */
    sundae?: { share: number; maxScoops?: number; maxToppings?: number; flavors?: ScoopFlavor[]; sauces?: SundaeSauce[]; toppings?: SundaeTopping[] };
}

/**
 * The pizza delivery minigame: drive from outside the restaurant (`start`) to a house (one `houseDistance` away, min to
 * max), drop its pizza, back for the next, `deliveries` times; each pays `pay` (into the restaurant's bar). The car: its
 * model (`car`, fitted to `length`), top speed forward and back, how fast it gets up to speed and stops, how fast it turns
 * (radians a second at speed); how near a stop counts as there.
 */
export interface DeliverySettings {
    deliveries: number;
    pay: number;
    car: string;
    start: { x: number; z: number; rotationY: number };
    maxSpeed: number;
    reverseSpeed: number;
    accel: number;
    brake: number;
    turnRate: number;
    length: number;
    arriveRadius: number;
    houseDistance: [number, number];
}

/**
 * Serving fast: a right dish served within its time (from when cooking starts) earns `bonus` coins more and the green
 * face. The time: the dish's own (`burger`, `pizza`, `iceCream`, `sundae`, seconds) and `perItem` for each topping
 * (a sundae: each extra scoop, its sauce, each topping).
 */
export interface SpeedSettings { bonus: number; burger: number; pizza: number; iceCream: number; sundae: number; perItem: number }

export interface RestaurantSettings {
    /** Day 1, 2, ...; past the last, the last one's. */
    days: DaySettings[];
    /** The restaurant's stages, smallest first. */
    stages: StageSettings[];
    /**
     * Of the next stage's goal, how much the coins past a full bar may fill (0: none — each stage starts empty, so its
     * first day teaches from scratch and it lasts more than a day). Unset: all of it.
     */
    carryOver?: number;
    speed?: SpeedSettings;
    cookSeconds: number;
    /** How long a pizza's in the oven (s). */
    bakeSeconds?: number;
    pay: { base: number; perTopping: number; iceCream?: number; pizza?: number; sundae?: number };
    customer: { height: number; walkSpeed: number };
    market: MarketItem[];
    /** The phone orders minigame (scenes/PhoneScene.ts): toppings its pizzas can have on top of the stage's, and how many. */
    phone?: { toppings?: PizzaTopping[]; maxToppings?: number };
    /** The pizza delivery minigame (scenes/DeliveryScene.ts). */
    delivery: DeliverySettings;
    /** The street round the restaurant: the road kit, the traffic, the people (levels/restaurant.json says where). */
    /**
     * `people.restaurant`: the crowd while the game's in the restaurant (game/world/Town.ts 'restaurant' mode): at most
     * `people` wanderers (the areas nearest the restaurant first) and `walkers` on the paths. The delivery mode has them all.
     */
    town: {
        roadKit: TownRoadKit; traffic: TrafficSettings; people: CrowdSettings & { restaurant?: { people: number; walkers: number } };
        /** The buildings the city blocks fill with (CityBlocks.ts): each model, its kind, its height. */
        city?: { buildings: { model: string; kind: 'house' | 'tower' | 'shop'; height: number }[] };
    };
}

export const SETTINGS = settings as unknown as RestaurantSettings;

/** Day `day` (0-based)'s settings. */
export const daySettings = (day: number): DaySettings => SETTINGS.days[Math.min(day, SETTINGS.days.length - 1)];

/** Stage `stage` (0-based; past the last, the last one). */
export const stageSettings = (stage: number): StageSettings => SETTINGS.stages[Math.min(stage, SETTINGS.stages.length - 1)];

/** Whether `stage` is the last (its bar fills, but there's nothing after it yet). */
export const isLastStage = (stage: number): boolean => stage >= SETTINGS.stages.length - 1;
