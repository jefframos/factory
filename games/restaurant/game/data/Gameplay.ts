// Gameplay.ts
//
// Telling the platform when the player is playing (gameplayStart / gameplayStop: Poki times its ads by it, and expects
// a start only after the player's done something). So: gameplay starts on the player's first tap in a screen (arm()
// waits for it — the game's opening, each new screen), and stops when a transition covers the screen (stop()).

import PlatformHandler from 'core/platforms/PlatformHandler';

let playing = false;
let armed = false;

const onTap = (): void => {
    window.removeEventListener('pointerdown', onTap, true);
    armed = false;
    Gameplay.start();
};

export const Gameplay = {
    get playing(): boolean {
        return playing;
    },

    /** Gameplay on (once till it's stopped). */
    start(): void {
        if (playing) return;
        playing = true;
        void PlatformHandler.instance.platform?.gameplayStart()?.catch(() => undefined);
    },

    /** Gameplay off (a transition covers the screen); the next start waits for a tap (arm()). */
    stop(): void {
        if (!playing) return;
        playing = false;
        void PlatformHandler.instance.platform?.gameplayStop()?.catch(() => undefined);
    },

    /** Gameplay starts on the player's next tap (a new screen: it resumes once they're playing it). */
    arm(): void {
        if (playing || armed) return;
        armed = true;
        window.addEventListener('pointerdown', onTap, true);
    },
};
