// GateTypes.ts
//
// Data-driven definition of a world-expansion gate — a solid obstacle that
// blocks further progress until a building reaches a required level (see
// GateStorage.ts for the persisted unlock state, Gate.ts for the entity
// that reads this). Same "just a config entry" philosophy as
// ResourceTypes.ts/BuildingTypes.ts.

import { BuildingId } from './BuildingTypes';

export enum GateId {
    /** Matches the "id" custom property on the Tiled map's "mapSettings" objectgroup layer — see WorldObjectRegistry.ts. Not "North": gate ids are just whatever's authored in Tiled, with no assumed direction/position. */
    Gate1 = 'gate1',
}

export interface GateRequirement {
    buildingId: BuildingId;
    /** The building must be AT LEAST this level — see Gate.isRequirementMet(). */
    level: number;
}

/** Placeholder box art, same convention as BuildingTypes.ts's BuildingMeshConfig — plain numbers so this data file stays engine-import-free. */
export interface GateMeshConfig {
    /** [width, height, depth], world units. */
    size: [number, number, number];
    color: number;
}

export interface GateConfig {
    name: string;
    /** World-space spawn position — [x, y, z]. */
    position: [number, number, number];
    requirement: GateRequirement;
    mesh: GateMeshConfig;
}

export const GATE_CONFIG: Record<GateId, GateConfig> = {
    [GateId.Gate1]: {
        name: 'North Gate',
        position: [0, 0, -16],
        requirement: { buildingId: BuildingId.Camp, level: 2 },
        mesh: { size: [4, 3, 1], color: 0x555555 },
    },
};
