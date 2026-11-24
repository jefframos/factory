// WallAnalytics.ts
//
// Every event the game sends, in one place (PlatformHandler.measure(): Poki's exports name one category-what-action, so what
// belongs together shares its beginning and sorts together; numbers are two figures, so they sort in order).
//
// PROGRESSION (start / complete only: Poki's progress export, which also gives the time each took and where players leave)
//   category   what                     action             when
//   session    new | returning          start              the first hit this session
//   step       <nn>-<name>              start, complete    the first minutes' funnel: it's the next one (the furthest done +
//                                                          1; again each session: a retry), it's done (once per player)
//   wall       <nn>                     start, complete    a wall reached for the first time ever (start again each session
//                                                          it's still that one), and down
//   run        <nn>                     start, complete    from wall 1 to a rewind (01: the first)
//
// ITEMS (one category for each family; the action says how it was got or what was done with it)
//   punch      lv-<nn>                  gift, bought       a PUNCH HARDER level (lv-01: the gift)
//   tool       <nn>-<tier>-<type>       unlocked, equip    a new tool (nn: the level it comes with), one picked
//   crew       <n>-<id>-<nn>            bought             the 1st, 5th, 10th, 25th... of one of the crew (once per player)
//   boost      <id>                     bought
//   look       <slot>-<id>              bought, unlocked, gift, no-video, equip   for cash, for a video, for nothing, its
//                                                          video not watched, an owned one put on (wardrobe and offers alike)
//
// OFFERS AND BUTTONS (visible / interact pairs)
//   offer      <gift|buy|video>-<slot>-<id>   visible, interact   a card while playing (what came of it: `look`)
//   button     wardrobe | rewind        visible, interact  there (once a session), tapped
//   panel      wardrobe-<tab> | rewind-ready | rewind-early   visible   shown (once a session)
//
// THE REST
//   playtime   min-<nn>                 reached            minutes of play this session (only while gameplay's on)
//   combo      <nn>                     reached            a longer one than any this session (3 and up)
//
// The steps' numbers are their place here: new ones go on the end once this has been released.

import PlatformHandler from 'core/platforms/PlatformHandler';
import type { AnalyticsAction } from 'core/platforms/PlatformHandler';
import { CREW } from '../data/WallConfig';
import { WallProgress } from '../data/WallProgress';

const STEPS = [
    'first-hit', 'wall-01', 'punch-harder', 'wall-02', 'first-helper', 'wall-03', 'first-boost', 'wall-04', 'weak-spot', 'wall-05', 'wall-06', 'first-medal', 'wall-07',
    'wall-08', 'wall-10', 'wall-12', 'rewind',
] as const;
export type Step = (typeof STEPS)[number];

/** How a look was got, or what was done with it. */
export type LookAction = 'bought' | 'unlocked' | 'gift' | 'no-video' | 'equip';

const COUNTS = [1, 5, 10, 25, 50, 100];
const two = (n: number) => String(n).padStart(2, '0');
const stepName = (index: number) => `${two(index + 1)}-${STEPS[index]}`;
const send = (category: string, what: string, action: AnalyticsAction) => PlatformHandler.instance.measure(category, what, action);
let seconds = 0;
let comboBest = 2;
let begun = false;
/** Shown already this session, and the steps started. */
const seen = new Set<string>();
const startedStep = new Set<number>();

/** Once per player. */
const once = (key: string) => WallProgress.markStep(key);

function shownOnce(category: string, what: string): void {
    const key = `${category}-${what}`;
    if (seen.has(key)) return;
    seen.add(key);
    send(category, what, 'visible');
}

/** (Once a session each.) */
function stepStart(index: number): void {
    if (startedStep.has(index)) return;
    startedStep.add(index);
    send('step', stepName(index), 'start');
}

/** The step after the furthest done starts. */
function nextStep(): void {
    let furthest = -1;
    STEPS.forEach((step, i) => {
        if (WallProgress.stepDone(step)) furthest = i;
    });
    if (furthest + 1 < STEPS.length) stepStart(furthest + 1);
}

export const WallAnalytics = {
    // ---------------------------------------------------------------- progression

    /** The first hit this session. */
    begin(): void {
        if (begun) return;
        begun = true;
        send('session', WallProgress.played ? 'returning' : 'new', 'start');
        WallProgress.markPlayed();
        if (once('run-01')) send('run', '01', 'start');
        this.wallStart(WallProgress.wall);
        nextStep();
        this.step('first-hit');
    },

    step(step: Step): void {
        if (!once(step)) return;
        const index = STEPS.indexOf(step);
        // (Done out of order: its start first, so each complete has one.)
        stepStart(index);
        send('step', stepName(index), 'complete');
        nextStep();
    },

    /** A wall's there to be hit: counted if it's never been down. */
    wallStart(number: number): void {
        if (!begun || WallProgress.stepDone(`down-${number}`)) return;
        send('wall', two(number), 'start');
    },

    wallDown(number: number): void {
        if (once(`down-${number}`)) send('wall', two(number), 'complete');
        const step = `wall-${two(number)}` as Step;
        if (STEPS.includes(step)) this.step(step);
    },

    /** Rewound, for the nth time: that run's over, the next begins. */
    rewind(times: number): void {
        send('run', two(times), 'complete');
        send('run', two(times + 1), 'start');
        this.step('rewind');
    },

    // ---------------------------------------------------------------- items

    punch(level: number): void {
        send('punch', `lv-${two(level)}`, level === 1 ? 'gift' : 'bought');
        this.step('punch-harder');
    },

    tool(level: number, id: string): void {
        send('tool', `${two(level)}-${id}`, 'unlocked');
    },

    holdTool(level: number, id: string): void {
        send('tool', `${two(level)}-${id}`, 'equip');
    },

    hire(id: string, count: number): void {
        this.step('first-helper');
        if (!COUNTS.includes(count)) return;
        const place = CREW.findIndex((def) => def.id === id) + 1;
        if (once(`crew-${id}-${count}`)) send('crew', `${place}-${id}-${two(count)}`, 'bought');
    },

    boost(id: string): void {
        this.step('first-boost');
        send('boost', id, 'bought');
    },

    look(slot: string, id: string, action: LookAction): void {
        send('look', `${slot}-${id}`, action);
    },

    // ---------------------------------------------------------------- offers and buttons

    offer(kind: string, slot: string, id: string, action: 'visible' | 'interact'): void {
        send('offer', `${kind}-${slot}-${id}`, action);
    },

    /** A button's there. */
    buttonShown(what: 'wardrobe' | 'rewind'): void {
        shownOnce('button', what);
    },

    buttonTapped(what: 'wardrobe' | 'rewind'): void {
        send('button', what, 'interact');
    },

    panel(what: string): void {
        shownOnce('panel', what);
    },

    // ---------------------------------------------------------------- the rest

    combo(step: number): void {
        if (step <= comboBest) return;
        comboBest = step;
        send('combo', two(step), 'reached');
    },

    /** Played time (a frame's seconds, while gameplay's on). */
    played(delta: number): void {
        if (!begun) return;
        const before = Math.floor(seconds / 60);
        seconds += delta;
        const minutes = Math.floor(seconds / 60);
        if (minutes > before) send('playtime', `min-${two(minutes)}`, 'reached');
    },
};
