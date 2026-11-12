// Settings.ts
//
// The game's numbers, from settings.json at the game's root — one plain file, so a web editor (as Mob's / Pizza's) can
// edit it later without touching code: each day's customers and what they may order, the restaurant's stages (a food
// truck first; each one's goal: the coins that fill its bar and upgrade it to the next), how long a patty takes, what a
// dish pays, the customers' height and pace, and the supermarket's goods (each item: its crate and its picture; an item
// whose id is a burger part — bun, patty, a topping — is what the shopping list asks for).

import settings from '../../settings.json';

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
}

export interface StageSettings {
    id: string;
    name: string;
    /** The coins that fill this stage's bar (and upgrade the restaurant to the next stage). */
    goal: number;
}

export interface RestaurantSettings {
    /** Day 1, 2, ...; past the last, the last one's. */
    days: DaySettings[];
    /** The restaurant's stages, smallest first. */
    stages: StageSettings[];
    cookSeconds: number;
    pay: { base: number; perTopping: number };
    customer: { height: number; walkSpeed: number };
    market: MarketItem[];
}

export const SETTINGS = settings as RestaurantSettings;

/** Day `day` (0-based)'s settings. */
export const daySettings = (day: number): DaySettings => SETTINGS.days[Math.min(day, SETTINGS.days.length - 1)];

/** Stage `stage` (0-based; past the last, the last one). */
export const stageSettings = (stage: number): StageSettings => SETTINGS.stages[Math.min(stage, SETTINGS.stages.length - 1)];

/** Whether `stage` is the last (its bar fills, but there's nothing after it yet). */
export const isLastStage = (stage: number): boolean => stage >= SETTINGS.stages.length - 1;
