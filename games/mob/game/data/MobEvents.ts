// MobEvents.ts
//
// What Mob tells the platform (PlatformHandler): gameplay start / stop (only on a change: while a battle's being played —
// not on the end card, not before the player's first touch, not while the platform has the game paused or the tab is
// hidden), and analytics
// events (PlatformHandler.measure: category, what, action), stable ids, no display text. Every event lives here.
//
//   category      what                         action     when
//   level         <n>                          start      a battle starts (n = battle number, counting up forever)
//   level         <n>                          complete   it's won
//   level         <n>                          fail       it's lost
//   level         <n>                          retry      the player plays a lost battle again
//   level-id      <levelId>                    start / complete / fail   the same, by level file (levels/<id>.json)
//   level-time    <n>-<bucket>                 complete   how long the win took (0-30s, 30-60s, 60-120s, 120-240s, 4m+)
//   level-reach   <n>-<share>                  fail       how far into the enemy's HP a lost battle got (0-25% ... 75-100%)
//   progress      level-<n>                    reach      the furthest battle reached so far, the first time (saved)
//   zone          <zoneId>                     start      a zone's first battle starts (each loop)
//   zone          <zoneId>                     complete   its last battle is won
//   game          all-levels                   complete   the last battle of the last zone is won (each loop)
//   unit          giant | truck | car | ufo    make       a house makes one
//   upgrade       <kind>-<level>               buy        an upgrade is bought (fire / capacity / recharge)
//   playtime      <1m ... 45m>                 reach      minutes of play this session
//
// Add an event here (and to the table) rather than calling PlatformHandler.measure() directly.

import PlatformHandler from 'core/platforms/PlatformHandler';

/** Win times are grouped into these (seconds), so they compare across battles. */
const TIME_BUCKETS = [30, 60, 120, 240];
/** Minutes of play (this session) that are marked as they're reached. */
const PLAYTIME_MARKS = [1, 3, 5, 10, 15, 20, 30, 45];

/** Gameplay as last told to the platform, and as the game wants it. */
let playing = false;
let wantsPlaying = false;
/** The platform paused the game (an ad, the tab hidden): gameplay is stopped until it resumes. */
let paused = false;
/**
 * The player's first input (press, touch or key) this session: gameplay start is only sent after it — a battle shown on
 * load isn't play yet. Listened for in the capture phase, before the game handles it.
 */
let touched = false;
let playedSeconds = 0;
let nextMark = 0;

/** The tab is hidden (the game's updates stop then: core/Game.ts), unless the platform does its own pausing. */
const hidden = (): boolean => PlatformHandler.instance.platform?.usesPageVisibilityApi !== false && document.hidden;

function sendPlaying(): void {
    const on = wantsPlaying && touched && !paused && !hidden();
    if (on === playing) return;
    playing = on;
    const platform = PlatformHandler.instance.platform;
    void (on ? platform?.gameplayStart() : platform?.gameplayStop())?.catch?.(() => undefined);
}

const FIRST_INPUT_EVENTS = ['pointerdown', 'touchstart', 'keydown'] as const;
function onFirstInput(): void {
    if (touched) return;
    touched = true;
    for (const type of FIRST_INPUT_EVENTS) window.removeEventListener(type, onFirstInput, true);
    sendPlaying();
}
for (const type of FIRST_INPUT_EVENTS) window.addEventListener(type, onFirstInput, true);
document.addEventListener('visibilitychange', sendPlaying);

const measure = (category: string, what: string | number, action: string): void => PlatformHandler.instance.measure(category, what, action);

function timeBucket(seconds: number): string {
    let from = 0;
    for (const to of TIME_BUCKETS) {
        if (seconds < to) return `${from}-${to}s`;
        from = to;
    }
    return `${Math.round(from / 60)}m+`;
}

export const MobEvents = {
    /** Gameplay on or off (sent only when it changes; a start waits for the player's first input and a resume). */
    playing(on: boolean): void {
        wantsPlaying = on;
        sendPlaying();
    },

    /** The platform paused or resumed the game. */
    paused(on: boolean): void {
        paused = on;
        sendPlaying();
    },

    /** Time going by: the session's play-time marks (only while playing). */
    tick(seconds: number): void {
        if (!playing) return;
        playedSeconds += seconds;
        while (nextMark < PLAYTIME_MARKS.length && playedSeconds >= PLAYTIME_MARKS[nextMark] * 60) {
            measure('playtime', `${PLAYTIME_MARKS[nextMark]}m`, 'reach');
            nextMark++;
        }
    },

    /** Battle `number` (1-based) starts: level `id`; `zoneStart` when it's its zone's first; `best` = furthest reached before. */
    levelStart(number: number, id: string, zone: { id: string; first: boolean }, best: number): void {
        measure('level', number, 'start');
        measure('level-id', id, 'start');
        if (zone.first) measure('zone', zone.id, 'start');
        if (number > best) measure('progress', `level-${number}`, 'reach');
    },

    levelComplete(number: number, id: string, seconds: number, zone: { id: string; last: boolean }, lastOfAll: boolean): void {
        measure('level', number, 'complete');
        measure('level-id', id, 'complete');
        measure('level-time', `${number}-${timeBucket(seconds)}`, 'complete');
        if (zone.last) measure('zone', zone.id, 'complete');
        if (lastOfAll) measure('game', 'all-levels', 'complete');
    },

    /** Lost, `share` (0..1) of the way through the enemy's HP. */
    levelFail(number: number, id: string, share: number): void {
        measure('level', number, 'fail');
        measure('level-id', id, 'fail');
        const quarter = Math.min(3, Math.floor(Math.max(0, share) * 4));
        measure('level-reach', `${number}-${quarter * 25}-${quarter * 25 + 25}%`, 'fail');
    },

    levelRetry(number: number): void {
        measure('level', number, 'retry');
    },

    unitMade(unit: string): void {
        measure('unit', unit, 'make');
    },

    upgradeBought(kind: string, level: number): void {
        measure('upgrade', `${kind}-${level}`, 'buy');
    },
};
