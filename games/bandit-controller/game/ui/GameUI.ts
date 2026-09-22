// GameUI.ts
//
// HubScene's own top-right button stack: Reset, then a quick-launch button per minigame
// stacked directly under it — dev/testing shortcuts for the same walk-through-the-gate
// transition, see HubScene's own onEnterMinigame wiring. Positioned against
// Game.overlayScreenData.topRight — the same "screen corner minus a fixed margin"
// convention bandit's own top-bar HUD uses (see EconomyUI.ts/UIService.ts:
// `screen.topRight.x - panelWidth - MARGIN`, MARGIN = 16), added directly to the game's
// uiLayer rather than nested under the scene. No nine-slice button art exists in this
// controller's own asset set, so the button uses PIXI.Texture.WHITE + tint — the same
// placeholder convention bandit itself falls back to wherever it has no button art yet
// (see UIService.ts's own doc on this).
//
// The top-left money pill used to live here too, but it's SHARED across every scene now —
// see MoneyHud.ts's own doc for why that one had to move out to index.ts instead of being
// rebuilt (and its running total visibly reset) every time this, a hub-only UI, gets
// destroyed and rebuilt on a scene change.

import * as PIXI from 'pixi.js';
import { Game } from 'core/Game';
import BaseButton from 'core/ui/BaseButton';

const MARGIN = 16;
const BUTTON_WIDTH = 140;
const BUTTON_HEIGHT = 44;
/** Vertical gap between stacked top-right buttons (Reset, then the minigame quick-launch buttons). */
const BUTTON_STACK_GAP = 10;

export default class GameUI extends PIXI.Container {
    private readonly resetButton: BaseButton;
    private readonly playRunnerButton: BaseButton;
    private readonly playSwipeButton: BaseButton;

    public constructor(onReset: () => void, onPlayRunner: () => void, onPlaySwipe: () => void) {
        super();

        this.resetButton = new BaseButton({
            standard: {
                texture: PIXI.Texture.WHITE,
                tint: 0x3a4a6b,
                width: BUTTON_WIDTH,
                height: BUTTON_HEIGHT,
                fontStyle: new PIXI.TextStyle({ fontSize: 20, fontWeight: 'bold', fill: 0xffffff }),
                fontColor: 0xffffff,
                fitText: 0.8,
            },
            over: { tint: 0x4d5f89 },
            down: { tint: 0x2a3654 },
            click: { tint: 0x2a3654, callback: onReset },
        }, new PIXI.Point(0, 0));
        this.resetButton.setLabel('Reset');

        this.playRunnerButton = this.buildMinigameButton('Runner', 0x2f6b3a, 0x3d8a4b, onPlayRunner);
        this.playSwipeButton = this.buildMinigameButton('Swipe', 0x8a5a1f, 0xb0782c, onPlaySwipe);

        this.addChild(this.resetButton, this.playRunnerButton, this.playSwipeButton);
        this.reposition();
    }

    /** Same placeholder-tint BaseButton shape as resetButton (see this file's own doc on why — no nine-slice art in this project's own asset set), just its own color per minigame so the two quick-launch buttons read as distinct from Reset and from each other. */
    private buildMinigameButton(label: string, tint: number, overTint: number, onClick: () => void): BaseButton {
        const button = new BaseButton({
            standard: {
                texture: PIXI.Texture.WHITE,
                tint,
                width: BUTTON_WIDTH,
                height: BUTTON_HEIGHT,
                fontStyle: new PIXI.TextStyle({ fontSize: 18, fontWeight: 'bold', fill: 0xffffff }),
                fontColor: 0xffffff,
                fitText: 0.8,
            },
            over: { tint: overTint },
            down: { tint },
            click: { tint, callback: onClick },
        }, new PIXI.Point(0, 0));
        button.setLabel(label);
        return button;
    }

    /** Call whenever the viewport resizes (see HubScene.resize()) — keeps the button stack pinned to its corner. */
    public reposition(): void {
        const screen = Game.overlayScreenData;
        if (!screen) {
            return;
        }
        const buttonX = screen.topRight.x - BUTTON_WIDTH - MARGIN;
        this.resetButton.position.set(buttonX, screen.topRight.y + MARGIN);
        this.playRunnerButton.position.set(buttonX, this.resetButton.position.y + BUTTON_HEIGHT + BUTTON_STACK_GAP);
        this.playSwipeButton.position.set(buttonX, this.playRunnerButton.position.y + BUTTON_HEIGHT + BUTTON_STACK_GAP);
    }
}
