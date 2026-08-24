// CraftTypes.ts
//
// Data-driven definition of a CRAFTING TABLE — same "pure data, no engine
// imports" shape as BuildingTypes.ts/ShopTypes.ts. A craft table id comes
// straight from whatever's drawn on the Tiled map's "craft" objects (see
// WorldObjectRegistry.getAllOfType()/PizzaScene.setupCraftTables()), same
// open-ended-string convention QueueTypes.ts/ShopTypes.ts use — but like a
// shop (and unlike a queue's DEFAULT_QUEUE_CONFIG fallback), a craft table
// has no sensible default: it has to know what it can actually craft, so an
// id with no entry in CRAFT_CONFIG_BY_ID just doesn't spawn a CraftZone at
// all (see PizzaScene.setupCraftTables()'s own doc).
//
// Unlike BuildingConfig's single upgrade LADDER (one requirement set at a
// time, strictly ordered), a craft table's `recipes` are INDEPENDENT — each
// one has its own resource cost and its own item payout, and
// CraftStorage.getNextRecipe() just walks the list for the first one not
// yet crafted. There's no reason to force a build order on a level designer
// who wants a table where "axe" and "pickaxe" can be made in either order.
//
// `destroyOnComplete` is the "one-shot table" vs "permanent table" switch a
// level designer sets per craft id: true removes the CraftZone entirely
// once every recipe's been crafted (see CraftZone.update()) — useful for a
// starter table that hands out one axe/pickaxe and then gets out of the
// way. false keeps the table around forever even once every recipe is
// crafted (e.g. a permanent forge), which is also how a table meant to
// produce rarer/"good" items should be configured — nothing about a rare
// payout requires the table to disappear once granted.

import { ResourceType } from '../actions/ResourceTypes';
import { ItemType } from './ItemTypes';
import { MilestoneRequirement } from '../data/MilestoneRequirement';

export interface CraftRecipeDef {
    /** Unique within this table's own `recipes` list — CraftStorage tracks completion per (craftId, recipeId) pair. */
    id: string;
    result: {
        item: ItemType;
        amount: number;
    };
    /** Resources needed to craft this recipe, deposited via CraftZone — same shape as BuildingLevelConfig.requirements. */
    cost: Partial<Record<ResourceType, number>>;
}

export interface CraftTableConfig {
    name: string;
    /** Independent recipes this table can craft — see this file's own doc for why order doesn't matter beyond CraftStorage.getNextRecipe()'s scan order. */
    recipes: CraftRecipeDef[];
    /** Whether this table removes itself once every recipe above has been crafted — see this file's own doc. */
    destroyOnComplete: boolean;
    /**
     * Optional — when set, this table isn't spawned at all until MilestoneRequirement.ts's
     * isMilestoneRequirementMet() says this is satisfied. Same shared requirement shape
     * GateConfig.requirement/QueueConfig.appearRequirement use — BUT checked inline in
     * PizzaScene.setupCraftTables() rather than through RequirementRegistry's spawn-gate role
     * (see that registry's own doc): a craft table can be destroyed and later rebuilt (Clear
     * Data resetting a `destroyOnComplete` table back to not-yet-crafted), which conflicts
     * with a spawn gate's "fires once, forever" contract. undefined means "always appears,"
     * unchanged from before this field existed.
     */
    appearRequirement?: MilestoneRequirement;
}

/** Per-craft-table-id config — see this file's own doc for why (unlike QueueTypes' DEFAULT_QUEUE_CONFIG) there's no fallback for an id not listed here. */
export const CRAFT_CONFIG_BY_ID: Partial<Record<string, CraftTableConfig>> = {
    craft1: {
        name: "Crafting Table",
        recipes: [
            {
                "id": "pickaxe",
                "result": {
                    "item": ItemType.Pickaxe,
                    "amount": 1
                },
                "cost": {
                    "wood": 5
                }
            }
        ],
        destroyOnComplete: true,
    },
    // The player's very first tool — costs Bark (bare-handed, no tool needed to gather it —
    // see ResourceTypes.ts's ResourceType.Bark), specifically so a brand new player with zero
    // tools (see ItemStorage's DEFAULT_STARTING_ITEMS) has SOMETHING they can gather to get
    // started. Crafting the axe here is what GateTypes.ts's GateId.GateAxe (an item-requirement
    // gate) is waiting on — see CraftZone.ts's own notifyItemCrafted() call.
    craftAxe: {
        name: "Axe Crafting Table",
        recipes: [
            {
                "id": "axe",
                "result": {
                    "item": ItemType.Axe,
                    "amount": 1
                },
                "cost": {
                    "bark": 5
                }
            }
        ],
        destroyOnComplete: true,
    },
};

export function getCraftConfig(id: string): CraftTableConfig | undefined {
    return CRAFT_CONFIG_BY_ID[id];
}
