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
    Ir = "iron",
    /** A CraftingRecipeTypes.ts ingredient/output — no provider/pickup path of its own yet, only ever gained by crafting it at a table (see CraftingTableTypes.ts's own doc). */
    ClothRoll = "clothRoll",
    /** Same "crafted-only, for now" reasoning as ClothRoll above. */
    HardwoodPlanks = "hardwoodPlanks",
    /** What catching a Pig (AnimalTypes.ts) banks — see AnimalNode.ts/AnimalCatchController.ts. Not gathered from any Provider/DynamicResource path at all, same "this file doesn't need to know or care which" independence this file's own doc already calls out for Bark/Pebble/GrassFiber. */
    Pig = "pig",
    /** CropTypes.ts's Wheat crop's own harvest yield — see ResourceConfig.category's own doc for why this is 'farm'-category (Farm tab only) rather than a main-HUD resource. */
    Wheat = "wheat",
    /** The rest of CropTypes.ts's own farm crops — same 'farm'-category harvest-yield reasoning as Wheat above, one per MODELS.Food.* model (see EntityViewRegistry.ts's own crop*View entries). */
    Beet = "beet",
    Broccoli = "broccoli",
    Cabbage = "cabbage",
    Carrot = "carrot",
    Cauliflower = "cauliflower",
    Corn = "corn",
    Leek = "leek",
    Mushroom = "mushroom",
    PumpkinBasic = "pumpkinBasic",
    Pumpkin = "pumpkin",
    Strawberry = "strawberry",
    Tomato = "tomato",
    Watermelon = "watermelon",
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
    /**
     * 'main' (the default when unset) shows this resource on the always-visible main-screen
     * panels (GlobalResourcesUI/BackpackListUI) same as every resource before this field
     * existed. 'farm' is a crop's own harvest yield (see CropTypes.ts's own `yield.resourceType`)
     * — those panels skip it entirely, and it only shows up in InventoryPopup's own Farm tab
     * (alongside SeedTypes.ts's seeds) so the main HUD doesn't get cluttered with a growing list
     * of individual crop yields the way Wood/Stone/Berries are meant to stay front-and-center.
     * 'animal' is what catching an AnimalTypes.ts animal banks (e.g. Pig) — purely a
     * classification label for the pizza web editor's own Resources tab filter (see that tab's
     * doc); it has NO runtime effect the way 'farm' does; an 'animal'-category resource still
     * shows on the main HUD same as 'main' does, since a caught pig is exactly as "front and
     * center" as any other bankable resource.
     */
    category?: 'main' | 'farm' | 'animal';
    /**
     * Base price a MartTypes.ts mart trades this resource at — undefined (the default) means
     * this resource can never be bought OR sold at any mart at all, regardless of whether some
     * MartConfig.offers entry lists it (see MartOffer.resourceType's own doc — a mart offering a
     * priceless resource is simply never buyable there). A mart's own `priceMultiplier` (default
     * 1) multiplies THIS for BUYING; SELLING back is always a flat MART_SELL_PRICE_MULTIPLIER
     * (80%) of this same base price, never the mart's own multiplier — see `sellable` below and
     * MartTypes.ts's getMartBuyPrice()/getMartSellPrice().
     */
    price?: number;
    /**
     * False blocks selling this resource back to ANY mart even though it still has a `price` (so
     * it can still be BOUGHT there) — e.g. a rare seasonal good a mart wants to sell but never
     * buy back. Defaults to true whenever `price` is set; meaningless when `price` is unset
     * (already unbuyable and unsellable everywhere).
     */
    sellable?: boolean;
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
        "price": 2,
        "sellable": true
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
    },
    [ResourceType.ClothRoll]: {
        amountPerGather: 1,
        label: "Cloth Roll",
        color: 0xd9c9a3,
    },
    [ResourceType.HardwoodPlanks]: {
        amountPerGather: 1,
        label: "Hardwood Planks",
        color: 0x8a5a2b,
    },
    "pig": {
        color: 0xe8a1c4,
        "label": "Pig",
        "amountPerGather": 1,
        "category": "animal"
    },
    [ResourceType.Wheat]: {
        amountPerGather: 1,
        label: "Wheat",
        color: 0xe0c341,
        category: "farm",
    },
    [ResourceType.Beet]: {
        amountPerGather: 1,
        label: "Beet",
        color: 0x8f2d56,
        category: "farm",
    },
    [ResourceType.Broccoli]: {
        amountPerGather: 1,
        label: "Broccoli",
        color: 0x4a7c3a,
        category: "farm",
    },
    [ResourceType.Cabbage]: {
        amountPerGather: 1,
        label: "Cabbage",
        color: 0x8fc95a,
        category: "farm",
        price: 4,
    },
    [ResourceType.Carrot]: {
        amountPerGather: 1,
        label: "Carrot",
        color: 0xe8791a,
        category: "farm",
    },
    [ResourceType.Cauliflower]: {
        amountPerGather: 1,
        label: "Cauliflower",
        color: 0xf2f2e6,
        category: "farm",
        price: 5,
    },
    [ResourceType.Corn]: {
        amountPerGather: 1,
        label: "Corn",
        color: 0xf2c94c,
        category: "farm",
    },
    [ResourceType.Leek]: {
        amountPerGather: 1,
        label: "Leek",
        color: 0x9fd357,
        category: "farm",
    },
    [ResourceType.Mushroom]: {
        amountPerGather: 1,
        label: "Mushroom",
        color: 0xc9a876,
        category: "farm",
    },
    [ResourceType.PumpkinBasic]: {
        amountPerGather: 1,
        label: "Pumpkin (Basic)",
        color: 0xe07a2c,
        category: "farm",
    },
    [ResourceType.Pumpkin]: {
        amountPerGather: 1,
        label: "Pumpkin",
        color: 0xd9631e,
        category: "farm",
    },
    [ResourceType.Strawberry]: {
        amountPerGather: 1,
        label: "Strawberry",
        color: 0xe0304f,
        category: "farm",
    },
    [ResourceType.Tomato]: {
        amountPerGather: 1,
        label: "Tomato",
        color: 0xd94430,
        category: "farm",
    },
    [ResourceType.Watermelon]: {
        amountPerGather: 1,
        label: "Watermelon",
        color: 0x3fae5c,
        category: "farm",
    },
};
