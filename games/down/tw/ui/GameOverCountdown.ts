// GameOverCountdown.ts

import * as PIXI from 'pixi.js';
import SoundManager from 'core/audio/SoundManager';
import Assets from '../../Assets';

/**
 * Big centered "10", "9", ... "1" countdown shown while the pile sits
 * (settled) at/above the game-over line — see FaceTowerGameController.
 * getGameOverWarningSecondsRemaining(), which returns undefined the moment
 * nothing's over the line any more (see updateGameOverLine()'s own reset
 * rule: it only resets once EVERY settled block clears the line, not just
 * because a different piece became "the top" — so this countdown likewise
 * only restarts from a fresh 10 once the pile has fully cleared the line at
 * least one frame, never mid-warning just because another piece also
 * crossed it).
 */
export class GameOverCountdown extends PIXI.Container {
    private readonly label: PIXI.Text;
    /** Last digit actually shown — see update()'s own Tapped-sound trigger. Undefined while hidden. */
    private lastValue: number | undefined;

    public constructor() {
        super();

        this.label = new PIXI.Text('', Assets.TextStyles.DangerLabel);
        this.label.anchor.set(0.5);
        this.addChild(this.label);

        this.visible = false;
    }

    /** `secondsRemaining` — see FaceTowerGameController.getGameOverWarningSecondsRemaining(); undefined hides this entirely. */
    public update(secondsRemaining: number | undefined): void {
        this.visible = secondsRemaining !== undefined;

        if (secondsRemaining === undefined) {
            this.lastValue = undefined;
            return;
        }

        // Ceil (not round/floor) so the very first frame the warning
        // starts reads as a clean "10", not an instant "9" — and clamped to
        // at least 1 so it never flashes a bare "0" right before gameOver()
        // actually fires.
        const value = Math.max(1, Math.ceil(secondsRemaining));

        // Plays exactly once per digit change (not every frame this stays
        // the same "10") — including the very first one, since lastValue
        // starts undefined whenever the countdown was just hidden.
        if (value !== this.lastValue) {
            this.lastValue = value;
            SoundManager.instance.tryToPlaySound(Assets.Sounds.Game.Tapped);
        }

        this.label.text = String(value);
    }

    public override destroy(options?: boolean | PIXI.IDestroyOptions): void {
        super.destroy(options ?? { children: true });
    }
}
