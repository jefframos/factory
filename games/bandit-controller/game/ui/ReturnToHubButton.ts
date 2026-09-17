// ReturnToHubButton.ts
//
// The one "Return to Hub" button both minigame scenes (RunnerMinigameScene,
// SwipeMinigameScene) need — top-right, dispatches the scene's own
// onComplete, the EXACT same Signal a normal finish-line/timeout already
// uses (see index.ts's own doc on why a scene never touches SceneManager
// directly) — this is a dev/testing shortcut for that same transition, not
// a second way back to the hub. Same placeholder BaseButton shape as
// GameUI's own buttons (no nine-slice art in this project's own asset set).

import * as PIXI from 'pixi.js';
import { Game } from 'core/Game';
import BaseButton from 'core/ui/BaseButton';

const MARGIN = 16;
const BUTTON_WIDTH = 160;
const BUTTON_HEIGHT = 44;

export default class ReturnToHubButton {
    private readonly button: BaseButton;

    public constructor(game: Game, onClick: () => void) {
        this.button = new BaseButton({
            standard: {
                texture: PIXI.Texture.WHITE,
                tint: 0x6b2f3a,
                width: BUTTON_WIDTH,
                height: BUTTON_HEIGHT,
                fontStyle: new PIXI.TextStyle({ fontSize: 18, fontWeight: 'bold', fill: 0xffffff }),
                fontColor: 0xffffff,
                fitText: 0.8,
            },
            over: { tint: 0x8a3d4b },
            down: { tint: 0x6b2f3a },
            click: { tint: 0x6b2f3a, callback: onClick },
        }, new PIXI.Point(0, 0));
        this.button.setLabel('Return to Hub');

        game.uiLayer.addChild(this.button);
        this.reposition();
    }

    /** Call whenever the viewport resizes (see RunnerMinigameScene/SwipeMinigameScene's own resize()) — keeps the button pinned to its corner. */
    public reposition(): void {
        const screen = Game.overlayScreenData;
        if (!screen) {
            return;
        }
        this.button.position.set(screen.topRight.x - BUTTON_WIDTH - MARGIN, screen.topRight.y + MARGIN);
    }

    public destroy(): void {
        this.button.destroy();
    }
}
