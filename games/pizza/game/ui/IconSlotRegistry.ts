// IconSlotRegistry.ts
//
// Named presets for the "square tinted backdrop behind a smaller icon"
// composition used everywhere a resource/tool/animal icon needs to read
// clearly against a busy background — BackpackUI, BackpackListUI,
// AnimalDockUI, AnimalFollowUI, ToolListUI, InventoryPopup, MartPopup,
// FarmCropHud, FarmSeedPicker and ResourceSlotVisual each used to build
// their own copy of the exact same texture/tint/alpha triplet. This is the
// one shared source for that triplet — same "registry of reusable named
// presets" shape as FrameRegistry.ts, one level below it (a plain Sprite,
// not 9-sliced, since this backdrop is always square and never stretched
// non-uniformly).
//
// Per-CONTENT-KIND presets (Tool/Crop/Resource/Currency below), same
// reasoning as FrameRegistry's own per-entity-TYPE presets
// (BuildingFrame/ShopFrame/QueueFrame/CraftingFrame): each caller picks
// whichever one matches what it's actually showing, so a designer can
// retint one kind of icon slot without touching the others. Every preset is
// cloned from Default's own look below, so nothing changes visually until
// one actually gets tuned.
//
// Deliberately does NOT own size or icon padding — those genuinely differ
// per caller's own layout (a backpack slot isn't padded the same as a mart
// row icon) and stay local to whichever file builds that layout.

import * as PIXI from 'pixi.js';
import { RESOURCE_CONFIG, ResourceType } from '../actions/ResourceTypes';

export interface IconSlotStyle {
    /** Texture alias inside the packed 'images' bundle — see Assets.getTexture(). */
    textureKey: string;
    tint: number;
    alpha: number;
}

export const IconSlotRegistry: Record<string, IconSlotStyle> = {
    Default: {
        textureKey: 'back1',
        tint: 0x000000,
        alpha: 0.9,
    },
    /** ToolListUI/InventoryPopup's own tool row — a tool icon's slot. Bright sky blue — saturated, not the muddy steel-grey this used to be, to match the rest of this game's vibrant/hypercasual palette. */
    Tool: {
        textureKey: 'back1',
        tint: 0x35b6ff,
        alpha: 1,
    },
    /** A CropTypes.ts harvest yield OR a SeedTypes.ts seed — FarmCropHud/FarmSeedPicker's own icon, and any generic resource slot showing a 'farm'-category resource (see styleForResourceType() below). Bright grass green. */
    Crop: {
        textureKey: 'back1',
        tint: 0x4ddd5a,
        alpha: 1,
    },
    /** A plain bankable resource (BackpackStorage's 'main'/'animal'-category items) — see styleForResourceType() below. Punchy orange — saturated, not the muddy earth-brown this used to be. */
    Resource: {
        textureKey: 'back1',
        tint: 0xff8a3d,
        alpha: 1,
    },
    /** Not wired to a live caller yet (every currency icon today — EconomyUI's topbar pill, QueueZone's reward line — uses its own shape, not this square-slot composition) — kept ready for whenever one needs it. Bright gold. */
    Currency: {
        textureKey: 'back1',
        tint: 0xffd23f,
        alpha: 1,
    },
};

export type IconSlotName = keyof typeof IconSlotRegistry;

/**
 * Which style a given resource's own generic slot background should use —
 * 'Crop' for a 'farm'-category resource (a crop's own harvest yield, e.g.
 * MartTypes.ts's "farmShop" mart actually sells Cabbage/Cauliflower — see
 * ResourceConfig.category's own doc), 'Resource' for everything else (the
 * default 'main'/'animal' categories). Centralizes this so every call site
 * that renders an ARBITRARY, caller-supplied ResourceType (ResourceSlotVisual,
 * MartPopup, InventoryPopup's Resources+Farm tabs) picks the same style for
 * the same resource instead of each guessing independently. NOT used by
 * BackpackUI/BackpackListUI — those two already filter 'farm'-category
 * resources out entirely (see their own doc), so every row they ever show is
 * guaranteed 'Resource' and they hardcode that directly rather than paying
 * for a lookup that can never actually return 'Crop'.
 */
export function styleForResourceType(type: ResourceType): IconSlotName {
    return RESOURCE_CONFIG[type]?.category === 'farm' ? 'Crop' : 'Resource';
}

/**
 * Builds a `size`x`size` plain stretched Sprite styled per `style` (default:
 * 'Default') — the exact backdrop every icon-slot caller in this game used
 * to hand-build. Caller owns positioning/adding/destroying it, same as any
 * other Sprite; add the icon itself (and any count label) on top.
 */
export function createIconSlotBackground(size: number, style: IconSlotName = 'Default'): PIXI.Sprite {
    const def = IconSlotRegistry[style];
    const background = new PIXI.Sprite(PIXI.Texture.from(def.textureKey));
    background.tint = def.tint;
    background.alpha = def.alpha;
    background.width = size;
    background.height = size;
    return background;
}
