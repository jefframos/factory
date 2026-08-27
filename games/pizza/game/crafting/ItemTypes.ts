// ItemTypes.ts
//
// Data-driven definition of a CRAFTED item — the thing CraftZone/CraftStorage
// hand out on a completed recipe (see CraftTypes.ts), separate from
// ResourceType (a gathered/deposited raw material tracked by BackpackStorage).
// An item is a countable good tracked by ItemStorage (equippable tools for
// now — axe/pickaxe — but the same shape covers a future non-tool item just
// as well).
//
// Both current items already have a ToolRegistry entry (for how they look
// held in the player's hand), so ITEM_CONFIG just points at that same ToolId
// rather than duplicating an icon — see getItemIcon().

import * as PIXI from 'pixi.js';
import { getToolIcon, ToolId } from '../actions/ToolRegistry';

export enum ItemType {
    Axe = 'axe',
    Pickaxe = 'pickaxe',
    Rope = "rope"
}

export interface ItemConfig {
    label: string;
    /** ToolRegistry id this item shares its icon/hand-visual with. */
    toolId: ToolId;
}

export const ITEM_CONFIG: Record<ItemType, ItemConfig> = {
    [ItemType.Axe]: { label: "Axe", toolId: 'axe' },
    [ItemType.Pickaxe]: { label: "Pickaxe", toolId: 'pickaxe' },
    "rope": {
        // Was 'axe' — a leftover from before ToolRegistry had its own dedicated 'rope' entry
        // (real model: MODELS.Tools.RopeBundleA). Nothing currently equips this item's tool
        // in-hand (catching an animal — see AnimalCatchController.ts — is a presence timer,
        // not a hand-tool action), but any future UI/inventory view showing this item's icon
        // should show the rope, not the axe it inherited by copy-paste.
        toolId: 'rope',
        "label": "Rope"
    }
};

/** `ITEM_CONFIG[type]`'s icon, as an actual texture — see ItemConfig.toolId's own doc. */
export function getItemIcon(type: ItemType): PIXI.Texture {
    return getToolIcon(ITEM_CONFIG[type].toolId);
}
