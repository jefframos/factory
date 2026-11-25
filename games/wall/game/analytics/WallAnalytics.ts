// WallAnalytics.ts
//
// Every event the game sends, in one place (PlatformHandler.measure(): Poki's exports name one category-what-action, so what
// belongs together shares its beginning and sorts together; numbers are two figures, so they sort in order).
//
// PROGRESSION (start / complete only: Poki's progress export, which also gives the time each took and where players leave)
//   category   what                     action             when
//   session    new | returning          start              the first click this session (everything else comes after it)
//   mode       enemies | plain          start              with it: played with enemies and bosses, or without
//   step       <nn>-<name>              start, complete    the first minutes' funnel: it's the next one (the furthest done +
//                                                          1; again each session: a retry), it's done (once per player)
//   wall       <nn>                     start, complete    a wall reached for the first time ever (start again each session
//                                                          it's still that one), and down
//   run        <nn>                     start, complete    from wall 1 to a rewind (01: the first)
//   boss       <nn>                     start, complete, fail   wall nn's boss: each try begins (again if it's reloaded), and ends
//                                                          beaten, or out of time or rewound away from
//   minions    <nn>                     start, complete, fail   wall nn's minions (fail: rewound away from)
//
// ITEMS (one category for each family; the action says how it was got or what was done with it)
//   punch      lv-<nn>                  gift, bought       a PUNCH HARDER level (given: lv-01, and lv-02 to 05 at
//                                                          walls 4, 6, 8, 10 if they hadn't been bought)
//   tool       <nn>-<tier>-<type>       unlocked, equip    a new tool (nn: the level it comes with), one picked
//   crew       <n>-<id>-<nn>            gift, bought       the 1st, 5th, 10th, 25th... of one of the crew (once per player)
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
// (From the build where the first PUNCH HARDER and the first chick are given, steps 03 and 05 do themselves: 18 bought-punch
// and 19 bought-helper are the first ones really bought.)
// The steps' numbers are their place here: new ones go on the end once this has been released.

import PlatformHandler from 'core/platforms/PlatformHandler';
import type { AnalyticsAction } from 'core/platforms/PlatformHandler';
import { CREW, enemiesOn } from '../data/WallConfig';
import { WallProgress } from '../data/WallProgress';

const STEPS = [
    'first-hit', 'wall-01', 'punch-harder', 'wall-02', 'first-helper', 'wall-03', 'first-boost', 'wall-04', 'weak-spot', 'wall-05', 'wall-06', 'first-medal', 'wall-07',
    'wall-08', 'wall-10', 'wall-12', 'rewind',
] as const;
/** Added since: numbered on from those, started as they're done (they've no place in the order). */
const EXTRA = ['bought-punch', 'bought-helper'] as const;
export type Step = (typeof STEPS)[number] | (typeof EXTRA)[number];

/** How a look was got, or what was done with it. */
export type LookAction = 'bought' | 'unlocked' | 'gift' | 'no-video' | 'equip';

const COUNTS = [1, 5, 10, 25, 50, 100];
const two = (n: number) => String(n).padStart(2, '0');
const ALL: readonly Step[] = [...STEPS, ...EXTRA];
const stepName = (index: number) => `${two(index + 1)}-${ALL[index]}`;
let seconds = 0;
let comboBest = 2;
let begun = false;
/** What happened before the first click (a gift handed out as it loads, a button seen): sent right after the session's start. */
const early: [string, string, AnalyticsAction][] = [];

function send(category: string, what: string, action: AnalyticsAction): void {
    if (begun) PlatformHandler.instance.measure(category, what, action);
    else early.push([category, what, action]);
}

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

    /** The first click this session (gameplay's start). */
    begin(): void {
        if (begun) return;
        begun = true;
        send('session', WallProgress.played ? 'returning' : 'new', 'start');
        send('mode', enemiesOn ? 'enemies' : 'plain', 'start');
        WallProgress.markPlayed();
        if (once('run-01')) send('run', '01', 'start');
        this.wallStart(WallProgress.wall);
        nextStep();
        early.splice(0).forEach((event) => send(...event));
    },

    step(step: Step): void {
        if (!once(step)) return;
        const index = ALL.indexOf(step);
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
        if (ALL.includes(step)) this.step(step);
    },

    /** A fight behind a wall. */
    fight(kind: 'boss' | 'minions', number: number, action: 'start' | 'complete' | 'fail'): void {
        send(kind, two(number), action);
    },

    /** Rewound, for the nth time: that run's over, the next begins. */
    rewind(times: number): void {
        send('run', two(times), 'complete');
        send('run', two(times + 1), 'start');
        this.step('rewind');
    },

    // ---------------------------------------------------------------- items

    /** `given`: it was free. */
    punch(level: number, given = false): void {
        send('punch', `lv-${two(level)}`, given ? 'gift' : 'bought');
        this.step('punch-harder');
        if (!given) this.step('bought-punch');
    },

    tool(level: number, id: string): void {
        send('tool', `${two(level)}-${id}`, 'unlocked');
    },

    holdTool(level: number, id: string): void {
        send('tool', `${two(level)}-${id}`, 'equip');
    },

    /** `given`: it was free. */
    hire(id: string, count: number, given = false): void {
        this.step('first-helper');
        if (!given) this.step('bought-helper');
        if (!COUNTS.includes(count)) return;
        const place = CREW.findIndex((def) => def.id === id) + 1;
        if (once(`crew-${id}-${count}`)) send('crew', `${place}-${id}-${two(count)}`, given ? 'gift' : 'bought');
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
