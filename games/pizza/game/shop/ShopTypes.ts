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
// Each shop sells a straight-line upgrade LADDER for one ToolRegistry tool —
// but unlike the old sparse per-level override array, a ladder is now just a
// [min, max] range PER ATTRIBUTE (see ToolAttributeRanges, defined on the TOOL
// itself in ToolRegistry.ts — TOOL_LIBRARY[tool].attributes, not on the shop:
// the shop is only the storefront, cost/cooldown/appearance for whichever
// tool it names) plus the tool's maxLevel/startLevel: a tool at ladder level N of
// maxLevel (startLevel + levels bought) has EVERY attribute at min + (max - min) * (N / maxLevel),
// all at once, from scratch (see applyShopLevel()). A tool that's never been
// upgraded (N=0) sits at every attribute's own min — which is also, by
// construction, this game's hand-authored ACTION_CONFIG default (see
// ActionTypes.ts) — and a maxed one (N=totalLevels) sits at every max. Buying
// cost climbs geometrically instead of being hand-typed per level: level N
// costs baseCost * costScale^N (see getUpgradeCost()), so raising costScale
// is "each upgrade gets proportionally more expensive than the last,"
// independent of how many levels the ladder has.
//
// OR a shop lists its levels by hand (`levels`, one ShopLevelCost each — money
// plus any resources from the player's backpack, like a building's
// requirements). Then that list IS the price list, and the shop sells at most
// that many levels (see getShopMaxLevel()) — the carrier shop works this way.
//
// A shop's tool either drives an ACTION (axe -> chop, `action` set: buying a
// level rewrites ACTION_CONFIG, see applyShopLevel()) or has a stat read on
// demand instead (`action` unset — e.g. the carrier's capacity, see
// data/CarrierCapacity.ts, which reads the shop's level directly).

import { ACTION_CONFIG, ActionType, BASE_ACTION_CONFIG } from '../actions/ActionTypes';
import { AttributeRange, getToolStartLevel, TOOL_LIBRARY, ToolId, ToolVisualEntry } from '../actions/ToolRegistry';
import { MilestoneRequirement } from '../data/MilestoneRequirement';
import { FloorLabelConfig, PopupFrameChoice, PopupMode } from '../ui/PopupConfig';
import { FrameName } from '../ui/FrameRegistry';
import { ItemType } from "../crafting/ItemTypes";
import { ResourceType } from '../actions/ResourceTypes';

/** Texture alias (packed 'ui' image bundle, shared Kenney-style UI kit) shown wherever a shop wants to flag "there's an upgrade ready to buy" — see ShopZone's badge sprite. One shared constant (not per-ShopConfig) since every shop uses the same indicator art; a future shop wanting a different one can still override it locally without this needing to change. */
export const SHOP_UPGRADE_AVAILABLE_ICON = 'Slider_Level02_Icon_Up_Green';

/** The shop's own placeholder mesh — same shape as BuildingTypes.ts's BuildingMeshConfig, just one fixed mesh (no per-level growth) since a shop's ladder is about the TOOL, not the shop building itself. */
export interface ShopMeshConfig {
    size: [number, number, number];
    color: number;
}

/** What ONE hand-listed upgrade level costs — see ShopConfig.levels. */
export interface ShopLevelCost {
    /** CurrencyType.Money, drained coin by coin from the wallet. Unset/0 = no money. */
    money?: number;
    /** Resources drained from the player's backpack (BackpackStorage), same as a building's level requirements. */
    resources?: Partial<Record<ResourceType, number>>;
}

/** A level's full cost, resolved — see getUpgradeCost(). Only entries > 0 appear in `resources`. */
export interface ShopCost {
    money: number;
    resources: Partial<Record<ResourceType, number>>;
}

export interface ShopConfig extends FloorLabelConfig {
    name: string;
    tool: ToolId;
    /** The action whose ACTION_CONFIG buying a level rewrites (see applyShopLevel()). Unset for a tool with no action — its stat is read on demand instead (e.g. the carrier's capacity). */
    action?: ActionType;
    /**
     * Hand-listed price per level, in purchase order (entry 0 = the FIRST upgrade). When set it
     * replaces baseCost/costScale entirely, and the shop sells at most `levels.length` upgrades
     * (also capped by the tool's own maxLevel - startLevel — see getShopMaxLevel()). Unset = the
     * baseCost * costScale^N money formula, unchanged.
     */
    levels?: ShopLevelCost[];
    mesh: ShopMeshConfig;
    /** Optional real-mesh override for the shop's OWN structure, keyed into EntityViewRegistry.ts's ENTITY_VIEW_CONFIG — see BuildingLevelConfig.view's own doc for the full convention. undefined keeps the placeholder box (`mesh`). The shop building itself doesn't visually grow per level (unlike the old per-level `view` override) — see getViewIdForShopLevel()'s own doc. */
    baseView?: string;
    /** Fallback ladder length, used only when the tool itself has no maxLevel — the tool's own maxLevel/startLevel decide the ladder and how many levels this shop can sell (see getShopMaxLevel()/applyShopLevel()). */
    totalLevels: number;
    /** CurrencyType.Money cost of buying the FIRST level (level 0 -> 1) — see getUpgradeCost(). */
    baseCost: number;
    /** Multiplier applied to cost per level already bought — level N (0-indexed, i.e. buying the (N+1)th level) costs baseCost * costScale^N, so e.g. costScale 2 doubles the price of every subsequent purchase. See getUpgradeCost(). */
    costScale: number;
    /** Seconds after buying ANY level before the next one can be started — see ShopUpgradeStorage.isOnCooldown(). One flat value for the whole ladder now, not per-level. */
    cooldownSec: number;
    /** Optional — when set, this shop's ShopZone isn't spawned at all (see PizzaScene.setupShops(), which registers it as a RequirementRegistry spawn gate) until MilestoneRequirement.ts's isMilestoneRequirementMet() says this is satisfied. Same shared requirement shape GateConfig.requirement/QueueConfig.appearRequirement use. undefined means "always appears" (unchanged from before this field existed). */
    appearRequirement?: MilestoneRequirement;
    /** Requirements-panel style — see PopupConfig.ts's own doc. undefined behaves as 'complete' (this shop's existing tool-icon + cost panel), unchanged from before this field existed. */
    popupMode?: PopupMode;
    /** How high above this shop's own base the requirements panel floats — see PopupConfig.ts's own doc. undefined/0 sits it right at the shop's base instead of floating. */
    popupBobOffset?: number;
    /** Overrides FrameRegistry.ts's 'ShopFrame' default for THIS shop's own popup — see PopupConfig.ts's resolvePopupFrameName()'s own doc. undefined uses the type-wide default. */
    /** Also accepts 'Floor' (PopupConfig.ts's FLOOR_FRAME): painted on the ground instead of a floating popup, placed by the floorLabel* fields (FloorLabelConfig). */
    frame?: PopupFrameChoice;
    /**
     * Floats the upgraded tool's own model above the shop, bobbing like a craft table's showcased
     * tool (see CraftTableConfig.showModel/float and FloatAnimation.ts). The model is the tool's
     * own first `models` entry — for the carrier (which is never held, so has none) it's the crate
     * the player actually wears, PlayerConfig.carrier.models, so changing that updates the shop
     * too. See ShopZone.createShowcase(). With no `baseView` model, the placeholder box is left
     * out — the floating item is the shop's whole look. undefined/false = no floating item.
     */
    showcase?: boolean;
    /** Uniform scale on the showcased model's native size. Unset = 1. */
    showcaseScale?: number;
    /** World units above the shop's base the showcased model rests (and bobs around). Unset = DEFAULT_SHOWCASE_HEIGHT. */
    showcaseHeight?: number;
    /** Ambient particle effect (ParticleRegistry id, e.g. "craftingMyst") drifting up around the showcased model — same idea as CraftTableConfig.particleEffectId. Unset = no particles. */
    particleEffectId?: string;
    /** 0-1 fraction of this shop's own trigger footprint that becomes a SOLID collider blocking the player — see SolidArea.ts's own doc for the shared 0/1/0.5 semantics every provider/building/shop/craft-table/queue's `solid` field uses. undefined/0 (the default for every shop until a designer opts one in) means no solid collider at all — unchanged walk-through behavior from before this field existed. */
    solid?: number;
    /**
     * When true, this shop is treated as if it doesn't exist at all — PizzaScene.
     * registerShopSpawnGates() skips it entirely, never spawning its ShopZone. No
     * MilestoneRequirement variant references a shop id directly (only 'item'/'resource'
     * reference what a shop upgrades/sells), so there's nothing else to bypass — skipping the
     * spawn is the entire effect. Set/cleared from the web editor's toggle next to Duplicate/
     * Delete. undefined/false (the default, and every shop before this field existed) keeps
     * normal behavior.
     */
    disabled?: boolean;
}

const DEFAULT_SHOP_MESH: ShopMeshConfig = { size: [2, 2, 2], color: 0x8855cc };

/** ShopConfig.showcaseHeight's fallback — clear of a 2-unit shop model underneath (with no model there, lower it per shop). */
export const DEFAULT_SHOWCASE_HEIGHT = 2.6;

/**
 * Per-shop-id config — see this file's own doc for why (unlike QueueTypes' DEFAULT_QUEUE_CONFIG)
 * there's no fallback for an id not listed here.
 *
 * shop1's cost curve mirrors the old hand-typed 10-level axe ladder's own final price almost
 * exactly — baseCost 10 / costScale 2.05 lands level 10's cost at ~6394, vs. that ladder's final
 * 6400 (10 * 2.05^9). The ladder's actual min/max attribute ranges now live on the tool itself
 * (see TOOL_LIBRARY.axe.attributes in ToolRegistry.ts), not here.
 */
export const SHOP_CONFIG_BY_ID: Partial<Record<string, ShopConfig>> = {
    shop1: {
        name: "Axe Shop",
        tool: "axe",
        action: ActionType.Chop,
        mesh: DEFAULT_SHOP_MESH,
        totalLevels: 10,
        baseCost: 10,
        costScale: 2.05,
        cooldownSec: 300,
        popupBobOffset: 3,
        baseView: "shop1View",
        solid: 0.5,
        "frame": "QueueFrame",
        "appearRequirement": {
            "type": "item",
            "item": ItemType.Axe
        }
    },
    "shop2": {
        mesh: DEFAULT_SHOP_MESH,
        "name": "Pickaxe Shop",
        "tool": "pickaxe",
        "action": ActionType.Mine,
        "totalLevels": 10,
        "baseCost": 10,
        "costScale": 2.05,
        "cooldownSec": 300,
        "popupBobOffset": 3,
        "baseView": "shop2View",
        "solid": 0.5,
        "frame": "QueueFrame",
        "appearRequirement": {
            "type": "item",
            "item": ItemType.Pickaxe
        }
    },
    // Carrier upgrades — more room in the crate on the player's back (see data/CarrierCapacity.ts).
    // Priced per level by hand (`levels`); baseCost/costScale are unused while `levels` is set.
    "shopBackpack": {
        mesh: DEFAULT_SHOP_MESH,
        "name": "Carrier Shop",
        "appearRequirement": {
            "type": "store",
            "storeId": "farmStore1",
            "level": 2
        },
        "tool": "carrier",
        "totalLevels": 10,
        "baseCost": 0,
        "costScale": 1,
        "cooldownSec": 300,
        "popupBobOffset": 3,
        "solid": 0.5,
        "frame": "QueueFrame",
        "showcase": true,
        "showcaseScale": 0.6,
        "showcaseHeight": 1.2,
        "particleEffectId": "craftingMyst",
        "levels": [
            {
                "money": 100,
                "resources": {
                    "wood": 50
                }
            },
            {
                "money": 150,
                "resources": {
                    "wood": 50,
                    "stone": 20
                }
            }
        ]
    }
};

export function getShopConfig(id: string): ShopConfig | undefined {
    return SHOP_CONFIG_BY_ID[id];
}

/**
 * The shop's own EntityViewRegistry id — always `config.baseView` (undefined falls back to the
 * placeholder box `mesh`). Takes `boughtLevels` for call-site stability (ShopZone re-derives
 * this every time a purchase changes `boughtLevels`) even though the ladder itself no longer
 * has a per-level visual tier to pick between — a shop's OWN building never visually grows the
 * way the old per-level `view` override could have; only the tool's ACTION_CONFIG numbers do
 * (see applyShopLevel()).
 */
export function getViewIdForShopLevel(config: ShopConfig, boughtLevels: number): string | undefined {
    void boughtLevels;
    return config.baseView;
}

function lerp(range: AttributeRange, progress: number): number {
    return range.min + (range.max - range.min) * progress;
}

/**
 * The full length of the ladder `config`'s tool climbs — the tool's own maxLevel (see
 * ToolVisualEntry.maxLevel), falling back to the shop's `totalLevels` only for a tool with no
 * maxLevel set. This is what attributes scale against, including the tool's startLevel.
 */
function getLadderLevels(config: ShopConfig): number {
    const toolMax = (TOOL_LIBRARY[config.tool] as ToolVisualEntry).maxLevel;
    return toolMax > 0 ? toolMax : config.totalLevels;
}

/**
 * How many levels this shop can actually SELL — the ladder minus the tool's startLevel (see
 * ToolVisualEntry.startLevel): a max-10 tool that starts at 5 only has 5 upgrades left. This is
 * what ShopUpgradeStorage.isMaxLevel() checks the bought count against.
 */
export function getShopMaxLevel(config: ShopConfig): number {
    const ladder = Math.max(0, getLadderLevels(config) - getToolStartLevel(config.tool));
    // A hand-listed price list can't sell a level it has no price for.
    return config.levels ? Math.min(ladder, config.levels.length) : ladder;
}

/**
 * Sets ACTION_CONFIG[action] to `tool`'s attributes at `toolLevel` of `ladderLevels`, computed
 * from scratch every call. `progress` is `toolLevel / ladderLevels` clamped to [0, 1]. Every
 * attribute lerps min -> max on that same progress EXCEPT speed, which is attacks/sec and gets
 * inverted into ACTION_CONFIG.hitIntervalSec's seconds/attack (see ToolAttributeRanges.speed's
 * own doc). Returns false (and changes nothing) if the tool has no attributes range.
 */
function applyToolLevel(action: ActionType, tool: ToolId, toolLevel: number, ladderLevels: number): boolean {
    // Cast needed because TOOL_LIBRARY's own `satisfies Record<...>` declaration keeps each
    // entry's literal type (no `attributes` key at all on tools that never define one) rather
    // than widening to ToolVisualEntry — indexing with a generic ToolId then produces a union
    // TS won't uniformly read `.attributes` off of.
    const attrs = (TOOL_LIBRARY[tool] as ToolVisualEntry).attributes;
    if (!attrs || ladderLevels <= 0) {
        return false;
    }
    const progress = Math.min(1, Math.max(0, toolLevel / ladderLevels));
    const actionConfig = ACTION_CONFIG[action];

    actionConfig.hitScale = lerp(attrs.damage, progress);
    actionConfig.hitAngleDeg = lerp(attrs.hitAngleDeg, progress);
    actionConfig.hitRangeMeters = lerp(attrs.hitRangeMeters, progress);
    actionConfig.resourcePerHit = lerp(attrs.resourcePerHit, progress);
    actionConfig.hitIntervalSec = 1 / lerp(attrs.speed, progress);
    return true;
}

/**
 * Sets ACTION_CONFIG[config.action] to exactly what `boughtLevels` levels bought (0 = nothing
 * yet) SHOULD produce — the tool sits at startLevel + boughtLevels on its ladder (see
 * ToolVisualEntry.startLevel), so a max-10 tool starting at 5 reads as ladder level 5 with
 * nothing bought and 10 once this shop's 5 upgrades are done. Computed from scratch every call,
 * so ShopUpgradeStorage.reapplyAllShopUpgrades() is a single call per shop.
 */
export function applyShopLevel(config: ShopConfig, boughtLevels: number): void {
    // No action (e.g. the carrier): nothing to rewrite — its stat is read on demand from the level.
    if (config.action === undefined) {
        return;
    }
    // Every tool a shop references MUST define its own ladder range — see
    // ToolVisualEntry.attributes' own doc in ToolRegistry.ts.
    const toolLevel = getToolStartLevel(config.tool) + boughtLevels;
    if (!applyToolLevel(config.action, config.tool, toolLevel, getLadderLevels(config))) {
        console.warn(`[ShopTypes] tool "${config.tool}" has no attributes range defined on TOOL_LIBRARY — skipping upgrade apply.`);
    }
}

/**
 * Cost to buy the NEXT level (`boughtLevels` -> `boughtLevels + 1`): `levels[boughtLevels]` when
 * the shop lists its levels by hand, else money only, baseCost * costScale^boughtLevels (see
 * ShopConfig.costScale's own doc). Everything rounded to whole units.
 */
export function getUpgradeCost(config: ShopConfig, boughtLevels: number): ShopCost {
    if (config.levels) {
        const entry = config.levels[boughtLevels];
        const resources: Partial<Record<ResourceType, number>> = {};
        for (const [type, amount] of Object.entries(entry?.resources ?? {}) as [ResourceType, number][]) {
            if (amount > 0) {
                resources[type] = Math.round(amount);
            }
        }
        return { money: Math.max(0, Math.round(entry?.money ?? 0)), resources };
    }
    // Rounded — a non-integer costScale (or even a fractional baseCost) otherwise compounds
    // into a fractional price (e.g. 42.025) that reads as broken next to a currency the rest of
    // the game only ever shows/spends in whole units (see EconomyStorage.spend()'s own doc).
    return { money: Math.round(config.baseCost * Math.pow(config.costScale, boughtLevels)), resources: {} };
}

/** Puts every ActionConfig back to its hand-authored default — see BASE_ACTION_CONFIG's own doc. Called by ShopUpgradeStorage.clearAll() so a debug "reset upgrades" wipes the LIVE gameplay numbers along with the persisted level, not just the persisted level (which alone would leave e.g. Chop reading as level 0 while still hitting at whatever speed the wiped levels had granted). */
export function resetAllActionConfigs(): void {
    for (const action of Object.values(ActionType)) {
        Object.assign(ACTION_CONFIG[action], BASE_ACTION_CONFIG[action]);
        // A tool acquired at a startLevel above 0 starts at that point of its ladder even with
        // no shop selling it (or before any shop's own level is applied on top) — see
        // ToolVisualEntry.startLevel. A startLevel-0 tool keeps the hand-authored default.
        const tool = ACTION_CONFIG[action].tool;
        if (tool !== undefined && getToolStartLevel(tool) > 0) {
            applyToolLevel(action, tool, getToolStartLevel(tool), (TOOL_LIBRARY[tool] as ToolVisualEntry).maxLevel);
        }
    }
}
