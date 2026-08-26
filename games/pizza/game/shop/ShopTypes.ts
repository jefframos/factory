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
// about that tool's ActionConfig (see ActionTypes.ts's own doc for the full
// three-knob breakdown) — hitIntervalSec swings faster, hitScale kills in
// fewer swings, resourcePerHit extracts more per hit (uncapped by a target's
// remaining life, unlike hitScale). A level only needs to set whichever
// field it's upgrading; applyShopLevel() below only touches the fields
// actually present, so e.g. a "faster" level doesn't reset hitScale/
// resourcePerHit back to their base values.

import { ACTION_CONFIG, ActionType, BASE_ACTION_CONFIG } from '../actions/ActionTypes';
import { ToolId } from '../actions/ToolRegistry';
import { MilestoneRequirement } from '../data/MilestoneRequirement';
import { PopupMode } from '../ui/PopupConfig';
import { FrameName } from '../ui/FrameRegistry';

/** Texture alias (packed 'ui' image bundle, shared Kenney-style UI kit) shown wherever a shop wants to flag "there's an upgrade ready to buy" — see ShopZone's badge sprite. One shared constant (not per-ShopConfig) since every shop uses the same indicator art; a future shop wanting a different one can still override it locally without this needing to change. */
export const SHOP_UPGRADE_AVAILABLE_ICON = 'Slider_Level02_Icon_Up_Green';

export interface ShopUpgradeLevel {
    /** CurrencyType.Money cost to buy this level — see ShopZone's continuous coin-deposit flow. */
    cost: number;
    /** Seconds after buying this level before the NEXT one can be started — see ShopUpgradeStorage.isOnCooldown(). */
    cooldownSec: number;
    /** Absolute override (not a delta) for ACTION_CONFIG[config.action].hitIntervalSec — omit to leave whatever the previous level left it at. */
    hitIntervalSec?: number;
    /** Absolute override (not a delta) for ACTION_CONFIG[config.action].hitScale — omit to leave whatever the previous level left it at. */
    hitScale?: number;
    /** Absolute override (not a delta) for ACTION_CONFIG[config.action].resourcePerHit — omit to leave whatever the previous level left it at. */
    resourcePerHit?: number;
    /** Optional real-mesh override for the shop's OWN structure once this level is bought, keyed into EntityViewRegistry.ts's ENTITY_VIEW_CONFIG — see BuildingLevelConfig.view's own doc for the full convention. undefined keeps whatever the previous level (or the base `mesh`) already showed, same "sparse override" shape as hitIntervalSec/hitScale/resourcePerHit above. */
    view?: string;
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
    /** Optional real-mesh override before any upgrade level is bought — see ShopUpgradeLevel.view's own doc. */
    baseView?: string;
    /** Buying upgrade N+1 (0-indexed here) applies levels[N] — see applyShopLevel(). A shop at levels.length is maxed out (see ShopUpgradeStorage.isMaxLevel()). */
    levels: ShopUpgradeLevel[];
    /** Optional — when set, this shop's ShopZone isn't spawned at all (see PizzaScene.setupShops(), which registers it as a RequirementRegistry spawn gate) until MilestoneRequirement.ts's isMilestoneRequirementMet() says this is satisfied. Same shared requirement shape GateConfig.requirement/QueueConfig.appearRequirement use. undefined means "always appears" (unchanged from before this field existed). */
    appearRequirement?: MilestoneRequirement;
    /** Requirements-panel style — see PopupConfig.ts's own doc. undefined behaves as 'complete' (this shop's existing tool-icon + cost panel), unchanged from before this field existed. */
    popupMode?: PopupMode;
    /** How high above this shop's own base the requirements panel floats — see PopupConfig.ts's own doc. undefined/0 sits it right at the shop's base instead of floating. */
    popupBobOffset?: number;
    /** Overrides FrameRegistry.ts's 'ShopFrame' default for THIS shop's own popup — see PopupConfig.ts's resolvePopupFrameName()'s own doc. undefined uses the type-wide default. */
    frame?: FrameName;
    /** 0-1 fraction of this shop's own trigger footprint that becomes a SOLID collider blocking the player — see SolidArea.ts's own doc for the shared 0/1/0.5 semantics every provider/building/shop/craft-table/queue's `solid` field uses. undefined/0 (the default for every shop until a designer opts one in) means no solid collider at all — unchanged walk-through behavior from before this field existed. */
    solid?: number;
}

const DEFAULT_SHOP_MESH: ShopMeshConfig = { size: [2, 2, 2], color: 0x8855cc };

/** Per-shop-id config — see this file's own doc for why (unlike QueueTypes' DEFAULT_QUEUE_CONFIG) there's no fallback for an id not listed here. */
export const SHOP_CONFIG_BY_ID: Partial<Record<string, ShopConfig>> = {
    shop1: {
        name: "Axe Shop",
        tool: "axe",
        action: ActionType.Chop,
        mesh: DEFAULT_SHOP_MESH,
        // 10 levels, rotating all three independent knobs (see ActionTypes.ts's own doc):
        // speed (hitIntervalSec), hit count (hitScale), and yield per hit (resourcePerHit).
        // By level 6 hitScale=3/resourcePerHit=3 — a tree (maxLife 5, amountPerGather 1, see
        // ResourceTypes.ts) takes two swings (3, then the last 2 capped by remaining life) for
        // 3*3 + 2*3 = 15 total wood, well past the 5 a hitScale-only reading would suggest,
        // since resourcePerHit is never capped by remaining life the way hitScale is.
        levels: [
            {
                "cost": 10,
                "cooldownSec": 300,
                "hitIntervalSec": 0.85
            },
            {
                "cost": 120,
                "cooldownSec": 300,
                "hitScale": 2
            },
            {
                "cost": 250,
                "cooldownSec": 300,
                "resourcePerHit": 2
            },
            {
                "cost": 450,
                "cooldownSec": 300,
                "hitIntervalSec": 0.7
            },
            {
                "cost": 800,
                "cooldownSec": 300,
                "hitScale": 3
            },
            {
                "cost": 1300,
                "cooldownSec": 300,
                "resourcePerHit": 3
            },
            {
                "cost": 2000,
                "cooldownSec": 300,
                "hitIntervalSec": 0.55
            },
            {
                "cost": 3000,
                "cooldownSec": 300,
                "hitScale": 4
            },
            {
                "cost": 4400,
                "cooldownSec": 300,
                "resourcePerHit": 4
            },
            {
                "cost": 6400,
                "cooldownSec": 300,
                "hitIntervalSec": 0.4
            }
        ],
        "popupBobOffset": 1,
        "baseView": "shop1View",
        "solid": 0.5
    },
};

export function getShopConfig(id: string): ShopConfig | undefined {
    return SHOP_CONFIG_BY_ID[id];
}

/** The shop's current EntityViewRegistry id for `boughtLevels` upgrades bought so far (0 = none bought yet) — the most recent bought level that actually set a `view` wins, same "sparse override, most recent wins" resolution as applyShopLevel()'s own fields. undefined means "keep the box placeholder." */
export function getViewIdForShopLevel(config: ShopConfig, boughtLevels: number): string | undefined {
    for (let i = Math.min(boughtLevels, config.levels.length) - 1; i >= 0; i--) {
        if (config.levels[i].view !== undefined) {
            return config.levels[i].view;
        }
    }
    return config.baseView;
}

/** Mutates ACTION_CONFIG[config.action] in place with whichever fields `level` sets — see this file's own doc. Called both live (the instant a purchase completes — see ShopUpgradeStorage.tryCompleteUpgrade()) and at boot to replay every already-purchased level back onto the fresh, unmutated ACTION_CONFIG default (see reapplyAllShopUpgrades()). */
export function applyShopLevel(config: ShopConfig, level: ShopUpgradeLevel): void {
    const actionConfig = ACTION_CONFIG[config.action];
    if (level.hitIntervalSec !== undefined) {
        actionConfig.hitIntervalSec = level.hitIntervalSec;
    }
    if (level.hitScale !== undefined) {
        actionConfig.hitScale = level.hitScale;
    }
    if (level.resourcePerHit !== undefined) {
        actionConfig.resourcePerHit = level.resourcePerHit;
    }
}

/** Puts every ActionConfig back to its hand-authored default — see BASE_ACTION_CONFIG's own doc. Called by ShopUpgradeStorage.clearAll() so a debug "reset upgrades" wipes the LIVE gameplay numbers along with the persisted level, not just the persisted level (which alone would leave e.g. Chop reading as level 0 while still hitting at whatever speed the wiped levels had granted). */
export function resetAllActionConfigs(): void {
    for (const action of Object.values(ActionType)) {
        Object.assign(ACTION_CONFIG[action], BASE_ACTION_CONFIG[action]);
    }
}
