// EntityViewRegistry.ts
//
// Optional real-mesh overrides for buildings/shops/gates/queues, keyed by a plain string id
// set from the pizza web editor's "Entity Views" tab. BuildingTypes.ts/ShopTypes.ts/
// GateTypes.ts/QueueTypes.ts each still own their own placeholder BoxGeometry config (size +
// color) as the default look; a level/config entry that also sets a `view` id (see e.g.
// BuildingLevelConfig.view) has its zone swap that box out for a real glb instead — see
// BuildingZone.createBuildingMesh() for the one fully-wired consumer today. Same
// "separate id-keyed lookup joined by convention, not a hardcoded per-type map" shape as
// AssetLibraryRegistry.ts, so buildings/shops/gates/queues can all share one view definition
// (e.g. the exact same watchtower model used as both a building level-3 view and a gate view)
// without this file needing to know which gameplay concept is using it.

import MODELS, { ModelDefinition } from '../../registry/assetsRegistry/modelsRegistry';
import { NumberRange, pickRandom, resolveRange } from './AssetLibraryRegistry';

export interface EntityViewConfig {
    /** Candidate models for this view — one is picked at random per spawn (see pickRandom()), same convention as AssetLibraryEntry.models. Empty = view id exists but has no glb yet; caller should fall back to its own placeholder mesh. */
    models: ModelDefinition[];
    /** Uniform scale applied to the picked model. */
    scale: NumberRange;
    /** Yaw rotation in degrees applied to the picked model. */
    rotationDeg: NumberRange;
    /** Local position offset from the owning zone's own transform — [x, y, z], world units. Plain numbers (not THREE.Vector3) so this data file stays engine-import-free, same convention as BuildingMeshConfig. */
    offset: [number, number, number];
}

/** Per-view-id config, set from the pizza web editor's "Entity Views" tab — empty by default; every building/shop/gate/queue keeps using its own box placeholder until a level/config entry opts in with a `view` id. */
export const ENTITY_VIEW_CONFIG: Record<string, EntityViewConfig> = {
    "shop1View": {
        "models": [MODELS.Tools.Anvil],
        "scale": 1.5,
        "rotationDeg": 0,
        "offset": [
            0,
            0,
            0
        ]
    },
    "tower2view": {
        "models": [MODELS.Pirate.TowerCompleteSmall],
        "offset": [
            0,
            0,
            0
        ],
        "scale": 1,
        "rotationDeg": 0
    },
    "tower1View": {
        "models": [MODELS.Pirate.TowerBase],
        "scale": 1,
        "rotationDeg": 0,
        "offset": [
            0,
            0,
            0
        ]
    },
    "gateAxeView": {
        "models": [MODELS.Props.Fence],
        "scale": 4,
        "rotationDeg": [
            1,
            1
        ],
        "offset": [
            0,
            0,
            0
        ]
    },
    "ship1View": {
        "models": [MODELS.Pirate.ShipMedium],
        "scale": 1,
        "rotationDeg": 0,
        "offset": [
            0,
            -1,
            0
        ]
    },
    "tower3view": {
        "models": [MODELS.Pirate.TowerCompleteLarge],
        "scale": 1,
        "rotationDeg": 0,
        "offset": [
            0,
            0,
            0
        ]
    },
    // FarmTypes.ts's FARM_TILE_CONFIG default — see that file's own doc. Placeholder ground
    // patches (nothing farm-specific in the model registry yet) so the Farms tab's Tile
    // Settings dropdowns resolve to a REAL glb via resolveEntityView() out of the box, same as
    // every other view id here, instead of pointing at an id with no models.
    "farmEmptyView": {
        "models": [MODELS.Props.PatchGrass],
        "scale": 2,
        "rotationDeg": 0,
        "offset": [
            0,
            0,
            0
        ]
    },
    "farmPreparedView": {
        "models": [MODELS.Props.PatchDirt],
        "scale": 2,
        "rotationDeg": 0,
        "offset": [
            0,
            -0.1,
            0
        ]
    },
    "bananaView": {
        "models": [MODELS.Food.Banana],
        "scale": 2,
        "rotationDeg": 0,
        "offset": [
            0,
            -0.1,
            0
        ]
    },
    // Real crop meshes — one view per CropTypes.ts crop, each referencing its own MODELS.Food.*
    // entry (see that registry's own model list — every one of these came from a
    // pizza-model-snapshots_Food-<Key>.png icon under raw-assets/images/farm{tps}/, snapshotted
    // straight off the matching MODELS.Food.<Key> model). Same offset/scale convention as
    // bananaView above (the Wheat crop's own temporary stand-in) — referenced from each crop's
    // own CropStageConfig.mesh/CropConfig.initialMesh in CropTypes.ts.
    "cropBeetView": {
        "models": [MODELS.Food.Beet],
        "scale": 1.5,
        "rotationDeg": 0,
        "offset": [0, -0.1, 0]
    },
    "cropBroccoliView": {
        "models": [MODELS.Food.Broccoli],
        "scale": 1.5,
        "rotationDeg": 0,
        "offset": [0, -0.1, 0]
    },
    "cropCabbageView": {
        "models": [MODELS.Food.Cabbage],
        "scale": 1.5,
        "rotationDeg": 0,
        "offset": [0, -0.1, 0]
    },
    "cropCarrotView": {
        "models": [MODELS.Food.Carrot],
        "scale": 1.5,
        "rotationDeg": 0,
        "offset": [0, -0.1, 0]
    },
    "cropCauliflowerView": {
        "models": [MODELS.Food.Cauliflower],
        "scale": 1.5,
        "rotationDeg": 0,
        "offset": [0, -0.1, 0]
    },
    "cropCornView": {
        "models": [MODELS.Food.Corn],
        "scale": 1.5,
        "rotationDeg": 0,
        "offset": [0, -0.1, 0]
    },
    "cropLeekView": {
        "models": [MODELS.Food.Leek],
        "scale": 1.5,
        "rotationDeg": 0,
        "offset": [0, -0.1, 0]
    },
    "cropMushroomView": {
        "models": [MODELS.Food.Mushroom],
        "scale": 1.5,
        "rotationDeg": 0,
        "offset": [0, -0.1, 0]
    },
    "cropPumpkinBasicView": {
        "models": [MODELS.Food.PumpkinBasic],
        "scale": 1.5,
        "rotationDeg": 0,
        "offset": [0, -0.1, 0]
    },
    "cropPumpkinView": {
        "models": [MODELS.Food.Pumpkin],
        "scale": 1.5,
        "rotationDeg": 0,
        "offset": [0, -0.1, 0]
    },
    "cropStrawberryView": {
        "models": [MODELS.Food.Strawberry],
        "scale": 1.5,
        "rotationDeg": 0,
        "offset": [0, -0.1, 0]
    },
    "cropTomatoView": {
        "models": [MODELS.Food.Tomato],
        "scale": 1.5,
        "rotationDeg": 0,
        "offset": [0, -0.1, 0]
    },
    "cropWatermelonView": {
        "models": [MODELS.Food.Watermelon],
        "scale": 1.5,
        "rotationDeg": 0,
        "offset": [0, -0.1, 0]
    }
};

export function getEntityView(id: string): EntityViewConfig | undefined {
    return ENTITY_VIEW_CONFIG[id];
}

/** Rolls one usable model + scale/rotation out of a view id — undefined if the id doesn't exist OR exists but has no models yet (see EntityViewConfig.models' own doc), either of which means "caller should fall back to its own placeholder mesh." */
export function resolveEntityView(id: string | undefined): { model: ModelDefinition; scale: number; rotationDeg: number; offset: [number, number, number] } | undefined {
    if (!id) {
        return undefined;
    }

    const config = ENTITY_VIEW_CONFIG[id];
    if (!config || config.models.length === 0) {
        return undefined;
    }

    return {
        model: pickRandom(config.models),
        scale: resolveRange(config.scale),
        rotationDeg: resolveRange(config.rotationDeg),
        offset: config.offset,
    };
}
