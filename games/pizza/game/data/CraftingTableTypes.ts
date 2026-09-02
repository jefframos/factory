// CraftingTableTypes.ts
//
// A CRAFTING TABLE — tap-to-craft any of its own listed recipes, any number
// of times, exactly the same "walk up, tap Open, transact from a popup"
// shape as MartTypes.ts's own general store (see that file's own top doc)
// — NOT the existing single-active-recipe/auto-drain-while-standing-inside
// CraftTypes.ts/CraftZone.ts system, which is a different, unrelated entity
// kept exactly as-is. Keeping this as its own file/registry (rather than
// adding a third shape to either existing crafting file) is the same
// reasoning MartTypes.ts's own top doc gives for not bolting onto
// ShopTypes.ts: every existing entry in each of those files is one uniform
// shape already.
//
// A table's own `recipes` field is just a list of RECIPE IDS — the actual
// ingredients/result live once, shared, in CraftingRecipeTypes.ts's own
// CRAFTING_RECIPE_CONFIG (see that file's own doc for why: the same recipe
// can be listed on more than one table without duplicating it). Resolving
// an id with no matching entry there is handled by whoever reads
// `recipes` (CraftingTablePopup.ts), not this file.
//
// Same "default + per-id override" shape as MartTypes.ts's own
// DEFAULT_MART_CONFIG/MART_CONFIG_BY_ID (a "craftTable"-typed object drawn
// on the Tiled map's mapSettings layer, open-ended by id like marts/shops/
// crafting/farms) — getCraftingTableConfig() resolves the same way
// getMartConfig() does.

import { MilestoneRequirement } from './MilestoneRequirement';

export interface CraftingTableRecipeEntry {
    /** A CraftingRecipeTypes.CRAFTING_RECIPE_CONFIG id — see this file's own top doc. */
    recipeId: string;
}

export interface CraftingTableConfig {
    name: string;
    recipes: CraftingTableRecipeEntry[];
    /** Optional — when set, this table isn't spawned at all until MilestoneRequirement.ts's isMilestoneRequirementMet() says this is satisfied, same shared shape/reasoning as MartConfig.appearRequirement. undefined (the default) means "always appears." */
    appearRequirement?: MilestoneRequirement;
    /** 0-1 fraction of this table's own footprint that becomes a SOLID collider blocking the player while its appearRequirement isn't yet met — same shared 0/1/0.5 semantics every provider/building/shop/craft-table/queue/farm-plot/mart's `solid` field uses. undefined/0 (the default) means no solid collider. */
    solid?: number;
    /** EntityViewRegistry.ts id for this table's own real-mesh look — same "string key resolved via resolveEntityView()" join every other view field in this codebase uses. Undefined/an id with no models yet falls back to a placeholder box. */
    view?: string;
}

/** Applied to every discovered "craftTable" object unless CRAFTING_TABLE_CONFIG_BY_ID has an override for its id — see this file's own doc. Empty recipes by default; a level designer stocks it from the pizza web editor's Crafting Tables tab. */
export const DEFAULT_CRAFTING_TABLE_CONFIG: CraftingTableConfig = {
    "name": "Crafting Table",
    "recipes": []
};

/** Per-table-id overrides — sparse: only tables a level designer has actually customized need an entry. */
export const CRAFTING_TABLE_CONFIG_BY_ID: Partial<Record<string, CraftingTableConfig>> = {
    "forge1": {
        "name": "Forge 1",
        "recipes": [
            {
                "recipeId": "stone"
            },
            {
                "recipeId": "clothRoll"
            },
            {
                "recipeId": "hardwoodPlanks"
            }
        ],
        "solid": 0.5
    }
};

/** The config a crafting table with this id should use — its own override if CRAFTING_TABLE_CONFIG_BY_ID has one, else DEFAULT_CRAFTING_TABLE_CONFIG. */
export function getCraftingTableConfig(id: string): CraftingTableConfig {
    return CRAFTING_TABLE_CONFIG_BY_ID[id] ?? DEFAULT_CRAFTING_TABLE_CONFIG;
}
