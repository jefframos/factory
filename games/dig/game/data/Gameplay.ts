// Gameplay.ts
//
// The platform's gameplay events (YouTube Playables, CrazyGames, Poki…): gameplayStart() on the player's first input,
// gameplayStop() while a menu that stops play is open (achievements, settings), gameplayStart() again on the next move
// (DigScene / DigHud). Each event is sent once per change, never twice in a row.

import PlatformHandler from 'core/platforms/PlatformHandler';

let active = false;
let started = false;

export const Gameplay = {
    get active(): boolean {
        return active;
    },

    /** The player has played at least once (their first input happened). */
    get started(): boolean {
        return started;
    },

    start(): void {
        if (active) return;
        active = true;
        started = true;
        PlatformHandler.instance.isGameplayActive = true;
        void PlatformHandler.instance.platform.gameplayStart();
    },

    stop(): void {
        if (!active) return;
        active = false;
        PlatformHandler.instance.isGameplayActive = false;
        void PlatformHandler.instance.platform.gameplayStop();
    },
};
