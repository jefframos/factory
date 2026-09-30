// ToolRegistry.ts
//
// What a gathering tool LOOKS like, held in the player's right hand while
// an action plays — separate from ActionTypes.ts's gameplay numbers, same
// "visual config lives on its own, gameplay config doesn't touch it"
// split AssetLibraryRegistry.ts already uses for resource nodes. An empty
// `models` list means "no glb yet" — CharacterBody.buildToolVisual() falls
// back to a plain cylinder placeholder instead of erroring, exactly like
// ResourceNode does for resources with no art yet. Axe/pickaxe now point at
// real models (MODELS.Tools.Axe/Pickaxe, both .gltf — confirmed working via
// ModelLoaderManager's GLTFLoader branch, same as every .glb prop).

import * as PIXI from 'pixi.js';
import * as THREE from 'three';
import MODELS, { ModelDefinition } from '../../registry/assetsRegistry/modelsRegistry';

/** A single attribute's span across a shop's whole upgrade ladder — see ToolAttributeRanges' own doc. */
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
 * ACTION_CONFIG.hitIntervalSec's seconds-per-attack, so ShopTypes.applyShopLevel() inverts it
 * (hitIntervalSec = 1 / speed) rather than lerping hitIntervalSec directly, which would
 * otherwise make "faster" read as a SMALLER max than min.
 *
 * Lives on the TOOL (ToolVisualEntry.attributes below), not the shop that sells it — a shop is
 * just a storefront (cost/cooldown/which building) for upgrading whichever tool it names via
 * `tool: ToolId`; the ladder's actual min/max numbers belong to the tool being upgraded, so two
 * different shops could in principle sell upgrades for the same tool without disagreeing about
 * its range. See ShopTypes.ts's own doc.
 */
export interface ToolAttributeRanges {
    /** hitScale — hits one swing counts as ("damage"), capped by a target's own remaining life. */
    damage: AttributeRange;
    /** hitAngleDeg — full aperture of the AoE hit cone every swing checks for extra targets. */
    hitAngleDeg: AttributeRange;
    /** hitRangeMeters — how far that same hit cone reaches. */
    hitRangeMeters: AttributeRange;
    /** Attacks per second — inverted into ACTION_CONFIG.hitIntervalSec (seconds per attack) by ShopTypes.applyShopLevel(). */
    speed: AttributeRange;
    /** resourcePerHit — yield banked per hit, never capped by a target's remaining life (see ActionTypes.ts's own doc). */
    resourcePerHit: AttributeRange;
}

export interface ToolVisualEntry {
    /** Human-readable name — shown wherever a tool needs a display label (e.g. the web editor's Tools tab, ToolLevelUI). Not gameplay data; purely for anything that wants to show a name instead of the raw id. */
    label: string;
    /** Candidate models for this tool — empty until real art exists (see this file's own doc). */
    models: ModelDefinition[];
    /** Texture alias (packed 'survive' image bundle) representing this tool in flat 2D UI — e.g. ToolLevelUI's bottom-right tool/level list, ShopZone's panel. See getToolIcon(), the one reader. */
    icon: string;
    /** Placeholder cylinder color, used only while `models` is empty. */
    color: number;
    /** Placeholder cylinder radius/length, world units (same scale as HEAD_CUBE_SIZE/CARRIER_CUBE_SIZE in CharacterBody.ts) — used only while `models` is empty. */
    radius: number;
    length: number;
    /**
     * Uniform scale applied to whatever's actually shown (real model or placeholder
     * cylinder) — tools were modeled at their own much smaller authored scale than this
     * rig's units, confirmed via CharacterBody's old debug-marker test at 100.
     */
    scale: number;
    /**
     * Local offset from the RightHand bone's own origin — bone-local space, so it turns
     * with the hand automatically. Not obvious from code alone what reads as "gripped"
     * for this rig's bind pose; tune live in-game the same way HEAD_CUBE_OFFSET is tuned.
     */
    offset: THREE.Vector3;
    /** Local rotation (degrees, XYZ euler) so the tool reads as held along the hand/forearm rather than sticking straight out. */
    rotationDeg: THREE.Vector3;
    /**
     * How many levels this tool's upgrade ladder has — 0 for a tool no shop ever upgrades (e.g.
     * "rope"/"hammer" below, which only ever sit at their level-0 stats). Every UI that shows a
     * tool's level (ToolLevelUI, ToolListUI, InventoryPopup's tool row) hides that level entirely
     * for a maxLevel-0 tool instead of showing a permanent, meaningless "Lv.1" — see each of
     * those files' own doc. Also the ladder length the upgrade math scales `attributes` against
     * (see ShopTypes.applyShopLevel()) — ShopConfig.totalLevels is only a fallback for a tool with
     * no maxLevel.
     */
    maxLevel: number;
    /**
     * Where on its 0..maxLevel ladder this tool already sits the moment the player acquires it —
     * its attributes start at that point of the min->max lerp (see ShopTypes.applyToolLevel()),
     * and a shop selling it only has `maxLevel - startLevel` upgrades left to sell (see
     * ShopTypes.getShopMaxLevel()). The level SHOWN in game still counts from Lv.1 at acquire —
     * it's levels bought + 1, not this. undefined/0 (the default) keeps the old from-scratch
     * ladder; clamped to [0, maxLevel] by getToolStartLevel().
     */
    startLevel?: number;
    /**
     * This tool's own upgrade ladder range — undefined for a tool no shop ever upgrades (e.g.
     * "rope" below). A ShopConfig that names this tool via `tool: ToolId` (see ShopTypes.ts)
     * reads its min/max numbers from HERE, not from the shop's own config — the shop is just
     * the storefront (cost/cooldown/appearance), the tool owns what it upgrades between.
     */
    attributes?: ToolAttributeRanges;
    /**
     * When true, a brand-new save starts owning one of whichever ItemType shares this tool's own
     * id (see ItemConfig.toolId's own doc — ItemTypes.ts's ITEM_CONFIG is the join) — see
     * ItemStorage.ts's own doc for exactly how this gets turned into a starting-inventory grant.
     * This lives on the TOOL, not the item, because "what does the player start holding" is a
     * presentation/balance decision made right alongside everything else about how a tool looks
     * and plays, the same place a designer is already looking when deciding this — ItemTypes.ts
     * stays pure id/label/icon-join data with no starting-state opinion of its own. A tool with
     * no matching ItemType at all (nothing in ITEM_CONFIG points a toolId at it) simply has
     * nothing this can grant — harmless, not an error. undefined/false (the default, and every
     * tool before this field existed) means "player crafts/earns it normally," unchanged.
     */
    startWith?: boolean;
    /**
     * How long this tool's own timed action takes, in seconds — one value, not per-attribute
     * like `attributes`, and only meaningful for the tools whose action is a "stand here for a
     * while" timer rather than a swing loop. `min` is the level-0 time (what's actually used
     * today — see getToolActionTimeSec()), `max` the fully-upgraded time for whenever a shop
     * ladder targets it. Undefined for any tool that doesn't use it.
     *
     * Current readers:
     *   - shovel: the time to plant an empty cell of a no-seed farm plot
     *     (FarmPlotConfig.assignedCropId — see FarmPlotTile.startAutoPlantTimer()).
     */
    actionTime?: AttributeRange;
    /**
     * How many farm items this tool holds — only the "carrier" (the crate on the player's back
     * the carry stack sits in, see data/CarrierCapacity.ts) has one. `min` is the capacity at
     * ladder level 0, `max` at maxLevel; each level in between lerps and rounds (so min 3 / max
     * 13 over maxLevel 10 is +1 per level). Undefined for every other tool.
     */
    capacity?: AttributeRange;
}

export const TOOL_LIBRARY = {
    axe: {
        label: "Axe",
        models: [MODELS.Tools.Axe],
        icon: "woodcutters-axe",
        color: 0x6b4423,
        radius: 8,
        length: 100,
        scale: 100,
        offset: new THREE.Vector3(-20, 20, -15),
        rotationDeg: new THREE.Vector3(180, 0, 90),
        maxLevel: 10,
        attributes: {
            "damage": {
                "min": 1,
                "max": 4
            },
            "hitAngleDeg": {
                "min": 45,
                "max": 360
            },
            "hitRangeMeters": {
                "min": 3,
                "max": 10
            },
            "speed": {
                "min": 1,
                "max": 2.5
            },
            "resourcePerHit": {
                "min": 1,
                "max": 10
            }
        },
        "startWith": true,
        "actionTime": {},
        "startLevel": 2
    },
    pickaxe: {
        label: "Pickaxe",
        models: [MODELS.Tools.Pickaxe],
        icon: "mining-pickaxe",
        color: 0x71716f,
        radius: 8,
        length: 100,
        scale: 100,
        offset: new THREE.Vector3(-20, 20, -15),
        rotationDeg: new THREE.Vector3(180, 0, 90),
        maxLevel: 10,
        "attributes": {
            "damage": {
                "min": 1,
                "max": 4
            },
            "hitAngleDeg": {
                "min": 45,
                "max": 180
            },
            "hitRangeMeters": {
                "min": 1,
                "max": 4
            },
            "speed": {
                "min": 1,
                "max": 2.5
            },
            "resourcePerHit": {
                "min": 1,
                "max": 10
            }
        },
        "actionTime": {}
    },
    "rope": {
        color: 0x6b4423,
        radius: 8,
        length: 100,
        scale: 100,
        offset: new THREE.Vector3(-20, 20, -15),
        rotationDeg: new THREE.Vector3(180, 0, 90),
        "label": "Rope",
        "icon": "rope-coil",
        "models": [MODELS.Tools.RopeBundleA],
        maxLevel: 0,
        "attributes": {
            "damage": {},
            "hitAngleDeg": {},
            "hitRangeMeters": {},
            "speed": {},
            "resourcePerHit": {}
        },
        "actionTime": {}
    },
    "hammer": {
        color: 0x6b4423,
        radius: 8,
        length: 100,
        scale: 100,
        offset: new THREE.Vector3(-20, 20, -15),
        rotationDeg: new THREE.Vector3(180, 0, 90),
        "label": "Hammer",
        "icon": "crafting-hammer",
        "models": [MODELS.Tools.Hammer],
        maxLevel: 0,
        "attributes": {
            "damage": {},
            "hitAngleDeg": {},
            "hitRangeMeters": {},
            "speed": {},
            "resourcePerHit": {}
        },
        "startWith": true,
        "actionTime": {}
    },
    "shovel": {
        color: 0x6b4423,
        radius: 8,
        length: 100,
        scale: 100,
        offset: new THREE.Vector3(-20, 20, -15),
        rotationDeg: new THREE.Vector3(180, 0, 90),
        "label": "Shovel",
        "icon": "field-shovel",
        "models": [MODELS.Tools.Shovel],
        maxLevel: 0,
        "attributes": {
            "damage": {},
            "hitAngleDeg": {},
            "hitRangeMeters": {},
            "speed": {},
            "resourcePerHit": {}
        },
        "startWith": true,
        "actionTime": {
            "min": 1,
            "max": 0.5
        }
    },
    "knife": {
        label: "Knife",
        models: [MODELS.Tools.Knife],
        icon: "hunting-knife",
        color: 0x6b4423,
        radius: 8,
        length: 100,
        scale: 100,
        offset: new THREE.Vector3(-20, 20, -15),
        rotationDeg: new THREE.Vector3(180, 0, 90),
        // Copied straight from "axe" — same ladder shape (maxLevel/attributes), see this tool's
        // own doc for why a level-0 tool (rope/hammer/shovel above) skips this entirely instead.
        maxLevel: 10,
        attributes: {
            "damage": {
                "min": 1,
                "max": 4
            },
            "hitAngleDeg": {
                "min": 45,
                "max": 360
            },
            "hitRangeMeters": {
                "min": 3,
                "max": 10
            },
            "speed": {
                "min": 1,
                "max": 2.5
            },
            "resourcePerHit": {
                "min": 1,
                "max": 10
            }
        },
        "actionTime": {}
    },
    // The crate on the player's back (PlayerConfig.carrier is how it LOOKS/mounts). Never held in
    // the hand — no action uses it — so models/offset/rotation are unused placeholders. Its one
    // upgradeable stat is `capacity`, sold by the carrier shop (ShopTypes "shopBackpack").
    "carrier": {
        label: "Carrier",
        models: [],
        icon: "survival-backpack",
        color: 0x8b5a2b,
        radius: 8,
        length: 100,
        scale: 100,
        offset: new THREE.Vector3(0, 0, 0),
        rotationDeg: new THREE.Vector3(0, 0, 0),
        maxLevel: 10,
        "capacity": {
            "min": 3,
            "max": 13
        },
        "startWith": true
    }
} satisfies Record<string, ToolVisualEntry>;

export type ToolId = keyof typeof TOOL_LIBRARY;

/** `TOOL_LIBRARY[id].icon`, as an actual texture — see ToolVisualEntry.icon's own doc. */
export function getToolIcon(id: ToolId): PIXI.Texture {
    return PIXI.Texture.from(TOOL_LIBRARY[id].icon);
}

/**
 * `TOOL_LIBRARY[id].startWith`, defaulted to false — see that field's own doc. A plain
 * `TOOL_LIBRARY[id].startWith` read from a CALLER (e.g. ItemStorage.ts) doesn't type-check:
 * TOOL_LIBRARY is declared via `satisfies Record<string, ToolVisualEntry>`, which keeps each
 * entry's own narrower literal type (exactly what lets `models`'s per-tool array literal type
 * stay specific) rather than widening every entry to the shared ToolVisualEntry interface — and
 * since `startWith` is fully optional and, today, omitted from every single entry's own literal,
 * indexing by a general ToolId returns a union type none of whose members even mention the
 * property. This helper is the one place that owns the cast back to the shared interface, so
 * every OTHER file just calls a plain boolean-returning function instead of re-deriving that
 * same cast for itself.
 */
export function toolStartsWithPlayer(id: ToolId): boolean {
    return (TOOL_LIBRARY[id] as ToolVisualEntry).startWith ?? false;
}

/** `TOOL_LIBRARY[id].startLevel`, clamped to [0, maxLevel] — see that field's own doc. Same widening cast toolStartsWithPlayer() explains. */
export function getToolStartLevel(id: ToolId): number {
    const entry = TOOL_LIBRARY[id] as ToolVisualEntry;
    return Math.min(Math.max(0, Math.floor(entry.startLevel ?? 0)), Math.max(0, entry.maxLevel));
}

/**
 * `TOOL_LIBRARY[id].actionTime`, resolved to the seconds actually in effect right now — lerped
 * min -> max by the tool's startLevel / maxLevel (no shop upgrades actionTime yet, so that's
 * the whole ladder position). undefined for a tool with no actionTime at all, so a caller can
 * fall back to its own default. Same widening cast toolStartsWithPlayer() explains.
 */
export function getToolActionTimeSec(id: ToolId): number | undefined {
    const entry = TOOL_LIBRARY[id] as ToolVisualEntry;
    const range = entry.actionTime;
    if (range?.min === undefined) {
        return undefined;
    }
    if (range.max === undefined || entry.maxLevel <= 0) {
        return range.min;
    }
    return range.min + (range.max - range.min) * (getToolStartLevel(id) / entry.maxLevel);
}
