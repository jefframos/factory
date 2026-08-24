// ResourceSlotVisual.ts
//
// The "square icon slot" visual BackpackUI renders per carried resource — a
// tinted/alpha'd background square with an icon (see AssetLibraryRegistry.
// getAssetIcon()) fitted/centered inside it — factored out so anything else
// that wants to show a resource "in a slot" (BuildingZone's requirement row)
// renders the same slot instead of hand-rolling its own background/icon-fit
// logic. The count label sits INSIDE the slot's own bottom-right corner —
// same anchor(1,1)/inset idiom as BackpackUI's own slot count badge — rather
// than below it, so a row of these reads as one compact icon+count chip
// instead of icon-then-separate-label-underneath. BackpackUI keeps its own
// slot bookkeeping (reused/emptied slots, jiggle animation state) and isn't
// changed to consume this.

import * as PIXI from 'pixi.js';
import { ResourceType } from '../actions/ResourceTypes';
import { resolveResourceAssetKey } from '../actions/ResourceRegistry';
import { getAssetIcon } from '../world/AssetLibraryRegistry';
import { TextStyleRegistry } from './TextStyleRegistry';
import ViewUtils from 'core/utils/ViewUtils';

/** Same texture/tint/alpha BackpackUI uses for its slot backgrounds — see BackpackUI.ts's own SLOT_BG_* constants. */
const SLOT_BG_TEXTURE_KEY = 'BorderFrame_Squrare_Bg';
const SLOT_BG_TINT = 0x000000;
const SLOT_BG_ALPHA = 0.5;
/** Gap left between the icon's edge and the slot background's edge — same value as BackpackUI's ICON_PADDING. */
const ICON_PADDING = 6;
/** Inset of the count label from the slot's own bottom-right corner — same idiom/values as BackpackUI's own slot count badge (see that file's own label.position.set()). */
const LABEL_INSET_RIGHT = 4;
const LABEL_INSET_BOTTOM = 2;

export interface ResourceSlotVisual {
    readonly container: PIXI.Container;
    readonly icon: PIXI.Sprite;
    readonly label: PIXI.Text;
    /** Total local height of `container` — just the slot square now that the count label sits INSIDE it (bottom-right corner) rather than below — kept as its own field so a caller laying out several of these in a row doesn't need to know that changed. */
    readonly visualHeight: number;
}

/** Builds one `size`x`size` slot showing `type`'s icon, with `labelText` in its bottom-right corner — same slot look (and count-badge placement) as BackpackUI, sized for wherever it's used. Caller owns positioning/adding `container` and destroying it when done. */
export function createResourceSlot(type: ResourceType, size: number, labelText: string): ResourceSlotVisual {
    const container = new PIXI.Container();

    const background = new PIXI.Sprite(PIXI.Texture.from(SLOT_BG_TEXTURE_KEY));
    background.tint = SLOT_BG_TINT;
    background.alpha = SLOT_BG_ALPHA;
    background.width = size;
    background.height = size;
    container.addChild(background);

    const icon = new PIXI.Sprite(getAssetIcon(resolveResourceAssetKey(type)));
    icon.anchor.set(0.5);
    icon.position.set(size / 2, size / 2);
    icon.scale.set(ViewUtils.elementScaler(icon, size - ICON_PADDING * 2));
    container.addChild(icon);

    const label = new PIXI.Text(labelText, TextStyleRegistry.Body);
    label.anchor.set(1, 1);
    label.position.set(size - LABEL_INSET_RIGHT, size - LABEL_INSET_BOTTOM);
    container.addChild(label);

    return { container, icon, label, visualHeight: size };
}
