// TowerGameOverHeartbeat.ts

import SoundManager from 'core/audio/SoundManager';
import type { SoundAsset } from 'core/audio/SoundManager';
import Assets from '../Assets';

/** Seconds between each beat — see update(). */
const BEAT_INTERVAL = 1;

/**
 * Audio counterpart to TowerGameOverSiren3D — plays
 * Assets.Sounds.Game.Heartbeat once per second while the game-over warning
 * countdown is up, ramping its volume/pitch from that asset's own
 * volumeMinMax[0]/pitchMinMax[0] (right as the warning starts) up to [1]
 * (right as it's about to end) as `secondsRemaining` counts down — a
 * quickening, intensifying heartbeat calling the player's attention back to
 * the screen. Tune the ramp directly on Assets.Sounds.Game.Heartbeat, not
 * here.
 */
export class TowerGameOverHeartbeat {
    private timer = 0;
    private wasActive = false;

    /**
     * Call every frame — `secondsRemaining` mirrors
     * FaceTowerGameController.getGameOverWarningSecondsRemaining() (undefined
     * whenever the warning isn't up); `graceDuration` is its own
     * FaceTowerConfig.gameOverGraceDuration, needed to turn `secondsRemaining`
     * into a 0 (just started) .. 1 (about to end) ramp progress.
     */
    public update(secondsRemaining: number | undefined, graceDuration: number, delta: number): void {
        if (secondsRemaining === undefined) {
            this.wasActive = false;
            this.timer = 0;
            return;
        }

        // Beats immediately the instant the warning starts (rather than
        // waiting a full BEAT_INTERVAL before the very first beat), then
        // every BEAT_INTERVAL seconds after.
        if (!this.wasActive) {
            this.wasActive = true;
            this.timer = BEAT_INTERVAL;
        }

        this.timer -= delta;

        if (this.timer > 0) {
            return;
        }

        this.timer += BEAT_INTERVAL;
        this.playBeat(secondsRemaining, graceDuration);
    }

    private playBeat(secondsRemaining: number, graceDuration: number): void {
        const heartbeat = Assets.Sounds.Game.Heartbeat;

        // 0 right as the warning starts, 1 the instant it reaches game over.
        const progress = graceDuration > 0
            ? 1 - Math.max(0, Math.min(1, secondsRemaining / graceDuration))
            : 1;

        SoundManager.instance.tryToPlaySound({
            soundId: heartbeat.soundId,
            volumeMinMax: TowerGameOverHeartbeat.lerpRange(heartbeat.volumeMinMax, progress),
            pitchMinMax: TowerGameOverHeartbeat.lerpRange(heartbeat.pitchMinMax, progress),
        });
    }

    /** [start, end] -> lerp(start, end, t) — a plain (non-ranged) number passes through unchanged at every t. */
    private static lerpRange(range: SoundAsset['volumeMinMax'], t: number): number | undefined {
        if (range === undefined) {
            return undefined;
        }

        if (typeof range === 'number') {
            return range;
        }

        return range[0] + (range[1] - range[0]) * t;
    }
}
