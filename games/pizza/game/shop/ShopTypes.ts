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
// [min, max] range PER ATTRIBUTE (see ToolAttributeRanges) plus a level count
// (totalLevels): buying level N of totalLevels sets EVERY attribute to
// min + (max - min) * (N / totalLevels), all at once, from scratch (see
// applyShopLevel()). A tool that's never been upgraded (N=0) sits at every
// attribute's own min — which is also, by construction, this game's
// hand-authored ACTION_CONFIG default (see ActionTypes.ts) — and a maxed one
// (N=totalLevels) sits at every max. Buying cost climbs geometrically instead
// of being hand-typed per level: level N costs baseCost * costScale^N (see
// getUpgradeCost()), so raising costScale is "each upgrade gets proportionally
// more expensive than the last," independent of how many levels the ladder has.

import { ACTION_CONFIG, ActionType, BASE_ACTION_CONFIG } from '../actions/ActionTypes';
import { ToolId } from '../actions/ToolRegistry';
import { MilestoneRequirement } from '../data/MilestoneRequirement';
import { PopupMode } from '../ui/PopupConfig';
import { FrameName } from '../ui/FrameRegistry';

/** Texture alias (packed 'ui' image bundle, shared Kenney-style UI kit) shown wherever a shop wants to flag "there's an upgrade ready to buy" — see ShopZone's badge sprite. One shared constant (not per-ShopConfig) since every shop uses the same indicator art; a future shop wanting a different one can still override it locally without this needing to change. */
export const SHOP_UPGRADE_AVAILABLE_ICON = 'Slider_Level02_Icon_Up_Green';

/** A single attribute's span across the whole ladder — see ToolAttributeRanges' own doc. */
export interface AttributeRange {
    /** What this attribute reads as at level 0 (nothing bought yet) — should match this action's hand-authored ACTION_CONFIG default (see ActionTypes.ts/BASE_ACTION_CONFIG), so a fresh tool and a never-upgraded one are indistinguishable. */
    min: number;
    /** What this attribute reads as once the ladder is fully maxed (totalLevels bought). */
    max: number;
}

/**
 * The 5 upgradeable knobs a tool's shop ladder scales between (see ActionTypes.ts's
 * ActionConfig for what each actually drives in-game) — every one of these is written so
 * "bigger number = stronger," including `speed`: that's attacks PER SECOND, not
 * ACTION_CONFIG.hitIntervalSec's seconds-per-attack, so applyShopLevel() inverts it
 * (hitIntervalSec = 1 / speed) rather than lerping hitIntervalSec directly, which would
 * otherwise make "faster" read as a SMALLER max than min.
 */
export interface ToolAttributeRanges {
    /** hitScale — hits one swing counts as ("damage"), capped by a target's own remaining life. */
    damage: AttributeRange;
    /** hitAngleDeg — full aperture of the AoE hit cone every swing checks for extra targets. */
    hitAngleDeg: AttributeRange;
    /** hitRangeMeters — how far that same hit cone reaches. */
    hitRangeMeters: AttributeRange;
    /** Attacks per second — inverted into ACTION_CONFIG.hitIntervalSec (seconds per attack) by applyShopLevel(). */
    speed: AttributeRange;
    /** resourcePerHit — yield banked per hit, never capped by a target's remaining life (see ActionTypes.ts's own doc). */
    resourcePerHit: AttributeRange;
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
    /** Optional real-mesh override for the shop's OWN structure, keyed into EntityViewRegistry.ts's ENTITY_VIEW_CONFIG — see BuildingLevelConfig.view's own doc for the full convention. undefined keeps the placeholder box (`mesh`). The shop building itself doesn't visually grow per level (unlike the old per-level `view` override) — see getViewIdForShopLevel()'s own doc. */
    baseView?: string;
    /** Every attribute's [level-0, maxed] range — see ToolAttributeRanges' own doc. */
    attributes: ToolAttributeRanges;
    /** How many levels this ladder has — level 0 (nothing bought) sits at every attribute's min, level totalLevels (maxed) at every max, and anything in between is a straight-line blend (see applyShopLevel()). Also what ShopUpgradeStorage.isMaxLevel() checks `level` against. */
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
    frame?: FrameName;
    /** 0-1 fraction of this shop's own trigger footprint that becomes a SOLID collider blocking the player — see SolidArea.ts's own doc for the shared 0/1/0.5 semantics every provider/building/shop/craft-table/queue's `solid` field uses. undefined/0 (the default for every shop until a designer opts one in) means no solid collider at all — unchanged walk-through behavior from before this field existed. */
    solid?: number;
}

const DEFAULT_SHOP_MESH: ShopMeshConfig = { size: [2, 2, 2], color: 0x8855cc };

/**
 * Per-shop-id config — see this file's own doc for why (unlike QueueTypes' DEFAULT_QUEUE_CONFIG)
 * there's no fallback for an id not listed here.
 *
 * shop1's ranges mirror the old hand-typed 10-level axe ladder's own start/end points exactly
 * (level-0 = that ladder's un-upgraded ACTION_CONFIG.chop defaults, level-10/maxed = its final
 * level's numbers) — a fully-upgraded axe still ends up 4x hit count, 4x yield/hit, a 2.5
 * attacks/sec (0.4s/attack) swing, and a 120°/3m AoE cone, just reached by a smooth blend
 * instead of hand-typed waypoints. baseCost 10 / costScale 2.05 lands level 10's cost at
 * ~6394 — matching the old ladder's final 6400 almost exactly (10 * 2.05^9).
 */
export const SHOP_CONFIG_BY_ID: Partial<Record<string, ShopConfig>> = {
    shop1: {
        name: "Axe Shop",
        tool: "axe",
        action: ActionType.Chop,
        mesh: DEFAULT_SHOP_MESH,
        attributes: {
            "damage": {
                "min": 1,
                "max": 4
            },
            "hitAngleDeg": {
                "min": 30,
                "max": 360
            },
            "hitRangeMeters": {
                "min": 1.5,
                "max": 3
            },
            "speed": {
                "min": 1,
                "max": 2.5
            },
            "resourcePerHit": {
                "min": 1,
                "max": 4
            }
        },
        totalLevels: 10,
        baseCost: 10,
        costScale: 2.05,
        cooldownSec: 300,
        popupBobOffset: 2,
        baseView: "shop1View",
        solid: 0.5,
    },
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
 * Sets ACTION_CONFIG[config.action] to exactly what `boughtLevels` levels bought (0 = nothing
 * yet) SHOULD produce, computed from scratch every call — unlike the old sparse per-level
 * array, there's nothing to replay incrementally (see ShopUpgradeStorage.reapplyAllShopUpgrades(),
 * now a single call per shop instead of a loop over its history). `progress` is
 * `boughtLevels / config.totalLevels` clamped to [0, 1] — e.g. a 10-level ladder at level 5, or
 * a 20-level ladder at level 10, both land on progress 0.5 and therefore identical attribute
 * values, regardless of how many total levels either ladder has. Every attribute lerps
 * min -> max on that same progress EXCEPT speed, which is attacks/sec and gets inverted into
 * ACTION_CONFIG.hitIntervalSec's seconds/attack (see ToolAttributeRanges.speed's own doc).
 */
export function applyShopLevel(config: ShopConfig, boughtLevels: number): void {
    const progress = Math.min(1, Math.max(0, boughtLevels / config.totalLevels));
    const actionConfig = ACTION_CONFIG[config.action];
    const attrs = config.attributes;

    actionConfig.hitScale = lerp(attrs.damage, progress);
    actionConfig.hitAngleDeg = lerp(attrs.hitAngleDeg, progress);
    actionConfig.hitRangeMeters = lerp(attrs.hitRangeMeters, progress);
    actionConfig.resourcePerHit = lerp(attrs.resourcePerHit, progress);
    actionConfig.hitIntervalSec = 1 / lerp(attrs.speed, progress);
}

/** Cost to buy the NEXT level (`boughtLevels` -> `boughtLevels + 1`) — see ShopConfig.costScale's own doc. A flat costScale of 1 would cost baseCost every single time; anything above 1 makes each purchase costScale-fold pricier than the one before it. */
export function getUpgradeCost(config: ShopConfig, boughtLevels: number): number {
    return config.baseCost * Math.pow(config.costScale, boughtLevels);
}

/** Puts every ActionConfig back to its hand-authored default — see BASE_ACTION_CONFIG's own doc. Called by ShopUpgradeStorage.clearAll() so a debug "reset upgrades" wipes the LIVE gameplay numbers along with the persisted level, not just the persisted level (which alone would leave e.g. Chop reading as level 0 while still hitting at whatever speed the wiped levels had granted). */
export function resetAllActionConfigs(): void {
    for (const action of Object.values(ActionType)) {
        Object.assign(ACTION_CONFIG[action], BASE_ACTION_CONFIG[action]);
    }
}
