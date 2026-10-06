// ZoneTutorialTypes.ts
//
// Per-zone, ordered tutorial: an array of steps the player is walked through one at a time
// while standing in that zone, each step pointing a screen-space arrow (see
// ZoneTutorialArrow.ts) at whatever they still need to go do next — gather a resource, then
// deliver it to the craft table/gate that's actually waiting on it (see
// ZoneTutorialController.ts's own doc for the full gather/deliver state machine). Keyed by
// zoneNumber, same 0-based convention ZoneTypes.ts's own ZONE_CONFIG uses ("zone1" in
// level-designer terms is zoneNumber 0 — see that file's own doc).
//
// No generic "requirement" plumbing of its own — a 'craft'/'gate' step resolves its OWN
// (resourceType, amount) from whatever real system it's already pointing at (a craft table's
// recipe cost, a gate's resource requirement), rather than duplicating that data here. See
// ZoneTutorialController.resolveStepRequirement() for how each kind resolves, including the
// "primary recipe"/"resource-only gate" simplifications documented there. A 'trigger' step is
// simpler still — no resource to gather at all, just "walk here" — see
// ZoneTutorialController's own doc for why it skips the gather/deliver phase machinery
// entirely.
//
// use3dArrow lives at the CONFIG level (one per zone), not per-step — nothing today needs a
// mid-tutorial arrow-STYLE (2D vs 3D) switch. arrowTextureId ALSO lives at the config level as
// the tutorial's overall fallback icon, but each step can override it via its own
// `iconTextureId` — a multi-step tutorial commonly wants a different icon per step (e.g. an axe
// icon while gathering wood, then a hammer icon while crafting), so the override is per-step
// while the config-level value stays as the "good enough for every step that doesn't care" base.
//
// `offset` is a per-step 3D world-space nudge applied ON TOP of whatever position the step's
// own target already resolves to (a gather ResourceNode, or a deliver craft table/gate/trigger's
// placed location — see ZoneTutorialController.resolveStepOffset()) — same `[x, y, z]` tuple
// shape (and editor 'vector3' field) EntityViewRegistry.ts's own `offset` already uses, not a
// plain `{x,y,z}` object. Optional; an unset step behaves exactly as if it were `[0, 0, 0]`.

import { GateId } from '../data/GateTypes';
import { BuildingId } from '../data/BuildingId';
import type { MilestoneRequirement } from '../data/MilestoneRequirement';

export interface ZoneTutorialCraftStep {
    kind: 'craft';
    /** A CraftTypes.ts CRAFT_CONFIG_BY_ID key — see ZoneTutorialController's own doc for how its required (resourceType, amount) and completion are resolved. */
    craftId: string;
    /** See this file's own top-of-file doc on why this lives per-step. Optional — ZoneTutorialController falls back to the config's own arrowTextureId (then DEFAULT_ARROW_TEXTURE_ID) when unset. */
    iconTextureId?: string;
    /** See this file's own top-of-file doc on `offset`. Optional — unset behaves as `[0, 0, 0]`. */
    offset?: [number, number, number];
}

export interface ZoneTutorialGateStep {
    kind: 'gate';
    /** A GateTypes.ts GateId — ONLY a gate whose own `requirement` is a 'resource' kind is actually usable here (see ZoneTutorialController's own doc); any other requirement kind is skipped gracefully with a console.warn. */
    gateId: GateId;
    /** See ZoneTutorialCraftStep.iconTextureId's own doc — same per-step override, same fallback chain. */
    iconTextureId?: string;
    /** See this file's own top-of-file doc on `offset`. Optional — unset behaves as `[0, 0, 0]`. */
    offset?: [number, number, number];
}

export interface ZoneTutorialTriggerStep {
    kind: 'trigger';
    /** A TriggerTypes.ts TRIGGER_CONFIG_BY_ID key AND the matching Tiled "trigger" object's own id (see WorldObjectRegistry.ts) — the arrow points at that placed volume's location until TriggerStorage marks it activated. No resource/amount to resolve at all, unlike the other two kinds. */
    triggerId: string;
    /** See ZoneTutorialCraftStep.iconTextureId's own doc — same per-step override, same fallback chain. */
    iconTextureId?: string;
    /** See this file's own top-of-file doc on `offset`. Optional — unset behaves as `[0, 0, 0]`. */
    offset?: [number, number, number];
}

/** "Fill a store shelf": gather the storage's own resourceType (StorageConfig.resourceType) from a farm, then deposit it there. Completes once the storage holds `amount` of it. */
export interface ZoneTutorialStorageStep {
    kind: 'storage';
    /** A "storage" id on the map — must have a resourceType (see StorageTypes.ts). */
    storageId: string;
    /** Units to deposit. Unset = 1. */
    amount?: number;
    /** The farm the gather arrow points at. Unset = the nearest farm whose assignedCropId yields the storage's resource, else the nearest ResourceNode producing it. */
    farmId?: string;
    /** See ZoneTutorialCraftStep.iconTextureId's own doc — same per-step override, same fallback chain. */
    iconTextureId?: string;
    /** See this file's own top-of-file doc on `offset`. Optional — unset behaves as `[0, 0, 0]`. */
    offset?: [number, number, number];
}

/** "Build a storage that costs resources": gather whatever of the storage's resourceCost (StorageTypes.ts) the player still lacks from the nearest source (e.g. chop trees for wood), then pay at its purchase spot. Completes once it's bought. */
export interface ZoneTutorialBuyStorageStep {
    kind: 'buyStorage';
    /** A "storage" id on the map with a resourceCost/price. */
    storageId: string;
    /** Only point the gather arrow at sources standing in this zone (e.g. the zone full of trees this lesson unlocks). Unset = the nearest anywhere (also the fallback when that zone has none left). */
    gatherZone?: number;
    /** See ZoneTutorialCraftStep.iconTextureId's own doc — same per-step override, same fallback chain. */
    iconTextureId?: string;
    /** See this file's own top-of-file doc on `offset`. Optional — unset behaves as `[0, 0, 0]`. */
    offset?: [number, number, number];
}

/** "Serve at the cashier": the arrow points at the store's cashier until the store has made `amount` sales in total (StoreProgressStorage.getTotalSales()). */
export interface ZoneTutorialSaleStep {
    kind: 'sale';
    /** A "store" id on the map (see StoreLayout.ts). */
    storeId: string;
    /** Total sales needed. Unset = 1. */
    amount?: number;
    /** See ZoneTutorialCraftStep.iconTextureId's own doc — same per-step override, same fallback chain. */
    iconTextureId?: string;
    /** See this file's own top-of-file doc on `offset`. Optional — unset behaves as `[0, 0, 0]`. */
    offset?: [number, number, number];
}

/** "Grab your money": the arrow points at the store's money drop until its pile is collected (StoreMoneyStorage.onTaken). */
export interface ZoneTutorialCollectMoneyStep {
    kind: 'collectMoney';
    /** A "store" id on the map (see StoreLayout.ts). */
    storeId: string;
    /** See ZoneTutorialCraftStep.iconTextureId's own doc — same per-step override, same fallback chain. */
    iconTextureId?: string;
    /** See this file's own top-of-file doc on `offset`. Optional — unset behaves as `[0, 0, 0]`. */
    offset?: [number, number, number];
}

/** "Build it": the arrow points at the building's dropper until it reaches level 1. */
export interface ZoneTutorialBuildStep {
    kind: 'build';
    buildingId: BuildingId;
    /** See ZoneTutorialCraftStep.iconTextureId's own doc — same per-step override, same fallback chain. */
    iconTextureId?: string;
    /** See this file's own top-of-file doc on `offset`. Optional — unset behaves as `[0, 0, 0]`. */
    offset?: [number, number, number];
}

export type ZoneTutorialStep = ZoneTutorialCraftStep | ZoneTutorialGateStep | ZoneTutorialTriggerStep | ZoneTutorialStorageStep | ZoneTutorialSaleStep | ZoneTutorialCollectMoneyStep | ZoneTutorialBuildStep | ZoneTutorialBuyStorageStep;

export interface ZoneTutorialConfig {
    /** Walked through in order, one at a time — see TutorialProgressStorage.ts for how far along a given zone's player already is. */
    steps: ZoneTutorialStep[];
    /**
     * A bare packed UI-icon texture name (same "no path/bundle/extension, just the name"
     * convention Gate.ts's own lock/badge icons use — resolved via PIXI.Texture.from(), not
     * getAssetIcon(), since this isn't an AssetLibraryKey), shown as the guiding arrow's
     * sprite. Optional (same reasoning as ZONE_CONFIG.requirement's own optionality — the
     * Zone Tutorial tab auto-discovers a bare `{steps: []}` entry for every zoneNumber painted
     * on the map, whether or not a designer has configured a real tutorial for it yet) —
     * ZoneTutorialController falls back to DEFAULT_ARROW_TEXTURE_ID when unset.
     */
    arrowTextureId?: string;
    /**
     * When true, this zone's tutorial ADDITIONALLY points a real 3D world-space arrow orbiting
     * the player (ZoneTutorial3dArrow.ts) — on top of, not instead of, the default flat
     * screen-space overlay (ZoneTutorialArrow.ts, always on regardless of this flag) — see
     * ZoneTutorialController's own doc on updateArrow()/hideArrow(), the one pair of call sites
     * that drives both together. Optional; defaults to false (screen-space only).
     */
    use3dArrow?: boolean;
    /**
     * When set, this tutorial starts on its own the moment this is met, wherever the player is,
     * instead of when the player walks into this zone — e.g. zone 3's "chop trees, build the
     * tomato shelf" lesson starts as farmStore1 reaches Lv 2 (the same moment zone 3 opens).
     * Unset = starts when the player enters this zone.
     */
    startRequirement?: MilestoneRequirement;
}

/** ZoneTutorialConfig.arrowTextureId's fallback when a zone's auto-discovered entry hasn't set one yet — see that field's own doc. */
export const DEFAULT_ARROW_TEXTURE_ID = 'pointer';

/**
 * zoneNumber -> its own tutorial config — sparse, same "only a level designer's actually
 * configured entries show up" convention ZoneTypes.ts's ZONE_CONFIG uses. Zone 0's entry is the
 * FTUE (a started tutorial follows the player into every zone until it's done — see
 * ZoneTutorialController's own doc): walk out (the
 * trigger reveals zone 1 and opens farmStore1 early — see StoreConfig.openRequirement), carry
 * a carrot from farm1 to storage1, serve the first client at the cashier (that sale reveals
 * zone 2 — see ZoneTypes.ts), collect the money drop, then build stall1 with it.
 */
export const ZONE_TUTORIAL_CONFIG: Partial<Record<number, ZoneTutorialConfig>> = {
    "0": {
        steps: [
            {
                "kind": "trigger",
                "triggerId": "walkTutorialTrigger",
                "offset": [
                    0,
                    -2,
                    0
                ]
            },
            {
                "kind": "storage",
                "storageId": "storage1",
                "amount": 1,
                "farmId": "farm1",
                "offset": [
                    0,
                    0,
                    0
                ]
            },
            {
                "kind": "sale",
                "storeId": "farmStore1",
                "amount": 1,
                "offset": [
                    0,
                    0,
                    0
                ]
            },
            {
                "kind": "collectMoney",
                "storeId": "farmStore1",
                "offset": [
                    0,
                    0,
                    0
                ]
            },
            {
                "kind": "build",
                "buildingId": BuildingId.Stall1,
                "offset": [
                    0,
                    0,
                    0
                ]
            }
        ],
        // Placeholder — 'pointer' is a real frame in ui.webp's atlas (confirmed against
        // public/pizza/images/ui.webp.json), unlike the previous 'Icon_Up_Green' guess, which
        // wasn't an actual frame name (only 'Slider_Level02_Icon_Up_Green', ShopTypes.ts's own
        // slider sub-icon, contains that substring) — PIXI.Texture.from() silently falls back
        // to treating an unknown key as an image URL, so that guess 404'd instead of erroring
        // loudly. Swap for a real compass-arrow asset once one exists.
        arrowTextureId: "tutorialHand2",
        use3dArrow: true,
    },
    "1": {
        "steps": [],
        "arrowTextureId": "woodcutters-axe",
        "use3dArrow": true
    },
    "2": {
        "steps": [],
        "use3dArrow": false
    },
    "4": {
        "steps": []
    },
    "3": {
        "steps": [
            {
                "kind": "buyStorage",
                "storageId": "storage2",
                "gatherZone": 3,
                "iconTextureId": "woodcutters-axe",
                "offset": [
                    0,
                    0,
                    0
                ]
            }
        ],
        "use3dArrow": true,
        "arrowTextureId": "woodcutters-axe",
        "startRequirement": {
            "type": "store",
            "storeId": "farmStore1",
            "level": 2
        }
    },
    "10": {
        "steps": []
    }
};

export function getZoneTutorialConfig(zoneNumber: number): ZoneTutorialConfig | undefined {
    return ZONE_TUTORIAL_CONFIG[zoneNumber];
}
