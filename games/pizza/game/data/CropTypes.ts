// CropTypes.ts
//
// Data-driven definition of a crop's growth ladder — same "fixed hand-
// authored enum + own upgrade-ladder config" shape as BuildingTypes.ts's
// BuildingId/BUILDING_CONFIG, not FarmTypes.ts's per-Tiled-id override map:
// a crop is game design content (Wheat, Tomato, ...), not something a level
// designer draws a new instance of on the map, so there's a small fixed set
// of them to enumerate ahead of time, same reasoning as BuildingId/ItemType.
//
// A crop is what gets planted into an already-acquired FarmTypes.ts plot
// (see that file's own doc for the empty/prepared pre-plant states this
// file doesn't own). `stages` is the ladder FarmPlotStorage (not yet
// written) advances through over time — same "ordered array, index by
// current progress" shape as BuildingConfig.levels — ending in a stage
// that's actually harvestable. Harvesting hands the player `yield`, a
// bankable ResourceType amount (see ResourceTypes.ts's own doc for why a
// harvested good is a ResourceType and not an ItemType: it's a bankable
// backpack resource, not a crafted/equippable good).
//
// Buying seed to plant is a straight currency cost (`plantCost`), same
// "not a MilestoneRequirement" reasoning as FarmTypes.ts's own plot price —
// paying to plant is an action taken on an already-existing plot, not a
// gate on whether something appears at all. A future inventory-backed
// "carry N seeds, plant without paying per-use" system would add a seed
// ItemType/ResourceType and read that instead — this file doesn't need to
// change shape for that, only `plantCost`'s callers would.

import { CurrencyType } from './EconomyTypes';
import { ResourceType } from '../actions/ResourceTypes';

export enum CropId {
    Wheat = 'wheat',
}

export interface CropStageConfig {
    /** Seconds spent in this stage before advancing to the next one — the LAST stage in a crop's own `stages` array is the harvestable one and has no "next," so this is ignored for it. */
    durationSec: number;
    /** Tile/view key for this stage — same "string key into some registry" convention as FarmPlotTiles.empty/prepared. */
    tile: string;
}

export interface CropConfig {
    name: string;
    plantCost: {
        currency: CurrencyType;
        amount: number;
    };
    /** Ordered from just-planted to harvestable — FarmPlotStorage indexes into this by elapsed growth time. The last entry is the harvestable stage. */
    stages: CropStageConfig[];
    /** Banked into BackpackStorage on harvest. */
    yield: {
        resourceType: ResourceType;
        amount: number;
    };
}

export const CROP_CONFIG: Record<CropId, CropConfig> = {
    [CropId.Wheat]: {
        name: 'Wheat',
        plantCost: {
            currency: CurrencyType.Money,
            amount: 5,
        },
        stages: [
            { durationSec: 20, tile: 'cropWheatSeedling' },
            { durationSec: 20, tile: 'cropWheatGrowing' },
            { durationSec: 0, tile: 'cropWheatReady' },
        ],
        yield: {
            resourceType: ResourceType.Wood,
            amount: 1,
        },
    },
};
