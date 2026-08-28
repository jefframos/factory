// GateTypes.ts
//
// Data-driven definition of a world-expansion gate — a solid obstacle that
// blocks further progress until some OTHER game milestone happens (see
// GateStorage.ts for the persisted unlock state, Gate.ts for the entity
// that reads this). Same "just a config entry" philosophy as
// ResourceTypes.ts/BuildingTypes.ts.
//
// A gate's requirement is MilestoneRequirement.ts's own shared union
// (building level-ups, crafting a particular item — see that file's own
// doc) rather than a type of its own; QueueTypes.ts's QueueConfig.
// appearRequirement reads the exact same shape, for the exact same reason
// (a queue that shouldn't even appear until some milestone happens). Adding
// a new milestone KIND is a MilestoneRequirement.ts change, not a
// GateTypes.ts one — nothing about an EXISTING gate's config needs to
// change either way.

import { BuildingId } from './BuildingTypes';
// GATE_CONFIG references ItemType.Axe as a VALUE, not just a type — same "data file
// importing a typed id from elsewhere" precedent ShopTypes.ts already sets by importing
// ToolRegistry's ToolId.
import { ItemType } from '../crafting/ItemTypes';
import { MilestoneRequirement } from './MilestoneRequirement';
import { FrameName } from '../ui/FrameRegistry';
import { ResourceType } from "../actions/ResourceTypes";

/** Alias kept for readability at GateConfig's own call sites — see this file's own doc for why the underlying type is shared with QueueTypes.ts rather than defined here. */
export type GateRequirement = MilestoneRequirement;

export enum GateId {
    /** Matches the "id" custom property on the Tiled map's "mapSettings" objectgroup layer — see WorldObjectRegistry.ts. Not "North": gate ids are just whatever's authored in Tiled, with no assumed direction/position. */
    Gate1 = 'gate1',
    /** Opens once the player crafts their first axe (see CraftTypes.ts's "craftAxe" table) — already drawn on the Tiled map. */
    GateAxe = 'gateAxe',
    GateTest = "gateTest"
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
    /** Optional real-mesh override, keyed into EntityViewRegistry.ts's ENTITY_VIEW_CONFIG — see BuildingLevelConfig.view's own doc for the full convention. undefined keeps the box placeholder (`mesh` above), unchanged from before this field existed. */
    view?: string;
    /** Added ON TOP of `view`'s own resolved rotationDeg (see EntityViewRegistry.resolveEntityView()) — lets more than one gate share the SAME view definition (the same watchtower/fence model) while each still faces the right way for its own spot on the map, without needing a separate near-duplicate EntityViewRegistry entry per gate. Ignored when `view` isn't set. undefined/0 = no correction, unchanged from before this field existed. */
    viewRotationOffsetDeg?: number;
    /** Multiplied onto `view`'s own resolved scale (see EntityViewRegistry.resolveEntityView()) — same "share one view, adjust per gate" reasoning as viewRotationOffsetDeg, for size instead of facing (e.g. a gate needing a visibly bigger/smaller version of the shared model to fit its own opening). Ignored when `view` isn't set. undefined/1 = no adjustment, unchanged from before this field existed. */
    viewScaleMultiplier?: number;
    /** Overrides FrameRegistry.ts's 'GateLock' default for THIS gate's own icon panel — see PopupConfig.ts's resolvePopupFrameName()'s own doc/Gate.ts's buildLabel(). undefined uses 'GateLock'. */
    frame?: FrameName;
    /** Optional continuous ambient particle effect (see ParticleRegistry.ts — PARTICLE_REGISTRY) drifting off this gate for as long as it stands — same "common to every entity" slot CraftTableConfig/ProviderConfig carry, wired via a plain ParticleEmitterComponent in Gate.awake(). undefined means no particles at all. */
    particleEffectId?: string;
    /** Optional one-shot particle burst (see ParticleRegistry.ts — PARTICLE_REGISTRY) fired the instant this gate's mesh finishes its collapse animation — see Gate.collapseMesh(). undefined means no burst at all, unchanged from before this field existed. */
    destroyParticleEffectId?: string;
    /** How many particles the burst above launches — ignored if destroyParticleEffectId isn't set. undefined falls back to a small default (see Gate.collapseMesh()). */
    destroyParticleCount?: number;
}

export const GATE_CONFIG: Record<GateId, GateConfig> = {
    [GateId.Gate1]: {
        name: "North Gate",
        position: [0, 0, -16],
        requirement: {
            "type": "building",
            "buildingId": BuildingId.Camp,
            "level": 2
        },
        mesh: { size: [4, 3, 1], color: 0x555555 },
    },
    [GateId.GateAxe]: {
        name: "Axe Gate",
        // Fallback only — the level designer already drew "gateAxe" on the Tiled map's
        // "mapSettings" layer (see WorldObjectRegistry.ts/PizzaScene.setupGates()), so this
        // exact position is only ever used if that object goes missing.
        position: [-12, 0, 21],
        requirement: {
            "type": "item",
            "item": ItemType.Axe
        },
        mesh: { size: [4, 3, 1], color: 0x555555 },
        "view": "gateAxeView"
    },
    "gateTest": {
        position: [0, 0, -16],
        mesh: { size: [4, 3, 1], color: 0x555555 },
        "name": "gateTest",
        "view": "gateAxeView",
        "requirement": {
            "type": "resource",
            "resourceType": ResourceType.Stone,
            "amount": 1
        }
    }
};
