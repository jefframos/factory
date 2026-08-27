// SettingsUIService.ts
//
// Owns the persistent top-left mute + settings buttons — kept as its own
// service (constructed by UIService, same "one field + update()/destroy()
// call" shape UIService's own BackpackUI/GlobalResourcesUI/etc. panels use)
// rather than folded straight into UIService, so UIService's per-panel
// position() layout doesn't have to know these two buttons exist as
// anything more than "another thing to update()/destroy()".
//
// The mute button is core/ui/SoundToggleButton — the SAME generic Pixi
// class tower's tw/ui/GameHud.ts already uses (games/tower/tw/ui/GameHud.ts,
// same 'PictoIcon_Music_1'/'PictoIcon_Music_1_Off' texture keys pizza's own
// Assets.Textures.Icons.SoundOn/SoundOff point at) — this is the actual
// "same across every game" framework piece the mute button is supposed to
// reuse, not a new pizza-specific button.
//
// The settings button's own PANEL content lives in PopupManager/SettingsPopup
// (see games/pizza/game/ui/popups/) — this file only owns the button that
// opens it.

import * as PIXI from 'pixi.js';
import { Game } from 'core/Game';
import BaseButton from 'core/ui/BaseButton';
import SoundToggleButton from 'core/ui/SoundToggleButton';
import Assets from '../../Assets';
import { PopupManager } from './popups/PopupManager';
import SettingsPopup from './popups/SettingsPopup';

/** Gap between the button row's top/left edges and the actual top-left corner of the screen. Exported so UIService (ToolListUI's positioning) can pin something directly under this row without duplicating the margin. */
export const SETTINGS_ROW_TOP_LEFT_MARGIN = 16;
const TOP_LEFT_MARGIN = SETTINGS_ROW_TOP_LEFT_MARGIN;
/** Gap between the settings button and the mute button sitting to its right. */
const BUTTON_GAP = 10;
/** Shared square size for both top-left buttons — no button-background art exists yet for pizza's own settings/mute buttons, so PIXI.Texture.EMPTY (icon only, no background box) is the placeholder until real art exists. Exported for the same reason as SETTINGS_ROW_TOP_LEFT_MARGIN — UIService needs this row's height to pin something below it. */
export const SETTINGS_ROW_BUTTON_SIZE = 48;
const BUTTON_SIZE = SETTINGS_ROW_BUTTON_SIZE;
const BUTTON_ICON_SIZE = 42;
/** Corner-pinned "this matters" badge on the settings button — see BaseButton.addAlertIcon(). Always shown (not conditional on anything) since the ask is simply "mark this button as important," not "only when a setting needs attention." */
const ALERT_ICON_SIZE = 20;

export default class SettingsUIService {
    private readonly game: Game;
    private readonly soundToggle: SoundToggleButton;
    private readonly settingsButton: BaseButton;

    public constructor(game: Game) {
        this.game = game;

        // PopupManager is a cross-cutting singleton (any future popup, not just this one,
        // shows through it) — init() is idempotent, so calling it here doesn't require
        // coordinating with whoever else might also call it first.
        PopupManager.instance.init(game);

        this.soundToggle = new SoundToggleButton(Assets.Textures.Icons.SoundOn, Assets.Textures.Icons.SoundOff);
        // SoundToggleButton's own icons are centered (0.5, 0.5) on its local origin (see
        // core/ui/SoundToggleButton.ts) rather than top-left like BaseButton — scaled down to
        // roughly match BUTTON_SIZE's icon-only footprint, same 0.7 scale tower's GameHud uses
        // on the identical class.
        this.soundToggle.scale.set(0.7);
        this.game.uiLayer.addChild(this.soundToggle);

        this.settingsButton = new BaseButton({
            standard: {
                width: BUTTON_SIZE, height: BUTTON_SIZE,
                texture: PIXI.Texture.EMPTY, tint: 0x222233,
                iconTexture: PIXI.Texture.from(Assets.Textures.Icons.Settings),
                iconSize: { width: BUTTON_ICON_SIZE, height: BUTTON_ICON_SIZE },
                centerIconHorizontally: true,
                centerIconVertically: true,
            },
            over: { tint: 0x333344 },
            down: { tint: 0x11111a },
            // On CLICK, not STANDARD — see UIService.cameraToggleButton's identical doc on why
            // (setState(STANDARD) also fires on construction and every mouse-out).
            click: { callback: () => PopupManager.instance.show(new SettingsPopup()) },
        });
        this.settingsButton.addAlertIcon(PIXI.Texture.from(Assets.Textures.UI.Exclamation), ALERT_ICON_SIZE);
        this.game.uiLayer.addChild(this.settingsButton);

        this.update();
    }

    /** Re-anchors the button row to the current viewport every frame — called from UIService.update(), same reasoning as every other panel there. */
    public update(): void {
        const screen = Game.overlayScreenData;
        if (!screen) {
            return;
        }

        this.settingsButton.position.set(
            screen.topLeft.x + TOP_LEFT_MARGIN,
            screen.topLeft.y + TOP_LEFT_MARGIN,
        );

        // soundToggle's own origin is its ICON CENTER (see the constructor's own doc), so
        // landing it BUTTON_SIZE/2 below/right of the row's top-left edge — rather than flush
        // with it like settingsButton (a plain top-left-anchored BaseButton) — is what actually
        // centers it inside the same BUTTON_SIZE-tall row.
        this.soundToggle.position.set(
            screen.topLeft.x + TOP_LEFT_MARGIN + BUTTON_SIZE + BUTTON_GAP + BUTTON_SIZE / 2,
            screen.topLeft.y + TOP_LEFT_MARGIN + BUTTON_SIZE / 2,
        );
    }

    public destroy(): void {
        this.soundToggle.destroy();
        this.settingsButton.destroy();
    }
}
