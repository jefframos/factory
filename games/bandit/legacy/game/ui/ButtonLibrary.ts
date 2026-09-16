// ButtonLibrary.ts
//
// The ONE place every clickable button in this game pulls its background art
// from — same "registry of reusable named presets" shape as FrameRegistry.ts/
// UpgradeStyle.ts, just for buttons instead of panels/badges. Before this
// file existed, buttons were built ad hoc per call site (Popup.ts's own
// WHITE+tint close button, BackpackButton's Button_SkillBtn_Blue, PopupButtonStyles'
// own Button01_s_* family) — three different visual languages for what's
// conceptually the same thing: a colored, nine-sliced, clickable button.
// createLibraryButton() is now the single BaseButton factory every one of
// those call sites goes through, so retexturing "every button in the game"
// is a one-file change instead of a hunt.
//
// All seven ResourceBar_Single_Btn_* colors (the SAME asset family
// FrameRegistry.ts's own 'Popup'/'ShopFrame'/'QueueFrame'/etc. bubble frames
// already use, just consumed at button scale instead of full-panel scale —
// see BUTTON_NINE_SLICE_PADDING's own doc for why the padding differs from
// FrameRegistry's DEFAULT_PADDING_BUBBLE even though it's the same source
// art) are represented here, not just the ones currently wired up — add a
// new button call site by picking whichever LibraryButtonColor reads right,
// never by importing a new texture directly.

import * as PIXI from 'pixi.js';
import BaseButton from 'core/ui/BaseButton';
import { TextStyleRegistry } from './TextStyleRegistry';

export type LibraryButtonColor = 'blue' | 'green' | 'grey' | 'orange' | 'purple' | 'red' | 'yellow';

const BUTTON_TEXTURE_BY_COLOR: Record<LibraryButtonColor, string> = {
    blue: 'ResourceBar_Single_Btn_Blue1',
    green: 'ResourceBar_Single_Btn_Green1',
    grey: 'ResourceBar_Single_Btn_Grey',
    orange: 'ResourceBar_Single_Btn_Orange1',
    purple: 'ResourceBar_Single_Btn_Purple1',
    red: 'ResourceBar_Single_Btn_Red1',
    yellow: 'ResourceBar_Single_Btn_Yellow1',
};

/**
 * Nine-slice border width for THIS family consumed at button scale (source art is 60x62) — a
 * smaller value than FrameRegistry's own DEFAULT_PADDING_BUBBLE (30px), which assumes the same
 * art stretched out to a full popup panel's size. At a ~36-64px button footprint, a 30px border
 * would leave little-to-no stretchable middle (or go negative), so buttons use their own,
 * smaller padding instead.
 */
export const BUTTON_NINE_SLICE_PADDING = 16;

/** Left-edge gap for an `iconAlign: 'left'` icon — see LibraryButtonConfig.iconAlign's own doc. */
const ICON_LEFT_PADDING = 12;
/** How far a label shifts right (on top of its own centering) to make room for a left-aligned icon — see iconLeftAligned's own usage below. */
const TEXT_ICON_SHIFT = 10;

/** Texture alias inside the packed 'images' bundle for `color` — exposed directly for the rare caller that needs the raw texture (e.g. a plain PIXI.Sprite background) rather than a full interactive button. */
export function libraryButtonTexture(color: LibraryButtonColor): PIXI.Texture {
    return PIXI.Texture.from(BUTTON_TEXTURE_BY_COLOR[color]);
}

export interface LibraryButtonConfig {
    color: LibraryButtonColor;
    width: number;
    height: number;
    onClick: () => void;
    /** Text label — omit for an icon-only button (close, backpack, settings, ...). */
    label?: string;
    fontSize?: number;
    /** Icon centered on top of the button art — omit for a text-only button (e.g. PopupButtonStyles' "Clear Data"). */
    iconTexture?: PIXI.Texture;
    iconSize?: { width: number; height: number };
    /**
     * Where the icon sits when BOTH an icon and a label are given. 'center' (the default) stacks
     * it in the middle behind the label, same as every existing icon-only button (close,
     * backpack, settings, ...) — fine there since none of those also carry a label, but would
     * otherwise render the label right on top of the icon. 'left' instead pins it near the
     * button's own left edge (ICON_LEFT_PADDING in, vertically centered), reading as an
     * icon-prefixed label instead of an overlap. Ignored for icon-only buttons (no label).
     */
    iconAlign?: 'center' | 'left';
}

/** Builds a BaseButton styled from the shared library, with standard/over/down feedback baked in so every button in the game behaves the same without repeating the state table at each call site. */
export function createLibraryButton(config: LibraryButtonConfig): BaseButton {
    const hasIcon = config.iconTexture !== undefined;
    const iconLeftAligned = hasIcon && config.label !== undefined && config.iconAlign === 'left';
    const button = new BaseButton({
        standard: {
            width: config.width, height: config.height,
            texture: libraryButtonTexture(config.color),
            allPadding: BUTTON_NINE_SLICE_PADDING,
            iconTexture: config.iconTexture,
            iconSize: config.iconSize,
            textOffset: new PIXI.Point(iconLeftAligned ? TEXT_ICON_SHIFT : 0, -2),
            // Left-aligned icons position themselves via iconAnchor/iconOffset below instead —
            // centerIconVertically assumes the sprite's default (0,0) top-left anchor, which
            // would double up with the (0, 0.5) anchor iconAnchor sets for a left-aligned icon.
            centerIconHorizontally: hasIcon && !iconLeftAligned,
            centerIconVertically: hasIcon && !iconLeftAligned,
            iconAnchor: iconLeftAligned ? new PIXI.Point(0, 0.5) : undefined,
            iconOffset: iconLeftAligned ? new PIXI.Point(ICON_LEFT_PADDING, config.height / 2 - 2) : undefined,
            fontStyle: config.label !== undefined
                ? new PIXI.TextStyle({ ...TextStyleRegistry.Body, ...(config.fontSize !== undefined ? { fontSize: config.fontSize } : {}) })
                : undefined,
            fontColor: 0xffffff,
            fitText: config.label !== undefined ? 0.75 : undefined,
        },
        over: { tint: 0xdddddd },
        down: { tint: 0xaaaaaa },
        click: { callback: config.onClick },
    });
    if (config.label !== undefined) {
        button.setLabel(config.label);
    }
    return button;
}
