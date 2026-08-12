// PopupButtonStyles.ts
//
// Named button "roles" for popup content — each maps to one of the three
// Button01_s_* nine-slice button textures actually delivered
// (games/pizza/raw-assets/images/ui{tps}/Button01_s_*.png, 35px nine-slice
// border baked into every one of them — see BUTTON_NINE_SLICE_PADDING).
// This is the "somewhere to add the primary button" slot the button-role
// system exists for: 'primary' is already wired to Green (the obvious
// go/confirm color) — add a new role here (or repoint an existing one) any
// time a popup needs a different emphasis level, rather than hand-rolling
// texture/tint per popup call site.

import * as PIXI from 'pixi.js';
import BaseButton from 'core/ui/BaseButton';
import { TextStyleRegistry } from '../TextStyleRegistry';

export type PopupButtonRole = 'primary' | 'secondary' | 'accent';

const ROLE_TEXTURES: Record<PopupButtonRole, string> = {
    primary: 'Button01_s_Green',
    secondary: 'Button01_s_Gray',
    accent: 'Button01_s_Mint',
};

/** Nine-slice border width baked into every Button01_s_* asset — same uniformPadding() idea FrameRegistry.ts uses for its own BorderFrame assets, just a different asset family/padding value. */
const BUTTON_NINE_SLICE_PADDING = 35;

export const POPUP_BUTTON_WIDTH = 220;
export const POPUP_BUTTON_HEIGHT = 64;

/** Builds a BaseButton styled for `role`, with standard/over/down feedback baked in so every popup button behaves the same without repeating the state table at each call site. */
export function createPopupButton(label: string, role: PopupButtonRole, onClick: () => void): BaseButton {
    const button = new BaseButton({
        standard: {
            width: POPUP_BUTTON_WIDTH, height: POPUP_BUTTON_HEIGHT,
            texture: PIXI.Texture.from(ROLE_TEXTURES[role]),
            allPadding: BUTTON_NINE_SLICE_PADDING,
            fontStyle: new PIXI.TextStyle(TextStyleRegistry.Body),
            fontColor: 0xffffff,
            fitText: 0.75,
        },
        over: { tint: 0xdddddd },
        down: { tint: 0xaaaaaa },
        click: { callback: onClick },
    });
    button.setLabel(label);
    return button;
}
