// ResourceSlotVisual.ts
//
// The "square icon slot" visual BackpackUI renders per carried resource — a
// tinted/alpha'd background square with an icon (see AssetLibraryRegistry.
// getAssetIcon()) fitted/centered inside it — factored out so anything else
// that wants to show a resource "in a slot" (BuildingZone's requirement row)
// renders the same slot instead of hand-rolling its own background/icon-fit
// logic. Unlike BackpackUI's own slots (a small corner badge overlaid on the
// icon — fine at BackpackUI's 48px), the count label here renders BELOW the
// slot, centered — at the smaller sizes a requirement row uses, a corner
// badge would sit on top of the icon instead of beside it. BackpackUI keeps
// its own slot bookkeeping (reused/emptied slots, jiggle animation state)
// and isn't changed to consume this.

import * as PIXI from 'pixi.js';
import { ResourceType } from '../actions/ResourceTypes';
import { RESOURCE_ASSET_KEYS } from '../actions/ResourceRegistry';
import { getAssetIcon } from '../world/AssetLibraryRegistry';
import { TextStyleRegistry } from './TextStyleRegistry';
import ViewUtils from 'core/utils/ViewUtils';

/** Same texture/tint/alpha BackpackUI uses for its slot backgrounds — see BackpackUI.ts's own SLOT_BG_* constants. */
const SLOT_BG_TEXTURE_KEY = 'BorderFrame_Squrare_Bg';
const SLOT_BG_TINT = 0x000000;
const SLOT_BG_ALPHA = 0.5;
/** Gap left between the icon's edge and the slot background's edge — same value as BackpackUI's ICON_PADDING. */
const ICON_PADDING = 6;
/** Gap between the slot background's bottom edge and the count label sitting below it. */
const LABEL_MARGIN_TOP = 4;

export interface ResourceSlotVisual {
    readonly container: PIXI.Container;
    readonly icon: PIXI.Sprite;
    readonly label: PIXI.Text;
    /** Total local height of `container` — the slot square plus the label below it — so a caller laying out several of these in a row can size/position around the real footprint instead of just `size`. */
    readonly visualHeight: number;
}

/** Builds one `size`x`size` slot showing `type`'s icon, with `labelText` centered directly below it — same slot look as BackpackUI, sized for wherever it's used. Caller owns positioning/adding `container` and destroying it when done. */
export function createResourceSlot(type: ResourceType, size: number, labelText: string): ResourceSlotVisual {
    const container = new PIXI.Container();

    const background = new PIXI.Sprite(PIXI.Texture.from(SLOT_BG_TEXTURE_KEY));
    background.tint = SLOT_BG_TINT;
    background.alpha = SLOT_BG_ALPHA;
    background.width = size;
    background.height = size;
    container.addChild(background);

    const icon = new PIXI.Sprite(getAssetIcon(RESOURCE_ASSET_KEYS[type]));
    icon.anchor.set(0.5);
    icon.position.set(size / 2, size / 2);
    icon.scale.set(ViewUtils.elementScaler(icon, size - ICON_PADDING * 2));
    container.addChild(icon);

    const label = new PIXI.Text(labelText, TextStyleRegistry.Body);
    label.anchor.set(0.5, 0);
    label.position.set(size / 2, size + LABEL_MARGIN_TOP);
    container.addChild(label);

    return { container, icon, label, visualHeight: size + LABEL_MARGIN_TOP + label.height };
}
