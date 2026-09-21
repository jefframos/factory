// RestartButton.ts
//
// The "Restart" button shown once the player's been hit (see RunnerMinigameScene/
// SwipeMinigameScene's own onHitObstacle()) — dispatches the scene's own onRestart Signal,
// which index.ts wires to a FORCED same-key scene change (see SceneManager.changeScene()'s
// own doc), replaying the SAME minigame from scratch instead of round-tripping through the
// hub the way ReturnToHubButton's own onComplete does. Only constructed on hit (not built
// up front like ReturnToHubButton), so it's never visible while the run is still live.
//
// Centered, below where a HUD timer/label might sit, so it reads as the primary "try again"
// call-to-action rather than a corner utility button.

import * as PIXI from 'pixi.js';
import { Game } from 'core/Game';
import BaseButton from 'core/ui/BaseButton';

const BUTTON_WIDTH = 200;
const BUTTON_HEIGHT = 52;
/** CSS pixels below screen center the button sits at, so it doesn't cover the player/obstacle right where the hit just happened. */
const CENTER_Y_OFFSET = 80;

export default class RestartButton {
    private readonly button: BaseButton;

    public constructor(game: Game, onClick: () => void) {
        this.button = new BaseButton({
            standard: {
                texture: PIXI.Texture.WHITE,
                tint: 0x2f6b3a,
                width: BUTTON_WIDTH,
                height: BUTTON_HEIGHT,
                fontStyle: new PIXI.TextStyle({ fontSize: 22, fontWeight: 'bold', fill: 0xffffff }),
                fontColor: 0xffffff,
                fitText: 0.8,
            },
            over: { tint: 0x3d8a4b },
            down: { tint: 0x2f6b3a },
            click: { tint: 0x2f6b3a, callback: onClick },
        }, new PIXI.Point(0, 0));
        this.button.setLabel('Restart');

        game.uiLayer.addChild(this.button);
        this.reposition();
    }

    /** Call whenever the viewport resizes — keeps the button pinned to screen center. */
    public reposition(): void {
        const screen = Game.overlayScreenData;
        if (!screen) {
            return;
        }
        this.button.position.set(screen.center.x - BUTTON_WIDTH / 2, screen.center.y - BUTTON_HEIGHT / 2 + CENTER_Y_OFFSET);
    }

    public destroy(): void {
        this.button.destroy();
    }
}
