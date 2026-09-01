// ProviderTypes.ts
//
// Data-driven definition of a RESOURCE PROVIDER — the world dispenser the
// player actually swings/mines/forages at (a tree, a stone deposit, a
// berry bush). Split out from ResourceTypes.ts on purpose: a provider is
// "the thing in the world with an action/life/respawn cycle that YIELDS
// resources," while a ResourceType (see ResourceTypes.ts) is "the actual
// bankable item" — the same provider can yield more than one resource type
// (a stone deposit dropping mostly stone, sometimes pebble), and the same
// resource type can come from more than one source (loose ground-loot
// pickups, via DynamicResourceTypes.ts/LooseResourceNode.ts, need no
// provider at all). Before this file existed, ResourceType/RESOURCE_CONFIG
// conflated both roles into one enum — hitting a "tree" always banked
// "tree," with no way to express "tree yields wood, mostly" separately
// from "berry bush yields berries."
//
// A provider's WORLD APPEARANCE (models/scale/rotationDeg/icon) still lives
// in AssetLibraryRegistry.ts, same as before — see ProviderRegistry.ts's
// resolveProviderAssetKey() for the provider-id -> AssetLibraryKey mapping
// (parallel to ResourceRegistry.ts's resolveResourceAssetKey() for items).

import { ActionType } from './ActionTypes';
import { ResourceType } from './ResourceTypes';

export enum ProviderType {
    Tree = 'tree',
    BerryBush = 'berryBush',
    Palm = "palm",
    CrystalDeposit = "crystalDeposit",
    StoneDeposit = "stoneDeposit",
    IronDeposit = "ironDeposit"
}

/** One weighted entry in a provider's drop table — weights are relative, not required to sum to 100 (a 9/1 split reads identically to a 90/10 one). */
export interface ResourceDropEntry {
    resourceType: ResourceType;
    weight: number;
}

export interface ProviderConfig {
    /** Which timed action (see ActionTypes.ts) gathering this provider plays. */
    action: ActionType;
    /**
     * How many hit-points this node absorbs before it yields — the player chips this down
     * hitScale at a time (see ActionConfig), and partial progress SURVIVES walking away, so
     * this is "how much total work a full harvest is," not a timer.
     */
    maxLife: number;
    /** How many TOTAL units one successful gather cycle grants, before rollProviderDrop() decides what each individual unit actually turns out to be. */
    amountPerGather: number;
    /** Seconds the node stays depleted (hidden, trigger disabled) before it respawns — see ResourceNode.deplete()/respawn(). */
    respawnSec: number;
    /** Display name for UI (drop-zone deposit popup, etc.). */
    label: string;
    /** Placeholder color for this provider's primitive mesh until real art exists. */
    color: number;
    /** 0-1 fraction of this provider's own trigger footprint that becomes a SOLID collider blocking the player — see SolidArea.ts's own doc for the shared 0/1/0.5 semantics every provider/building/shop/craft-table/queue's `solid` field uses. undefined/0 means no solid collider at all (walk-through — a berry bush is low enough to step over; a tree/rock isn't). */
    solid?: number;
    /**
     * Weighted table of what one unit of yield actually turns out to be — see
     * rollProviderDrop(), the one reader (called once per unit yielded, not once per hit, so
     * a harvest converges to the real percentages instead of committing an entire swing to
     * one outcome). A single 100%-weight entry is the normal case for a provider with only
     * one thing to give (a tree only ever yields wood); more than one entry is what lets a
     * "stone" deposit yield mostly stone with an occasional pebble.
     */
    drops: ResourceDropEntry[];
    /** Optional continuous ambient particle effect (see ParticleRegistry.ts — PARTICLE_REGISTRY) this node emits for as long as it's NOT depleted — same "common to every entity" slot CraftTableConfig/GateConfig carry, wired via ParticleEmitterComponent in ResourceNode.awake() and toggled off/on by deplete()/respawn(). undefined means no particles at all. */
    particleEffectId?: string;
    /** Optional one-shot particle burst fired the instant this node is fully harvested (see ResourceNode.deplete()) — e.g. leaves scattering off a felled tree. undefined means no burst at all. */
    destroyParticleEffectId?: string;
    /** How many particles the burst above launches — ignored if destroyParticleEffectId isn't set. undefined falls back to a small default (see ResourceNode.deplete()). */
    destroyParticleCount?: number;
}

export const PROVIDER_CONFIG: Record<ProviderType, ProviderConfig> = {
    [ProviderType.Tree]: {
        action: ActionType.Chop,
        maxLife: 5,
        amountPerGather: 1,
        respawnSec: 60,
        label: "Tree",
        color: 0x6b4423,
        drops: [
            {
                "resourceType": ResourceType.Wood,
                "weight": 1
            }
        ],
        "solid": 0.5,
        "destroyParticleEffectId": "treeLeafBurst"
    },
    [ProviderType.BerryBush]: {
        action: ActionType.Gather,
        maxLife: 2,
        amountPerGather: 1,
        respawnSec: 50,
        label: "Berry Bush",
        color: 0xcc2244,
        drops: [
            {
                "resourceType": ResourceType.Berries,
                "weight": 1
            }
        ],
    },
    "palm": {
        color: 0x6b4423,
        "label": "PamlTree",
        "action": ActionType.Chop,
        "maxLife": 3,
        "amountPerGather": 2,
        "respawnSec": 60,
        "drops": [
            {
                "resourceType": ResourceType.Wood,
                "weight": 1
            }
        ]
    },
    "crystalDeposit": {
        color: 0x6b4423,
        "action": ActionType.Mine,
        "maxLife": 10,
        "amountPerGather": 1,
        "respawnSec": 120,
        "drops": [
            {
                "resourceType": ResourceType.Crystal,
                "weight": 1
            }
        ],
        "label": "CrystalDeposit",
        "solid": 1
    },
    "stoneDeposit": {
        color: 0x6b4423,
        "label": "Stone Deposit",
        "action": ActionType.Mine,
        "maxLife": 5,
        "amountPerGather": 1,
        "respawnSec": 80,
        "drops": [
            {
                "resourceType": ResourceType.Stone,
                "weight": 90
            },
            {
                "resourceType": ResourceType.Pebble,
                "weight": 10
            }
        ],
        "solid": 0.5
    },
    "ironDeposit": {
        color: 0x6b4423,
        "label": "Iron Deposit",
        "action": ActionType.Mine,
        "maxLife": 5,
        "amountPerGather": 1,
        "respawnSec": 80,
        "drops": [
            {
                "resourceType": ResourceType.Ir,
                "weight": 90
            },
            {
                "resourceType": ResourceType.Pebble,
                "weight": 10
            }
        ],
        "solid": 0.5
    }
};

/**
 * Resolves ONE unit of yield for `providerType` — a weighted random pick off its `drops`
 * table (relative weights, not required to sum to 100). Called once per unit banked, not
 * once per hit — see AutoGatherController.onHitLanded()'s own doc for why per-unit rolling
 * is what makes a weighted split converge to its actual percentages over a harvest instead
 * of committing an entire swing (or an entire node's lifetime) to one outcome.
 */
export function rollProviderDrop(providerType: ProviderType): ResourceType {
    const drops = PROVIDER_CONFIG[providerType].drops;
    const totalWeight = drops.reduce((sum, drop) => sum + drop.weight, 0);
    let roll = Math.random() * totalWeight;
    for (const drop of drops) {
        if (roll < drop.weight) {
            return drop.resourceType;
        }
        roll -= drop.weight;
    }
    // Floating-point rounding could theoretically leave `roll` fractionally over the last
    // entry's own weight after subtracting every prior one — falling back to the last entry
    // rather than undefined keeps this total, never "no drop happened."
    return drops[drops.length - 1].resourceType;
}
