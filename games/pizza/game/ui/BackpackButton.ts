// BackpackButton.ts
//
// Bottom-right button that opens InventoryPopup (see ./popups/InventoryPopup.ts)
// — same "one field + update()/destroy()" shape every other UIService-owned
// panel uses, same BaseButton config shape SettingsUIService.settingsButton
// already uses for its own popup-opening button, just pinned bottom-right
// instead of top-left. Bottom-right is otherwise empty (ToolLevelUI, the
// only other panel that ever anchored there, isn't in the display tree —
// see UIService.ts's own comment on toolListUi being the one actually
// shown), so this doesn't need to dodge anything the way a bottom-LEFT
// button would (InGameButtonList's own utility-button column).

import * as PIXI from 'pixi.js';
import { Game } from 'core/Game';
import BaseButton from 'core/ui/BaseButton';
import { PopupManager } from './popups/PopupManager';
import InventoryPopup from './popups/InventoryPopup';
import { createLibraryButton } from './ButtonLibrary';

/** Gap between the button's bottom/right edges and the actual bottom-right corner of the screen. */
const BOTTOM_RIGHT_MARGIN = 16;
/** Bigger than the settings/mute row's own 48px (SETTINGS_ROW_BUTTON_SIZE) — this is the game's own primary inventory entry point, not a small utility toggle, so it reads as more prominent. */
const BUTTON_SIZE = 76;
const BUTTON_ICON_SIZE = 56;

export default class BackpackButton extends PIXI.Container {
    private readonly button: BaseButton;

    public constructor() {
        super();

        // Goes through the shared library (see ButtonLibrary.ts) instead of its own one-off
        // Button_SkillBtn_Blue texture — 'blue' matches the same color the default 'Popup' frame
        // itself uses, keeping this button visually consistent with the rest of the game's UI.
        this.button = createLibraryButton({
            color: 'blue',
            width: BUTTON_SIZE, height: BUTTON_SIZE,
            iconTexture: PIXI.Texture.from('survival-backpack'),
            iconSize: { width: BUTTON_ICON_SIZE, height: BUTTON_ICON_SIZE },
            // On CLICK, not STANDARD — same reasoning as SettingsUIService.settingsButton's own
            // doc (setState(STANDARD) also fires on construction and every mouse-out).
            onClick: () => PopupManager.instance.show(new InventoryPopup()),
        });
        this.addChild(this.button);
    }

    /** Re-anchors to the current viewport every frame — called from UIService.update(). */
    public update(): void {
        const screen = Game.overlayScreenData;
        if (!screen) {
            return;
        }

        this.button.position.set(
            screen.bottomRight.x - BUTTON_SIZE - BOTTOM_RIGHT_MARGIN,
            screen.bottomRight.y - BUTTON_SIZE - BOTTOM_RIGHT_MARGIN,
        );
    }

    public override destroy(options?: Parameters<PIXI.Container['destroy']>[0]): void {
        this.button.destroy();
        super.destroy(options);
    }
}
