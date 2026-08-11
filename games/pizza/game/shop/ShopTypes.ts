// ShopTypes.ts
//
// Data-driven definition of a tool-upgrade shop — same "pure data, no engine
// imports" shape as BuildingTypes.ts/QueueTypes.ts. A shop id comes straight
// from whatever's drawn on the Tiled map's "shop" objects (see
// WorldObjectRegistry.getAllOfType()/PizzaScene.setupShops()), same
// open-ended-string convention QueueTypes.ts uses for queues — BUT unlike a
// queue (which falls back to DEFAULT_QUEUE_CONFIG for any unrecognized id), a
// shop has no sensible default: it has to know which tool/action it upgrades,
// so an id with no entry in SHOP_CONFIG_BY_ID just doesn't spawn a ShopZone at
// all (see PizzaScene.setupShops()'s own doc).
//
// Each shop sells a straight-line upgrade LADDER for one ToolRegistry tool:
// `levels[n]` is what buying the (n+1)th upgrade costs and what it changes
// about that tool's ActionConfig (see ActionTypes.ts) — hitIntervalSec makes
// it faster, damagePerHit makes it collect more per hit. A level only needs
// to set whichever field it's upgrading; applyShopLevel() below only touches
// the fields actually present, so e.g. a "faster" level doesn't reset
// damagePerHit back to its base value.

import { ACTION_CONFIG, ActionType, BASE_ACTION_CONFIG } from '../actions/ActionTypes';
import { ToolId } from '../actions/ToolRegistry';

/** Texture alias (packed 'ui' image bundle, shared Kenney-style UI kit) shown wherever a shop wants to flag "there's an upgrade ready to buy" — see ShopZone's badge sprite. One shared constant (not per-ShopConfig) since every shop uses the same indicator art; a future shop wanting a different one can still override it locally without this needing to change. */
export const SHOP_UPGRADE_AVAILABLE_ICON = 'Slider_Level02_Icon_Up_Green';

export interface ShopUpgradeLevel {
    /** CurrencyType.Money cost to buy this level — see ShopZone's continuous coin-deposit flow. */
    cost: number;
    /** Seconds after buying this level before the NEXT one can be started — see ShopUpgradeStorage.isOnCooldown(). */
    cooldownSec: number;
    /** Absolute override (not a delta) for ACTION_CONFIG[config.action].hitIntervalSec — omit to leave whatever the previous level left it at. */
    hitIntervalSec?: number;
    /** Absolute override (not a delta) for ACTION_CONFIG[config.action].damagePerHit — omit to leave whatever the previous level left it at. */
    damagePerHit?: number;
}

/** The shop's own placeholder mesh — same shape as BuildingTypes.ts's BuildingMeshConfig, just one fixed mesh (no per-level growth) since a shop's ladder is about the TOOL, not the shop building itself. */
export interface ShopMeshConfig {
    size: [number, number, number];
    color: number;
}

export interface ShopConfig {
    name: string;
    tool: ToolId;
    action: ActionType;
    mesh: ShopMeshConfig;
    /** Buying upgrade N+1 (0-indexed here) applies levels[N] — see applyShopLevel(). A shop at levels.length is maxed out (see ShopUpgradeStorage.isMaxLevel()). */
    levels: ShopUpgradeLevel[];
}

const DEFAULT_SHOP_MESH: ShopMeshConfig = { size: [2, 2, 2], color: 0x8855cc };

/** Per-shop-id config — see this file's own doc for why (unlike QueueTypes' DEFAULT_QUEUE_CONFIG) there's no fallback for an id not listed here. */
export const SHOP_CONFIG_BY_ID: Partial<Record<string, ShopConfig>> = {
    shop1: {
        name: 'Axe Shop',
        tool: 'axe',
        action: ActionType.Chop,
        mesh: DEFAULT_SHOP_MESH,
        levels: [
            { cost: 50, cooldownSec: 300, hitIntervalSec: 0.85 },
            { cost: 120, cooldownSec: 300, damagePerHit: 2 },
            { cost: 250, cooldownSec: 300, hitIntervalSec: 0.65 },
            { cost: 450, cooldownSec: 300, damagePerHit: 3 },
            { cost: 800, cooldownSec: 300, hitIntervalSec: 0.45 },
        ],
    },
};

export function getShopConfig(id: string): ShopConfig | undefined {
    return SHOP_CONFIG_BY_ID[id];
}

/** Mutates ACTION_CONFIG[config.action] in place with whichever fields `level` sets — see this file's own doc. Called both live (the instant a purchase completes — see ShopUpgradeStorage.tryCompleteUpgrade()) and at boot to replay every already-purchased level back onto the fresh, unmutated ACTION_CONFIG default (see reapplyAllShopUpgrades()). */
export function applyShopLevel(config: ShopConfig, level: ShopUpgradeLevel): void {
    const actionConfig = ACTION_CONFIG[config.action];
    if (level.hitIntervalSec !== undefined) {
        actionConfig.hitIntervalSec = level.hitIntervalSec;
    }
    if (level.damagePerHit !== undefined) {
        actionConfig.damagePerHit = level.damagePerHit;
    }
}

/** Puts every ActionConfig back to its hand-authored default — see BASE_ACTION_CONFIG's own doc. Called by ShopUpgradeStorage.clearAll() so a debug "reset upgrades" wipes the LIVE gameplay numbers along with the persisted level, not just the persisted level (which alone would leave e.g. Chop reading as level 0 while still hitting at whatever speed the wiped levels had granted). */
export function resetAllActionConfigs(): void {
    for (const action of Object.values(ActionType)) {
        Object.assign(ACTION_CONFIG[action], BASE_ACTION_CONFIG[action]);
    }
}
