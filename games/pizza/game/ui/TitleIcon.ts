// TitleIcon.ts
//
// The icon shown to the left of a Popup's own title (see Popup.ts's
// `titleIcon` option) — same "square tinted backdrop behind a smaller icon"
// composition IconSlotRegistry.ts already gives every resource/tool/crop
// icon in the game (BackpackListUI, MartPopup's rows, InventoryPopup's
// grids, ...), applied here too instead of a bare icon floating with
// nothing behind it. One shared component so InventoryPopup/MartPopup/
// CraftingTablePopup's own title icons all render identically rather than
// each hand-building its own copy.
//
// Uses IconSlotRegistry's own 'Default' style (plain black, 0.9 alpha, same
// 'back1' texture PanelBackground's own dark content panel is built from)
// rather than one of the named content-kind tints (Tool/Crop/Resource/...)
// — a popup's own identifying icon isn't tied to any one of those content
// kinds, so it gets the same neutral, content-agnostic backing every dark
// panel in this game already shares.

import * as PIXI from 'pixi.js';
import { createIconSlotBackground } from './IconSlotRegistry';

/** Gap left between the icon's own edge and its background square's edge — same "icon renders smaller than its own backdrop" idiom every other icon-slot composition in the game uses. */
const ICON_PADDING = 4;

/** Builds a `size`x`size` icon slot (background + centered icon) for `textureKey` — caller owns positioning/adding/destroying the returned container, same as any other PIXI.Container. */
export function createTitleIcon(textureKey: string, size: number): PIXI.Container {
    const container = new PIXI.Container();

    const background = createIconSlotBackground(size, 'Default');
    container.addChild(background);
    background.alpha = 0.5

    const icon = new PIXI.Sprite(PIXI.Texture.from(textureKey));
    icon.anchor.set(0.5, 0.5);
    icon.width = size - ICON_PADDING * 2;
    icon.height = size - ICON_PADDING * 2;
    icon.position.set(size / 2, size / 2);
    container.addChild(icon);

    return container;
}
