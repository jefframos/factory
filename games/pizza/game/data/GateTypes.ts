// GateTypes.ts
//
// Data-driven definition of a world-expansion gate — a solid obstacle that
// blocks further progress until some OTHER game milestone happens (see
// GateStorage.ts for the persisted unlock state, Gate.ts for the entity
// that reads this). Same "just a config entry" philosophy as
// ResourceTypes.ts/BuildingTypes.ts.
//
// A gate's requirement is a small discriminated union rather than a single
// fixed shape — building level-ups (the original milestone) and crafting a
// particular item (see ItemTypes.ts) are both "a game milestone just
// happened," but need different data to describe (buildingId+level vs. just
// an item) and different storage to check against (BuildingStorage vs.
// ItemStorage — see Gate.isRequirementMet()). Adding a THIRD milestone kind
// later (a queue delivered N times, a shop upgrade bought, ...) is another
// arm of this union plus a matching case in Gate.ts/GateManager.ts/
// WorldProgressionHost.ts — nothing about an EXISTING gate's config needs to
// change.

import { BuildingId } from './BuildingTypes';
// ItemGateRequirement below needs the actual runtime enum (GATE_CONFIG references
// ItemType.Axe as a VALUE, not just a type) — same "data file importing a typed id from
// elsewhere" precedent ShopTypes.ts already sets by importing ToolRegistry's ToolId.
import { ItemType } from '../crafting/ItemTypes';

export enum GateId {
    /** Matches the "id" custom property on the Tiled map's "mapSettings" objectgroup layer — see WorldObjectRegistry.ts. Not "North": gate ids are just whatever's authored in Tiled, with no assumed direction/position. */
    Gate1 = 'gate1',
    /** Opens once the player crafts their first axe (see CraftTypes.ts's "craftAxe" table) — already drawn on the Tiled map. */
    GateAxe = 'gateAxe',
}

/** A building must be AT LEAST `level` — the original (and still default) milestone kind. */
export interface BuildingGateRequirement {
    type: 'building';
    buildingId: BuildingId;
    level: number;
}

/** The player must own at least one `item` — see ItemStorage.hasCount(). Met the instant ANY craft table (or future source) hands out that item, not tied to one specific table's id. */
export interface ItemGateRequirement {
    type: 'item';
    item: ItemType;
}

export type GateRequirement = BuildingGateRequirement | ItemGateRequirement;

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
        requirement: { type: 'building', buildingId: BuildingId.Camp, level: 2 },
        mesh: { size: [4, 3, 1], color: 0x555555 },
    },
    [GateId.GateAxe]: {
        name: 'Axe Gate',
        // Fallback only — the level designer already drew "gateAxe" on the Tiled map's
        // "mapSettings" layer (see WorldObjectRegistry.ts/PizzaScene.setupGates()), so this
        // exact position is only ever used if that object goes missing.
        position: [-12, 0, 21],
        requirement: { type: 'item', item: ItemType.Axe },
        mesh: { size: [4, 3, 1], color: 0x555555 },
    },
};
