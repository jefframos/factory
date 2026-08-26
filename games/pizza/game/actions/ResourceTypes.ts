// ResourceTypes.ts
//
// Data-driven definition of a BANKABLE RESOURCE — the actual item that ends
// up in BackpackStorage (a label + display color + how much one pickup/
// gather-unit is worth). Deliberately holds NOTHING about how a resource
// gets INTO the backpack — that's ProviderTypes.ts's job for anything
// dispensed by a world node (a tree, a stone deposit, a berry bush — see
// that file's own doc for why this split exists) or DynamicResourceTypes.ts/
// LooseResourceNode.ts for loose ground loot picked up on contact, no
// provider/action involved at all. The same resource type can come from
// either path (or several providers at once, via a weighted drop table) —
// this file doesn't need to know or care which.

export enum ResourceType {
    /** What a Tree provider dispenses (see ProviderTypes.ts) — the enum id matches its own display label now (renamed from the historical `Tree = 'tree'`, which predated ProviderTypes.ts's provider/resource split). */
    Wood = 'wood',
    Stone = 'stone',
    Berries = 'berries',
    /** Loose ground loot — a wood log's bark, picked up whole (see LooseResourceNode.ts/DynamicResourceSpawner.ts). A separate BackpackStorage bucket from Wood's own pool, by design: this is dynamically-spawned test loot, not the same pool a chopped tree fills. Scattered on "sand" spawner clusters — see DynamicResourceTypes.ts. */
    Bark = 'bark',
    /** Loose ground loot, same instant-pickup shape as Bark (see LooseResourceNode.ts/DynamicResourceSpawner.ts) — scattered on "grass" spawner clusters instead of "sand." A separate BackpackStorage bucket from Stone's own pool, by design, same reasoning as Bark's. */
    Pebble = 'pebble',
    /** Loose ground loot, same instant-pickup shape as Bark/Pebble — also scattered on "grass" spawner clusters (see DynamicResourceTypes.ts). Visual varies per spawn between MODELS.Pirate.GrassPlant and MODELS.Pirate.Grass (see AssetLibraryRegistry.ts's own "grassFiber" entry), but every pickup banks the same flat amountPerGather regardless of which model got picked. */
    GrassFiber = 'grassFiber',
    Crystal = "crystal",
    Ir = "iron"
}

export interface ResourceConfig {
    /**
     * How much of this resource one gather/pickup UNIT is worth — for a provider-dispensed
     * resource (see ProviderTypes.ts), the provider's OWN amountPerGather sets how many total
     * units a harvest yields; this multiplies each one. For loose ground loot (see
     * LooseResourceNode.ts), this is read directly — a pickup has no provider/action to also
     * carry an amountPerGather of its own.
     */
    amountPerGather: number;
    /** Display name for UI (drop-zone deposit popup, backpack slot, etc.). */
    label: string;
    /** Placeholder color for this resource's primitive mesh until real art exists — used by LooseResourceNode's box fallback; a provider-dispensed resource's placeholder color comes from the PROVIDER's own config instead (see ProviderTypes.ts), since that's the thing actually rendered in the world. */
    color: number;
}

export const RESOURCE_CONFIG: Record<ResourceType, ResourceConfig> = {
    [ResourceType.Wood]: {
        amountPerGather: 1,
        label: "Wood",
        color: 0x6b4423,
    },
    [ResourceType.Stone]: {
        amountPerGather: 1,
        label: "Stone",
        color: 0x8a8a8a,
    },
    [ResourceType.Berries]: {
        amountPerGather: 1,
        label: "Berries",
        color: 0xcc2244,
    },
    [ResourceType.Bark]: {
        amountPerGather: 1,
        label: "Bark",
        color: 0x6b4423,
    },
    [ResourceType.Pebble]: {
        amountPerGather: 1,
        label: "Pebble",
        color: 0x9a9a9a,
    },
    [ResourceType.GrassFiber]: {
        amountPerGather: 2,
        label: "Grass Fiber",
        color: 0x6ccb5f,
    },
    "crystal": {
        color: 0x6b4423,
        "label": "Crystal",
        "amountPerGather": 1
    },
    "iron": {
        color: 0x6b4423,
        "label": "Iron",
        "amountPerGather": 1
    }
};
