// CraftingRecipeTypes.ts
//
// The shared RECIPE POOL every CraftingTableTypes.ts table draws from — a
// recipe (N units of one or more resources -> 1 output amount) is
// game-design content owned by ITS OWN id, not duplicated per table, so the
// same "5 Pebble -> 1 Stone" recipe can be listed on Forge1 AND Forge2
// without maintaining two copies that could drift apart. A CraftingTable's
// own `recipes` field (see that file's own doc) is just a list of recipe
// ids picked from here — same "open-ended by hand-typed id" shape as
// shops/crafting (CRAFT_CONFIG_BY_ID), not enum-backed, since a level
// designer invents new recipe ids freely from the editor's own Crafting
// Recipes tab.

import { ResourceType } from '../actions/ResourceTypes';

export interface CraftingRecipeOutput {
    resourceType: ResourceType;
    amount: number;
}

export interface CraftingRecipeConfig {
    /** What this recipe consumes — same Partial<Record<ResourceType, number>> shape (the editor's `costMap` field type) as CraftTypes.CraftRecipeDef's own `cost`. */
    ingredients: Partial<Record<ResourceType, number>>;
    result: CraftingRecipeOutput;
}

/** Every registered recipe, keyed by its own hand-typed id — sparse/open-ended, stocked from the pizza web editor's Crafting Recipes tab. */
export const CRAFTING_RECIPE_CONFIG: Partial<Record<string, CraftingRecipeConfig>> = {
    "stone": {
        "ingredients": {
            "pebble": 5
        },
        "result": {
            "resourceType": ResourceType.Stone,
            "amount": 1
        }
    },
    "clothRoll": {
        "ingredients": {
            "grassFiber": 4
        },
        "result": {
            "resourceType": ResourceType.ClothRoll,
            "amount": 1
        }
    },
    "hardwoodPlanks": {
        "ingredients": {
            "wood": 3
        },
        "result": {
            "resourceType": ResourceType.HardwoodPlanks,
            "amount": 1
        }
    }
};

/** The recipe registered under `id`, or undefined if a CraftingTableConfig lists an id with no (or a since-deleted) CraftingRecipeConfig entry — callers skip it (with a warning) rather than crashing, same "misconfiguration, not a crash" convention MartPopup.renderBuyTab() uses for an offer with no price. */
export function getCraftingRecipe(id: string): CraftingRecipeConfig | undefined {
    return CRAFTING_RECIPE_CONFIG[id];
}
