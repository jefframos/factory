// GameUI.ts
//
// The whole 2D UI this controller demo needs: one button, top-right,
// resetting the player back to spawn. Positioned against
// Game.overlayScreenData.topRight — the same "screen corner minus a fixed
// margin" convention bandit's own top-bar HUD uses for its currency
// container (see EconomyUI.ts/UIService.ts: `screen.topRight.x -
// panelWidth - MARGIN`, MARGIN = 16), added directly to the game's uiLayer
// rather than nested under the scene. No nine-slice button art exists in
// this controller's own asset set, so the button uses PIXI.Texture.WHITE +
// tint — the same placeholder convention bandit itself falls back to
// wherever it has no button art yet (see UIService.ts's own doc on this).

import * as PIXI from 'pixi.js';
import { Game } from 'core/Game';
import BaseButton from 'core/ui/BaseButton';

const MARGIN = 16;
const BUTTON_WIDTH = 140;
const BUTTON_HEIGHT = 44;

export default class GameUI extends PIXI.Container {
    private readonly resetButton: BaseButton;

    public constructor(onReset: () => void) {
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

        this.addChild(this.resetButton);
        this.reposition();
    }

    /** Call whenever the viewport resizes (see ControllerScene.resize()) — keeps the button pinned to the top-right corner. */
    public reposition(): void {
        const screen = Game.overlayScreenData;
        if (!screen) {
            return;
        }
        this.resetButton.position.set(screen.topRight.x - BUTTON_WIDTH - MARGIN, screen.topRight.y + MARGIN);
    }
}
