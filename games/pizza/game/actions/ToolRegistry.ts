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

export interface ToolVisualEntry {
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
}

export const TOOL_LIBRARY = {
    axe: {
        models: [MODELS.Tools.Axe],
        icon: 'woodcutters-axe',
        color: 0x6b4423,
        radius: 8,
        length: 100,
        scale: 100,
        offset: new THREE.Vector3(-20, 20, -15),
        rotationDeg: new THREE.Vector3(180, 0, 90),
    },
    pickaxe: {
        models: [MODELS.Tools.Pickaxe],
        icon: 'mining-pickaxe',
        color: 0x71716f,
        radius: 8,
        length: 100,
        scale: 100,
        offset: new THREE.Vector3(-20, 20, -15),
        rotationDeg: new THREE.Vector3(180, 0, 90),
    },
} satisfies Record<string, ToolVisualEntry>;

export type ToolId = keyof typeof TOOL_LIBRARY;

/** `TOOL_LIBRARY[id].icon`, as an actual texture — see ToolVisualEntry.icon's own doc. */
export function getToolIcon(id: ToolId): PIXI.Texture {
    return PIXI.Texture.from(TOOL_LIBRARY[id].icon);
}
