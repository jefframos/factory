// Beats.ts
//
// The session's beats, for playtesting the first minutes (the "5 minutes" benchmark): the first burger served, each
// day's start and end, the supermarket, each upgrade, the phone orders and the delivery — each with the time since the
// game opened. They go to the console ("[beat] 1:23 day 2 complete") and to the dev timer in the corner (index.ts, ?dev=1
// only). The platform's analytics get Track's events (Track.ts), which log here too.

export interface Beat {
    /** Seconds since the game opened. */
    at: number;
    name: string;
}

const opened = performance.now();
const log: Beat[] = [];
const once = new Set<string>();
const listeners: ((beat: Beat) => void)[] = [];

/** m:ss */
export const clock = (seconds: number): string => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

export const Beats = {
    /** Seconds since the game opened. */
    get elapsed(): number {
        return (performance.now() - opened) / 1000;
    },

    get all(): readonly Beat[] {
        return log;
    },

    /** A beat, now. `first`: only the first time this session (e.g. "first burger served"). */
    mark(name: string, first = false): void {
        if (first) {
            if (once.has(name)) return;
            once.add(name);
        }
        const beat = { at: Beats.elapsed, name };
        log.push(beat);
        console.info(`[beat] ${clock(beat.at)} ${name}`);
        listeners.forEach((listener) => listener(beat));
    },

    onBeat(listener: (beat: Beat) => void): void {
        listeners.push(listener);
    },
};
