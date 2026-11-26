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
// ITEMS (one category for each family; the action says how it was got or what was done with it; a level, a tool, a number of the
// crew: once per player, the first time ever, so counts are players)
//   punch      lv-<nn>                  gift, bought       a PUNCH HARDER level (gift: given at its wall, or bought for who
//                                                          leaves their money lying)
//   tool       <nn>-<tier>-<type>       unlocked, equip    a new tool (nn: the level it comes with), one picked
//   crew       <n>-<id>-<nn>            gift, bought       the 1st, 5th, 10th, 25th... of one of the crew (once per player)
//   boost      <id>                     bought
//   look       <slot>-<id>              bought, unlocked, gift, no-video, equip   for cash, for a video, for nothing, its
//                                                          video not watched, an owned one put on (wardrobe and offers alike)
//
// OFFERS AND BUTTONS (visible / interact pairs; marked * once a session each: interact over visible is the share that took it)
//   offer      <gift|buy|video>-<slot>-<id>   visible, interact   a card while playing (what came of it: `look`)
//   floating   cash | frenzy *          visible, interact  one drifted across, was tapped
//   floating   chest | double           visible, interact, no-video   each one, for a video; tapped; its video not watched
//   nudge      boost | punch | crew *   visible, bought    the hand pointed at something left unbought, and it was bought
//   power      hands | auto             visible, used, video, no-video   its button there (once a session), set off charged, for a
//                                                          video, its video not watched
//   away       earned                   gift               back after a while: what the crew earned
//   button     wardrobe | rewind *      visible, interact  there, tapped
//   panel      wardrobe-<tab> | rewind-ready | rewind-early *   visible   shown
//
// THE REST
//   playtime   min-<nn>                 reached            minutes of play this session (only while gameplay's on)
//   combo      <nn>                     reached            a longer one than any this session (3 and up)
//   load       <under-3|3-5|5-8|8-15|over-15>-<touch|desktop>   reached   how long to the first screen (seconds)
//   fps        <under30|30to45|45to55|55plus>-<touch|desktop>   complete  the frame rate between 10 and 40 s of play
//   fps-min    <nn>-<speed>-<touch|desktop>   reached      with each playtime mark: how fast that device draws
//   resolution <percent>-<touch|desktop>     complete      the 3D's, if it was lowered (with fps)
//
// (From the build where the first PUNCH HARDER and the first chick are given, steps 03 and 05 do themselves: 18 bought-punch
// and 19 bought-helper are the first ones really bought.)
// Nothing can flood it: but for PROGRESSION, an event goes out at most once a second and 20 times a session (send()).
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
const EXTRA = ['bought-punch', 'bought-helper', 'first-power', 'first-fight', 'first-boss', 'first-hold'] as const;
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
let deviceSpeed = '';
const touch = () => (window.matchMedia?.('(pointer: coarse)').matches ? 'touch' : 'desktop');
/** What happened before the first click (a gift handed out as it loads, a button seen): sent right after the session's start. */
const early: [string, string, AnalyticsAction][] = [];

/** PROGRESSION: always sent (each start has its end). Everything else: never twice within a moment, and at most so often a session. */
const PROGRESSION = ['session', 'mode', 'step', 'wall', 'run', 'boss', 'minions'];
const GUARD = { apartMs: 1000, most: 20 };
const sent = new Map<string, { at: number; times: number; told?: boolean }>();

/** Whether it's one too many (told in the console, once: something's calling it over and over). */
function tooMany(event: string): boolean {
    const now = performance.now();
    const before = sent.get(event);
    if (before && (now - before.at < GUARD.apartMs || before.times >= GUARD.most)) {
        if (!before.told) console.warn(`[WallAnalytics] ${event}: too often, not sent`);
        before.told = true;
        before.at = now;
        return true;
    }
    sent.set(event, { at: now, times: (before?.times ?? 0) + 1 });
    return false;
}

function send(category: string, what: string, action: AnalyticsAction): void {
    if (!PROGRESSION.includes(category) && tooMany(`${category} ${what} ${action}`)) return;
    if (begun) PlatformHandler.instance.measure(category, what, action);
    else early.push([category, what, action]);
}

/** Shown already this session, and the steps started. */
const seen = new Set<string>();
const startedStep = new Set<number>();

/** Once per player. */
const once = (key: string) => WallProgress.markStep(key);

/** Once a session. */
function sendOnce(category: string, what: string, action: AnalyticsAction): void {
    const key = `${category}-${what}-${action}`;
    if (seen.has(key)) return;
    seen.add(key);
    send(category, what, action);
}

const shownOnce = (category: string, what: string) => sendOnce(category, what, 'visible');

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
        early.splice(0).forEach((event) => PlatformHandler.instance.measure(...event));
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
        if (once(`punch-${level}`)) send('punch', `lv-${two(level)}`, given ? 'gift' : 'bought');
        this.step('punch-harder');
        if (!given) this.step('bought-punch');
    },

    tool(level: number, id: string): void {
        if (once(`tool-${id}`)) send('tool', `${two(level)}-${id}`, 'unlocked');
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

    /** A shop product: bought, or the store's window closed without. */
    shop(id: string, action: 'bought' | 'cancelled'): void {
        send('shop', id, action);
    },

    /** A relic's level bought with medals. */
    relic(id: string, level: number): void {
        send('relic', id, `level-${level}`);
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

    floater(kind: string, action: 'visible' | 'interact' | 'no-video'): void {
        // (For a video: each one. The others: whether they saw one this session, and took one.)
        if (kind === 'chest' || kind === 'double') send('floating', kind, action);
        else sendOnce('floating', kind, action);
    },

    powerShown(id: string): void {
        shownOnce('power', id);
    },
    power(id: string, how: 'used' | 'video' | 'no-video'): void {
        if (how !== 'no-video') this.step('first-power');
        send('power', id, how);
    },

    nudge(what: string, action: 'visible' | 'bought'): void {
        // (Once a session each: seen, bought.)
        sendOnce('nudge', what, action);
    },

    /** The first screen's up, after so many seconds. */
    loaded(after: number): void {
        const group = after < 3 ? 'under-3' : after < 5 ? '3-5' : after < 8 ? '5-8' : after < 15 ? '8-15' : 'over-15';
        send('load', `${group}-${touch()}`, 'reached');
    },

    /** How it runs (once a session), and the 3D's resolution if it was lowered. */
    performance(fps: number, resolution: number): void {
        deviceSpeed = `${fps < 30 ? 'under30' : fps < 45 ? '30to45' : fps < 55 ? '45to55' : '55plus'}-${touch()}`;
        send('fps', deviceSpeed, 'complete');
        if (resolution < 1) send('resolution', `${Math.round(resolution * 100)}-${touch()}`, 'complete');
    },

    away(): void {
        send('away', 'earned', 'gift');
    },

    /** A button's there. */
    buttonShown(what: 'wardrobe' | 'rewind' | 'relics' | 'hold' | 'shop'): void {
        shownOnce('button', what);
    },

    buttonTapped(what: 'wardrobe' | 'rewind' | 'relics' | 'shop'): void {
        sendOnce('button', what, 'interact');
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
        if (minutes <= before) return;
        send('playtime', `min-${two(minutes)}`, 'reached');
        if (deviceSpeed) send('fps-min', `${two(minutes)}-${deviceSpeed}`, 'reached');
    },
};
