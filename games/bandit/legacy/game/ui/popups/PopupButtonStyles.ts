// PopupButtonStyles.ts
//
// Named button "roles" for popup content — thin wrapper over ButtonLibrary.ts
// (the single shared source every button in the game pulls its art from, see
// that file's own doc) so popup content can ask for a semantic ROLE
// ('primary'/'secondary'/'accent') instead of a raw color, the same way
// FrameRegistry.ts's named frame presets sit in front of raw texture keys.
// 'primary' is wired to green (the obvious go/confirm color) — add a new
// role here (or repoint an existing one) any time a popup needs a different
// emphasis level, rather than hand-rolling a ButtonLibrary call per site.

import BaseButton from 'core/ui/BaseButton';
import { createLibraryButton, LibraryButtonColor } from '../ButtonLibrary';

export type PopupButtonRole = 'primary' | 'secondary' | 'accent';

const ROLE_COLOR: Record<PopupButtonRole, LibraryButtonColor> = {
    primary: 'green',
    secondary: 'grey',
    accent: 'yellow',
};

export const POPUP_BUTTON_WIDTH = 220;
export const POPUP_BUTTON_HEIGHT = 64;

/** Builds a BaseButton styled for `role` — see ButtonLibrary.createLibraryButton() for the actual shared feedback/texture plumbing. */
export function createPopupButton(label: string, role: PopupButtonRole, onClick: () => void): BaseButton {
    return createLibraryButton({
        color: ROLE_COLOR[role],
        width: POPUP_BUTTON_WIDTH, height: POPUP_BUTTON_HEIGHT,
        label,
        onClick,
    });
}
