// AnimalStallTypes.ts
//
// An ANIMAL STALL — a "type=animalStall" rect on the Tiled map (its pen: where its animals
// wander), plus two id-less parts that name it as their "target": a "dropper" (where the player
// pays to build it) and a "storage" (its collect box — where its animals' produce lands and the
// player picks it up). See PizzaScene.setupAnimalStalls() / StallAnimal.ts.
//
// Building it = buying its storage: the Storages tab entry with the STALL's id holds the price
// (e.g. 20 money) and the box itself (model, pile, collect: true, resourceType). Once bought,
// `animalCount` animals spawn in the pen; each one lays one `resourceType` into the box every
// `produceIntervalSec` while the box has room.
//
// Same {default, byId} shape as StorageTypes.ts: every stall uses DEFAULT_ANIMAL_STALL_CONFIG
// unless ANIMAL_STALL_CONFIG_BY_ID has its id. Edited from the pizza web editor's Animal Stalls tab.

import { ResourceType } from '../actions/ResourceTypes';
import { ModelDefinition } from '../../registry/assetsRegistry/modelsRegistry';

export interface AnimalStallConfig {
    /** Display name — the build notification's subtitle and the editor. Optional. */
    name?: string;
    /** The animal's model — one picked at random per animal. "Group.Key" strings or MODELS.* definitions. */
    animalModels: (string | ModelDefinition)[];
    /** x the model's own size. */
    animalScale: number;
    /** Extra yaw (degrees) for a model that doesn't face +Z. Unset = 0. */
    animalYawOffsetDeg?: number;
    /** Animals spawned when the stall is built. */
    animalCount: number;
    /** World units per second while walking. */
    wanderSpeed: number;
    /** Seconds an animal stands still between two walks — random between these. */
    minPauseSec: number;
    maxPauseSec: number;
    /** What each animal produces into the stall's box. */
    resourceType: ResourceType;
    /** Seconds between two items from ONE animal (paused while the box is full). */
    produceIntervalSec: number;
    /**
     * What the animal keeper (a "farmDesk" of kind 'animals') sells for this stall: each entry is
     * what it costs to REACH that level, and every level past 1 adds one more animal (so the stall
     * lays more often). The highest listed level is the max. Unset/empty = DEFAULT_ANIMAL_STALL_UPGRADES.
     */
    upgrades?: AnimalStallUpgradeLevel[];
    /** When true, this stall isn't spawned at all. */
    disabled?: boolean;
}

/** One rung of a stall's upgrade ladder — see AnimalStallConfig.upgrades. */
export interface AnimalStallUpgradeLevel {
    /** The level this buys (2, 3, ...). */
    level: number;
    /** Money (CurrencyType.Money) to reach it from the level below. */
    cost: number;
}

/** AnimalStallConfig.upgrades fallback: up to two more animals. */
export const DEFAULT_ANIMAL_STALL_UPGRADES: readonly AnimalStallUpgradeLevel[] = [
    { level: 2, cost: 60 },
    { level: 3, cost: 150 },
];

/** Every stall unless ANIMAL_STALL_CONFIG_BY_ID has its id. */
export const DEFAULT_ANIMAL_STALL_CONFIG: AnimalStallConfig = {
    "name": "Chicken Stall",
    "animalModels": [
        "Pets.AnimalChick"
    ],
    "animalScale": 0.5,
    "animalCount": 1,
    "wanderSpeed": 0.8,
    "minPauseSec": 1,
    "maxPauseSec": 3,
    "resourceType": ResourceType.Egg,
    "produceIntervalSec": 8
};

/** Per-stall overrides — sparse. */
export const ANIMAL_STALL_CONFIG_BY_ID: Partial<Record<string, AnimalStallConfig>> = {
    "chickenStall": {
        "name": "Chicken Stall",
        "animalModels": [
            "Pets.AnimalChick"
        ],
        "animalScale": 0.5,
        "animalCount": 1,
        "wanderSpeed": 0.8,
        "minPauseSec": 1,
        "maxPauseSec": 3,
        "resourceType": ResourceType.Egg,
        "produceIntervalSec": 30
    },
    "cowStall": {
        "name": "Cow Stall",
        "animalModels": [
            "Pets.AnimalCow"
        ],
        "animalScale": 1.5,
        "animalCount": 1,
        "wanderSpeed": 0.6,
        "minPauseSec": 2,
        "maxPauseSec": 4,
        "resourceType": ResourceType.Milk,
        "produceIntervalSec": 45
    }
};

/** A stall's resolved upgrade ladder — see AnimalStallConfig.upgrades. */
export function getAnimalStallUpgrades(id: string): readonly AnimalStallUpgradeLevel[] {
    const upgrades = getAnimalStallConfig(id).upgrades;
    return upgrades && upgrades.length > 0 ? upgrades : DEFAULT_ANIMAL_STALL_UPGRADES;
}

/** The upgrade a stall at `level` can buy next — undefined at the top of its ladder. */
export function getNextAnimalStallUpgrade(id: string, level: number): AnimalStallUpgradeLevel | undefined {
    return getAnimalStallUpgrades(id).find(entry => entry.level === level + 1);
}

/** Highest level this stall can reach. */
export function getAnimalStallMaxLevel(id: string): number {
    return Math.max(1, ...getAnimalStallUpgrades(id).map(entry => entry.level));
}

/** Animals in the pen at `level`: the config's animalCount, plus one per level past 1. */
export function getAnimalCountAt(id: string, level: number): number {
    return Math.max(0, Math.round(getAnimalStallConfig(id).animalCount)) + Math.max(0, level - 1);
}

export function getAnimalStallConfig(id: string): AnimalStallConfig {
    return ANIMAL_STALL_CONFIG_BY_ID[id] ?? DEFAULT_ANIMAL_STALL_CONFIG;
}
