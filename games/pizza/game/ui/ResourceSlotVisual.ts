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
import { createIconSlotBackground, styleForResourceType } from './IconSlotRegistry';
import { getIconLayout } from './LayoutRegistry';
import ViewUtils from 'core/utils/ViewUtils';

/** This slot's own layout — see LayoutRegistry.ts's own doc. Tune 'Requirement' there (or ICON_LAYOUT_DEFAULT, for every layout at once) rather than the constants that used to live here. */
const LAYOUT = getIconLayout('Requirement');

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

    const background = createIconSlotBackground(size, styleForResourceType(type));
    container.addChild(background);

    const icon = new PIXI.Sprite(getAssetIcon(resolveResourceAssetKey(type)));
    icon.anchor.set(0.5);
    icon.position.set(size / 2, size / 2);
    icon.scale.set(ViewUtils.elementScaler(icon, size - LAYOUT.iconPadding * 2));
    container.addChild(icon);

    const label = new PIXI.Text(labelText, TextStyleRegistry.Body);
    label.anchor.set(LAYOUT.label.anchor[0], LAYOUT.label.anchor[1]);
    label.position.set(size - LAYOUT.label.offset[0], size - LAYOUT.label.offset[1]);
    container.addChild(label);

    return { container, icon, label, visualHeight: size };
}
