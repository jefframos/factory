// GameAnalytics.ts
//
// Every analytics event Mow Town sends — one place, so names stay stable across versions. Goes through
// PlatformHandler.measure() (Poki: PokiSDK.measure(); the mock platform logs them). Values are ids, not display text.
//
//   category     what                         action     when
//   session      new | returning              start      the player's first input this session
//   playtime     min-<n>                      reached    n minutes of active play this session
//   tutorial     <nn>-<step>                  complete   each first-session step, once per player, in order
//   tool         <nn>-<toolId>                complete   a tool / mower bought
//   upgrade      <upgradeId>-<nn>             complete   an upgrade level bought
//   sell         count-<n>                    complete   the nth sale, for the first 10
//   bag          full                         complete   the container fills up (once a session)
//   district     <districtId>                 complete   a district restored
//   settings     lang-<code>                  interact   a language picked
//
// Add an event here (and to the table) rather than calling PlatformHandler.measure() directly.

import PlatformHandler from 'core/platforms/PlatformHandler';
import { MowProgress } from '../data/MowProgress';

/** The first-session steps, in order (the GDD's first five minutes). */
export const TUTORIAL = ['move', 'cut', 'bag-full', 'sell', 'first-mower', 'first-upgrade', 'park-restored'] as const;
export type TutorialStep = (typeof TUTORIAL)[number];

const PLAYTIME_MINUTES = [1, 2, 3, 5, 8, 12, 20, 30];

function send(category: string, what: string | number, action: string): void {
    PlatformHandler.instance.measure(category, what, action);
}

const pad = (n: number) => String(n).padStart(2, '0');
let playSeconds = 0;
let nextMinute = 0;
let fullSent = false;

export const GameAnalytics = {
    sessionStart(newGame: boolean): void {
        send('session', newGame ? 'new' : 'returning', 'start');
    },

    /** Active play time (call every frame while gameplay is active). */
    playTime(delta: number): void {
        playSeconds += delta;
        while (nextMinute < PLAYTIME_MINUTES.length && playSeconds >= PLAYTIME_MINUTES[nextMinute] * 60) {
            send('playtime', `min-${PLAYTIME_MINUTES[nextMinute]}`, 'reached');
            nextMinute++;
        }
    },

    /** A first-session step done: sent once per player. */
    tutorialStep(step: TutorialStep): void {
        if (!MowProgress.once(`tutorial-${step}`)) return;
        send('tutorial', `${pad(TUTORIAL.indexOf(step) + 1)}-${step}`, 'complete');
    },

    toolBought(level: number, toolId: string): void {
        send('tool', `${pad(level)}-${toolId}`, 'complete');
    },

    upgradeBought(upgradeId: string, level: number): void {
        send('upgrade', `${upgradeId}-${pad(level)}`, 'complete');
    },

    sold(count: number): void {
        if (count <= 10) send('sell', `count-${count}`, 'complete');
    },

    bagFull(): void {
        if (fullSent) return;
        fullSent = true;
        send('bag', 'full', 'complete');
    },

    districtRestored(districtId: string): void {
        send('district', districtId, 'complete');
    },

    languagePicked(code: string): void {
        send('settings', `lang-${code}`, 'interact');
    },
};
