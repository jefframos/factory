// AntEvents.ts
//
// What Ant tells the platform (PlatformHandler): gameplay start / stop (only on a change: while a level's being
// played, not paused, between levels or on the main screen), happy time on a finished picture, and analytics events
// (PlatformHandler.measure: category, what, action) — stable ids, no display text:
//   level <n> start | complete | fail | retry        level-time <n> <bucket>   (how long it took: 0-30s ... 8m+)
//   tutorial first-level start | complete           intro <mechanic> visible
//   booster <id> use | drop | buy | video           deco <id> buy | use
//   screen home | shop-boosts | shop-deco visible   playtime <1m ... 45m> reach (minutes of play, this session)
//   game all-levels complete

import PlatformHandler from 'core/platforms/PlatformHandler';

/** Level times are grouped into these (seconds), so they compare across levels. */
const TIME_BUCKETS = [30, 60, 120, 240, 480];
/** Minutes of play (this session) that are marked as they're reached. */
const PLAYTIME_MARKS = [1, 3, 5, 10, 15, 20, 30, 45];

let playing = false;
let playedSeconds = 0;
let nextMark = 0;

const measure = (category: string, what: string | number, action: string): void => PlatformHandler.instance.measure(category, what, action);

function bucket(seconds: number): string {
    let from = 0;
    for (const to of TIME_BUCKETS) {
        if (seconds < to) return `${from}-${to}s`;
        from = to;
    }
    return `${Math.round(from / 60)}m+`;
}

export const AntEvents = {
    /** Gameplay on or off, for the platform (sent only when it changes). */
    playing(on: boolean): void {
        if (on === playing) return;
        playing = on;
        const platform = PlatformHandler.instance.platform;
        void (on ? platform?.gameplayStart() : platform?.gameplayStop())?.catch?.(() => undefined);
    },

    /** Time going by while playing: the session's play-time marks. */
    tick(seconds: number): void {
        if (!playing) return;
        playedSeconds += seconds;
        while (nextMark < PLAYTIME_MARKS.length && playedSeconds >= PLAYTIME_MARKS[nextMark] * 60) {
            measure('playtime', `${PLAYTIME_MARKS[nextMark]}m`, 'reach');
            nextMark++;
        }
    },

    levelStart(number: number): void {
        measure('level', number, 'start');
    },

    /** Won (`won`) or lost, after `seconds` of play. */
    levelEnd(number: number, won: boolean, seconds: number): void {
        measure('level', number, won ? 'complete' : 'fail');
        measure('level-time', number, bucket(seconds));
        if (won) void PlatformHandler.instance.platform?.happyTime()?.catch?.(() => undefined);
    },

    levelRetry(number: number): void {
        measure('level', number, 'retry');
    },

    tutorial(action: 'start' | 'complete'): void {
        measure('tutorial', 'first-level', action);
    },

    intro(key: string): void {
        measure('intro', key, 'visible');
    },

    booster(id: string, action: 'use' | 'drop' | 'buy' | 'video'): void {
        measure('booster', id, action);
    },

    deco(id: string, action: 'buy' | 'use'): void {
        measure('deco', id, action);
    },

    screen(name: string): void {
        measure('screen', name, 'visible');
    },

    allLevelsDone(): void {
        measure('game', 'all-levels', 'complete');
    },
};
