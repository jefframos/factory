// CarrierCapacity.ts
//
// How many farm items the CARRIER (the crate on the player's back — see
// PlayerConfig.carrier / CarrierStackVisual.ts) holds right now. Not the
// "backpack" inventory (BackpackStorage): that one has no limit.
//
// The carrier is a tool ("carrier" in ToolRegistry.ts) upgraded like the axe:
// at a shop whose `tool` is "carrier" (ShopTypes "shopBackpack"). Its level is
// the tool's startLevel + every level bought at such a shop, and its capacity
// is TOOL_LIBRARY.carrier.capacity lerped min -> max over maxLevel, rounded
// (min 3 / max 13 / maxLevel 10 = 3, then +1 per upgrade).
//
// Nothing is stored here — the shop level is the only saved state
// (ShopUpgradeStorage), so retuning the range in the Tools tab applies to
// existing saves too. Listen to ShopUpgradeStorage.onChange for changes.

import { getToolStartLevel, TOOL_LIBRARY, ToolId, ToolVisualEntry } from '../actions/ToolRegistry';
import { SHOP_CONFIG_BY_ID, ShopConfig } from '../shop/ShopTypes';
import { ShopUpgradeStorage } from '../shop/ShopUpgradeStorage';

export const CARRIER_TOOL_ID: ToolId = 'carrier';

/** Used if the carrier tool has no capacity range at all. */
const FALLBACK_CAPACITY = 3;

/** Every shop id that sells carrier upgrades (normally just one). */
export function getCarrierShopIds(): string[] {
    return (Object.entries(SHOP_CONFIG_BY_ID) as [string, ShopConfig | undefined][])
        .filter(([, config]) => config?.tool === CARRIER_TOOL_ID && !config.disabled)
        .map(([id]) => id);
}

/** Ladder level: the tool's startLevel plus every carrier level bought so far, capped at maxLevel. */
export function getCarrierLevel(): number {
    const entry = TOOL_LIBRARY[CARRIER_TOOL_ID] as ToolVisualEntry;
    const bought = getCarrierShopIds().reduce((sum, id) => sum + ShopUpgradeStorage.getLevel(id), 0);
    return Math.min(entry.maxLevel, getToolStartLevel(CARRIER_TOOL_ID) + bought);
}

/** Items the carry stack can hold right now — see this file's own doc. */
export function getCarrierCapacity(): number {
    const entry = TOOL_LIBRARY[CARRIER_TOOL_ID] as ToolVisualEntry;
    const range = entry.capacity;
    if (range?.min === undefined) {
        return FALLBACK_CAPACITY;
    }
    if (range.max === undefined || entry.maxLevel <= 0) {
        return Math.round(range.min);
    }
    return Math.round(range.min + (range.max - range.min) * (getCarrierLevel() / entry.maxLevel));
}
