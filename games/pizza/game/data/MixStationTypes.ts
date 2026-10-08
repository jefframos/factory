// MixStationTypes.ts
//
// A MIX STATION — turns ingredients into a product (milk -> butter, egg + milk -> bread). On the
// Tiled map: a "type=mixStation" rect with an id, plus parts naming it (see
// PizzaScene.setupMixStations() / world/MixStation.ts):
//   - a "dropper" (target = the station, or its own id = the station's): where the player pays to
//     build it, then DEPOSITS ingredients and stands while it mixes;
//   - an untyped model tile with target = the station: its look (e.g. a table);
//   - one id-less "storage" per ingredient, target = the station, "order" 0, 1, ... = which entry of
//     `inputs` it holds — a BOX on the station's top (`boxModels`) the player fills standing next
//     to it, holding up to that input's `capacity`;
//   - an id-less "dispenser" (target = the station): where the product appears; the player
//     collects it standing next to it (or inside a "collectArea" rect targeting the station).
//
// Flow: the player fills the boxes (several batches' worth); standing in the dropper area (the
// MAKING area) with every box holding at least its `amount`, it mixes for `mixSec` (pausing if
// they step out), uses one batch up and sends `outputAmount` of `resourceType` to the dispenser
// (at most `maxOutput` waiting there — it won't mix while that's full) — batch after batch while
// the boxes last.
//
// Same {default, byId} shape as StorageTypes.ts. Edited from the pizza web editor's Mix Stations tab.

import { ResourceType } from '../actions/ResourceTypes';
import { CurrencyType } from './EconomyTypes';
import type { StoragePrice } from './StorageTypes';
import { ModelDefinition } from '../../registry/assetsRegistry/modelsRegistry';

export interface MixStationInput {
    resourceType: ResourceType;
    /** Units used per batch. */
    amount: number;
    /** How many its box holds (several batches' worth). Unset = DEFAULT_MIX_INPUT_CAPACITY. */
    capacity?: number;
}

/** MixStationInput.capacity fallback. */
export const DEFAULT_MIX_INPUT_CAPACITY = 4;

export interface MixStationConfig {
    /** Display name — the build notification and the editor. Optional. */
    name?: string;
    /** Ingredients, in the order of the map storages' "order" property (0 = first). */
    inputs: MixStationInput[];
    /** What it makes. */
    resourceType: ResourceType;
    /** Units made per batch. */
    outputAmount: number;
    /** Seconds of mixing (the player standing in the dropper area) per batch. */
    mixSec: number;
    /** Most units waiting at the dispenser — no new batch while it's full. */
    maxOutput: number;
    /** Build cost, paid at the dropper. Unset / 0 = built from the start. */
    price?: StoragePrice;
    /** Height of the station's top (world units) — where ingredients and the product sit. */
    surfaceHeight: number;
    /** The ingredient boxes' model — first entry used. Empty/unset = no box, just the pile. "Group.Key" strings or MODELS.* definitions. */
    boxModels?: (string | ModelDefinition)[];
    /** x the box model's own size. Unset = 1. */
    boxScale?: number;
    /** When true, this station isn't spawned at all. */
    disabled?: boolean;
}

export const DEFAULT_MIX_STATION_CONFIG: MixStationConfig = {
    "name": "Mix Station",
    "inputs": [
        {
            "resourceType": ResourceType.Milk,
            "amount": 1,
            "capacity": 4
        }
    ],
    "resourceType": ResourceType.Butter,
    "outputAmount": 1,
    "mixSec": 5,
    "maxOutput": 6,
    "price": {
        "currency": CurrencyType.Money,
        "amount": 10
    },
    "surfaceHeight": 2,
    "boxModels": [
        "Restaurant.Crate"
    ],
    "boxScale": 0.8
};

export const MIX_STATION_CONFIG_BY_ID: Partial<Record<string, MixStationConfig>> = {
    "butterStation": {
        "name": "Butter Station",
        "inputs": [
            {
                "resourceType": ResourceType.Milk,
                "amount": 1,
                "capacity": 4
            }
        ],
        "resourceType": ResourceType.Butter,
        "outputAmount": 1,
        "mixSec": 5,
        "maxOutput": 6,
        "price": {
            "currency": CurrencyType.Money,
            "amount": 10
        },
        "surfaceHeight": 2,
        "boxModels": [
            "Restaurant.Crate"
        ],
        "boxScale": 0.8
    },
    "breadStation": {
        "name": "Bread Station",
        "inputs": [
            {
                "resourceType": ResourceType.Egg,
                "amount": 1,
                "capacity": 4
            },
            {
                "resourceType": ResourceType.Milk,
                "amount": 1,
                "capacity": 4
            }
        ],
        "resourceType": ResourceType.Bread,
        "outputAmount": 1,
        "mixSec": 5,
        "maxOutput": 6,
        "price": {
            "currency": CurrencyType.Money,
            "amount": 10
        },
        "surfaceHeight": 2,
        "boxModels": [
            "Restaurant.Crate"
        ],
        "boxScale": 0.8
    }
};

export function getMixStationConfig(id: string): MixStationConfig {
    return MIX_STATION_CONFIG_BY_ID[id] ?? DEFAULT_MIX_STATION_CONFIG;
}
