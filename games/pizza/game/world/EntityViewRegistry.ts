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
        "models": [MODELS.Pirate.TowerCompleteLarge],
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
