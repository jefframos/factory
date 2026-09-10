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
    /** Placeholder cylinder radius/length, world units (same scale as HEAD_CUBE_SIZE/BACKPACK_CUBE_SIZE in CharacterBody.ts) — used only while `models` is empty. */
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
     * those files' own doc. Should match whatever ShopConfig.totalLevels a shop targeting this
     * tool via `tool: ToolId` (see ShopTypes.ts) actually uses, though nothing enforces that
     * automatically today — this is purely a UI-visibility flag, not itself read by the upgrade
     * math (ShopTypes.applyShopLevel() reads `attributes`/ShopConfig.totalLevels directly).
     */
    maxLevel: number;
    /**
     * This tool's own upgrade ladder range — undefined for a tool no shop ever upgrades (e.g.
     * "rope" below). A ShopConfig that names this tool via `tool: ToolId` (see ShopTypes.ts)
     * reads its min/max numbers from HERE, not from the shop's own config — the shop is just
     * the storefront (cost/cooldown/appearance), the tool owns what it upgrades between.
     */
    attributes?: ToolAttributeRanges;
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
        }
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
        }
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
        }
    }
} satisfies Record<string, ToolVisualEntry>;

export type ToolId = keyof typeof TOOL_LIBRARY;

/** `TOOL_LIBRARY[id].icon`, as an actual texture — see ToolVisualEntry.icon's own doc. */
export function getToolIcon(id: ToolId): PIXI.Texture {
    return PIXI.Texture.from(TOOL_LIBRARY[id].icon);
}
