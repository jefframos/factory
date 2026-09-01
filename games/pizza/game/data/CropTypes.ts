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
// Planting costs exactly one of whichever SeedTypes.ts seed points its own
// `cropId` at this entry — see that file's own doc for why the seed is what
// carries the cost/link, not this file (avoids a circular import, and a
// crop itself has no reason to know which seed(s) grow it). FarmPlotTile.ts
// is the one place that joins the two: its seed-picker offers only seeds
// the player actually holds (SeedStorage.getCount() > 0), consumes one on a
// successful plant, and looks up CROP_CONFIG[seed.cropId] to start growing.
//
// Each stage carries its own 3D mesh (an EntityViewRegistry.ts id — same
// "string key resolved via resolveEntityView()" join every other view field
// in this codebase uses, e.g. FarmPlotTiles.empty/prepared) plus a
// start/end offset+scale pair — CropVisualComponent.ts lerps between them
// over the stage's own `durationSec` as FarmCropStorage's (not yet written)
// elapsed-time clock advances, so a crop visibly grows continuously instead
// of popping between fixed sizes at each stage boundary. `mesh` is optional
// per stage: omitted means keep showing whatever mesh was already up
// (`initialMesh`, or an earlier stage's own `mesh`) and just keep lerping
// its offset/scale — a stage doesn't have to swap models just to keep
// growing.

import { ResourceType } from '../actions/ResourceTypes';

export enum CropId {
    Wheat = 'wheat',
}

/** [x, y, z] world-unit offset (same plain-numbers convention as EntityViewRegistry.EntityViewConfig.offset) plus a uniform scale — one lerp endpoint for a growth stage. */
export interface CropMeshTransform {
    offset: [number, number, number];
    scale: number;
}

export interface CropStageConfig {
    /** Seconds spent lerping through this stage before advancing to the next one — the LAST stage in a crop's own `stages` array is the harvestable one and has no "next," so this is ignored for it (see isCropReady()/resolveCropStage()). */
    durationSec: number;
    /** EntityViewRegistry.ts id for this stage's mesh — omitted keeps whichever mesh was already showing (see this file's own top doc). */
    mesh?: string;
    /** Lerp source, at this stage's own elapsed time 0. */
    start: CropMeshTransform;
    /** Lerp target, reached once this stage's own `durationSec` has fully elapsed. */
    end: CropMeshTransform;
}

export interface CropConfig {
    name: string;
    /** EntityViewRegistry.ts id shown the instant a seed is planted, before the first stage's own mesh (if any) takes over — optional, same "string key exists but has no models yet falls back to nothing" convention resolveEntityView() already uses elsewhere. */
    initialMesh?: string;
    /** Ordered from just-planted to harvestable — see resolveCropStage()/isCropReady(), the readers that index into this by elapsed growth time. The last entry is the harvestable stage. */
    stages: CropStageConfig[];
    /** Banked into BackpackStorage on harvest. */
    yield: {
        resourceType: ResourceType;
        amount: number;
    };
}

export const CROP_CONFIG: Record<CropId, CropConfig> = {
    [CropId.Wheat]: {
        name: "Wheat",
        stages: [
            {
                "durationSec": 20,
                "mesh": "bananaView",
                "start": {
                    "offset": [
                        0,
                        0,
                        0
                    ],
                    "scale": 0.2
                },
                "end": {
                    "offset": [
                        0,
                        0,
                        0
                    ],
                    "scale": 0.6
                }
            },
            {
                "durationSec": 20,
                "mesh": "bananaView",
                "start": {
                    "offset": [
                        0,
                        0,
                        0
                    ],
                    "scale": 0.6
                },
                "end": {
                    "offset": [
                        0,
                        0,
                        0
                    ],
                    "scale": 1
                }
            },
            {
                "durationSec": 0,
                "mesh": "bananaView",
                "start": {
                    "offset": [
                        0,
                        0,
                        0
                    ],
                    "scale": 1
                },
                "end": {
                    "offset": [
                        0,
                        0,
                        0
                    ],
                    "scale": 1
                }
            }
        ],
        yield: {
            "resourceType": ResourceType.Wood,
            "amount": 1
        },
        "initialMesh": "bananaView"
    },
};

/** Sum of every stage's own `durationSec` — the elapsed-time threshold at which a planted crop becomes harvestable (see isCropReady()). */
export function getCropTotalGrowSec(config: CropConfig): number {
    return config.stages.reduce((sum, stage) => sum + stage.durationSec, 0);
}

/** True once `plantedAtSec` (FarmCropStorage's own wall-clock timestamp) is far enough in the past for every stage's own `durationSec` to have elapsed — growth is computed from real elapsed time, not simulated tick-by-tick, so this stays correct across a reload same as GateStorage/QueueStorage's own cooldowns. */
export function isCropReady(config: CropConfig, plantedAtSec: number, nowSec: number = Date.now() / 1000): boolean {
    return nowSec - plantedAtSec >= getCropTotalGrowSec(config);
}

export interface ResolvedCropStage {
    stage: CropStageConfig;
    /** 0-1 normalized lerp progress within `stage` — CropVisualComponent.ts lerps stage.start/end by this. Pinned to 1 once `stage` is the last (harvestable) one. */
    t: number;
    /** Which EntityViewRegistry id should be showing right now — see CropStageConfig.mesh's own doc for why this can carry over from an earlier stage or `initialMesh`. */
    meshKey?: string;
}

/** Walks `config.stages` to find which one `elapsedSec` currently sits in — same "ordered array, index by current progress" shape as CropConfig.stages' own doc. */
export function resolveCropStage(config: CropConfig, elapsedSec: number): ResolvedCropStage {
    let acc = 0;
    let meshKey = config.initialMesh;

    for (let i = 0; i < config.stages.length; i++) {
        const stage = config.stages[i];
        meshKey = stage.mesh ?? meshKey;

        const isLast = i === config.stages.length - 1;
        if (isLast || elapsedSec < acc + stage.durationSec) {
            const t = stage.durationSec > 0 ? Math.min(1, Math.max(0, (elapsedSec - acc) / stage.durationSec)) : 1;
            return { stage, t, meshKey };
        }

        acc += stage.durationSec;
    }

    // Unreachable while config.stages is non-empty (the loop's `isLast` branch always returns
    // first) — only hit by a misconfigured CropConfig with an empty stages array.
    const fallback = config.stages[config.stages.length - 1];
    return { stage: fallback, t: 1, meshKey };
}
