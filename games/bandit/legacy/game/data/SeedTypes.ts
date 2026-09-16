// SeedTypes.ts
//
// A SEED is the bankable, harvestable item a player plants on a farm cell —
// same "small fixed enum + config record" shape as CropTypes.ts's own
// CropId/CROP_CONFIG (game-design content, not something read off the map),
// but deliberately its own file/enum/storage rather than folded into
// CropTypes.ts or ResourceTypes.ts: a seed and the crop it grows into are
// two different bankable things a player can independently hold (you can
// harvest 3 Wheat and still be sitting on 2 unplanted Wheat Seeds), so they
// get their own SeedStorage.ts (mirrors BackpackStorage.ts's shape) instead
// of sharing BackpackStorage's ResourceType-keyed map.
//
// `cropId` is the only link back to CropTypes.ts — FarmPlotTile.ts reads it
// to know which CROP_CONFIG entry planting a given seed should start
// growing; CropConfig itself carries no seed reference the other way
// (avoids a circular import, and there's no reason a crop needs to know
// which seed(s) grow it — planting is "spend 1 of THIS seed", not "spend
// currency", so the cost lives entirely on the seed side).
//
// A seed's own world/UI appearance (icon/models/scale/rotationDeg) routes
// through AssetLibraryRegistry.ts, exactly like Resources/Providers already
// do (see ResourceTypes.ts's own doc) — "seeds are resources like the
// others" for presentation purposes, just tracked in their own bank.

import { CropId } from './CropTypes';

export enum SeedId {
    BeetSeed = 'beetSeed',
    BroccoliSeed = 'broccoliSeed',
    CabbageSeed = 'cabbageSeed',
    CarrotSeed = 'carrotSeed',
    CauliflowerSeed = 'cauliflowerSeed',
    CornSeed = 'cornSeed',
    LeekSeed = 'leekSeed',
    MushroomSeed = 'mushroomSeed',
    PumpkinBasicSeed = 'pumpkinBasicSeed',
    StrawberrySeed = 'strawberrySeed',
    TomatoSeed = 'tomatoSeed',
    WatermelonSeed = 'watermelonSeed',
}

export interface SeedConfig {
    label: string;
    /** Which CropTypes.ts CROP_CONFIG entry this seed grows into when planted. */
    cropId: CropId;
}

export const SEED_CONFIG: Record<SeedId, SeedConfig> = {
    [SeedId.BeetSeed]: {
        label: "Beet Seed",
        cropId: CropId.Beet,
    },
    [SeedId.BroccoliSeed]: {
        label: "Broccoli Seed",
        cropId: CropId.Broccoli,
    },
    [SeedId.CabbageSeed]: {
        label: "Cabbage Seed",
        cropId: CropId.Cabbage,
    },
    [SeedId.CarrotSeed]: {
        label: "Carrot Seed",
        cropId: CropId.Carrot,
    },
    [SeedId.CauliflowerSeed]: {
        label: "Cauliflower Seed",
        cropId: CropId.Cauliflower,
    },
    [SeedId.CornSeed]: {
        label: "Corn Seed",
        cropId: CropId.Corn,
    },
    [SeedId.LeekSeed]: {
        label: "Leek Seed",
        cropId: CropId.Leek,
    },
    [SeedId.MushroomSeed]: {
        label: "Mushroom Seed",
        cropId: CropId.Mushroom,
    },
    [SeedId.PumpkinBasicSeed]: {
        label: "Pumpkin (Basic) Seed",
        cropId: CropId.PumpkinBasic,
    },
    [SeedId.StrawberrySeed]: {
        label: "Strawberry Seed",
        cropId: CropId.Strawberry,
    },
    [SeedId.TomatoSeed]: {
        label: "Tomato Seed",
        cropId: CropId.Tomato,
    },
    [SeedId.WatermelonSeed]: {
        label: "Watermelon Seed",
        cropId: CropId.Watermelon,
    },
};
