// BuildingTypes.ts
//
// Data-driven definition of a building's upgrade ladder — same philosophy as
// ResourceTypes.ts's RESOURCE_CONFIG: BuildingZone/BuildingStorage read this
// instead of hardcoding per-building/per-level branches, so a new building or
// an extra level is just a new config entry.
//
// Each level is a rung on the ladder: `requirements` is what must be
// deposited (on top of whatever the previous rungs already consumed) to
// clear that level, and `effect` is what the building actually DOES once
// that level completes — data only for now (nothing reads `effect` yet),
// but shaped so a future gameplay system can key off `type` without this
// file changing again.

import { ResourceType } from '../actions/ResourceTypes';

export enum BuildingId {
    Camp = 'camp',
}

export interface BuildingEffect {
    /** Machine-readable effect kind — the hook point for whatever system eventually applies this (e.g. 'backpackCapacity', 'gatherSpeed'). Nothing reads this yet. */
    type: string;
    /** Magnitude of the effect — units depend on `type` (a flat capacity bump, a percentage multiplier, ...). */
    value: number;
    /** Human-readable summary for UI — e.g. "+5 backpack capacity". */
    description: string;
}

/**
 * Placeholder box art for a building at a given level — same "plain colored primitive until
 * real art exists" convention as ResourceConfig.color/solidRadius. Plain numbers (not
 * THREE.Vector3) so this data file stays engine-import-free, same as ResourceTypes.ts/
 * BuildingTypes.ts's other configs — BuildingZone is the one place that turns this into an
 * actual THREE.BoxGeometry.
 */
export interface BuildingMeshConfig {
    /** [width, height, depth], world units. */
    size: [number, number, number];
    color: number;
}

export interface BuildingLevelConfig {
    /** 1-based — matches BuildingStorage's persisted `level` once this rung is cleared. */
    level: number;
    /** Resources needed to clear this level, deposited via BuildingZone. */
    requirements: Partial<Record<ResourceType, number>>;
    effect: BuildingEffect;
    /** What the building looks like once THIS level is cleared — see getMeshConfigForLevel(). */
    mesh: BuildingMeshConfig;
}

export interface BuildingConfig {
    name: string;
    /** What the building looks like before its first level is ever cleared (level 0) — a small foundation/stub, distinct from every subsequent level's own `mesh`. */
    baseMesh: BuildingMeshConfig;
    /** Ordered ascending by `level` — BuildingStorage/BuildingZone index into this by `currentLevel` to find the next rung. */
    levels: BuildingLevelConfig[];
}

export const BUILDING_CONFIG: Record<BuildingId, BuildingConfig> = {
    [BuildingId.Camp]: {
        name: 'Camp',
        baseMesh: { size: [1, 0.6, 1], color: 0x8899aa },
        levels: [
            {
                level: 1,
                requirements: { [ResourceType.Tree]: 5 },
                effect: { type: 'backpackCapacity', value: 5, description: '+5 backpack capacity' },
                mesh: { size: [1.4, 1.2, 1.4], color: 0x996633 },
            },
            {
                level: 2,
                requirements: { [ResourceType.Tree]: 8, [ResourceType.Stone]: 5 },
                effect: { type: 'backpackCapacity', value: 10, description: '+10 backpack capacity' },
                mesh: { size: [1.8, 1.8, 1.8], color: 0xcc8844 },
            },
            {
                level: 3,
                requirements: { [ResourceType.Tree]: 12, [ResourceType.Stone]: 10, [ResourceType.Berries]: 6 },
                effect: { type: 'gatherSpeed', value: 0.2, description: '+20% gather speed' },
                mesh: { size: [2.2, 2.6, 2.2], color: 0xffcc55 },
            },
        ],
    },
};

/** `undefined` once every level in the ladder is already cleared (see BuildingStorage.isMaxLevel()). */
export function getNextLevelConfig(id: BuildingId, currentLevel: number): BuildingLevelConfig | undefined {
    return BUILDING_CONFIG[id].levels[currentLevel];
}

/** The building's current look — baseMesh at level 0, otherwise that level's own mesh. See BuildingZone's mesh-swap on level-up. */
export function getMeshConfigForLevel(id: BuildingId, level: number): BuildingMeshConfig {
    const config = BUILDING_CONFIG[id];
    return level <= 0 ? config.baseMesh : (config.levels[level - 1]?.mesh ?? config.baseMesh);
}
