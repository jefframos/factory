// Track.ts
//
// The game's analytics: what to measure to find where players drop and how long they play. Each event goes to the
// platform (PlatformHandler.measure → Poki's game events; YouTube Playables has no custom events) as
// (category, what, action) with stable, countable values — day numbers and ids, never free text — and to the playtest
// log (Beats: the console and the ?dev=1 timer).
//
//   session  · boot · start                  the game opened
//   session  · 1min … 60min · reached         time played (heartbeats): how long they stay
//   tutorial · first-serve · complete         the first dish served
//   day      · <n> · start | complete        the funnel: which day they stop at
//   day      · <n> · perfect                  a day with every order right
//   stage    · <id> · start                   an upgrade reached (smallDiner, diner…)
//   dish     · <burger|iceCream|pizza|sundae> · fast | complete | fail   which station's hard
//   customer · left · fail                    a customer ran out of patience at the door
//   market   · <day> · start | complete | fail (a wrong crate)
//   phone    · <day> · start | complete
//   delivery · <day> · start | complete

import PlatformHandler from 'core/platforms/PlatformHandler';
import { Beats } from './Beats';

/** The session's heartbeats (minutes played). */
const MINUTES = [1, 2, 3, 4, 5, 7, 10, 15, 20, 30, 45, 60];
const sent = new Set<string>();

export const Track = {
    /** One event. `once`: only the first time this session. */
    event(category: string, what: string | number, action: string, once = false): void {
        const key = `${category}|${what}|${action}`;
        if (once) {
            if (sent.has(key)) return;
            sent.add(key);
        }
        PlatformHandler.instance.measure(category, what, action);
        Beats.mark(`${category} ${what} ${action}`);
    },

    /** Each frame (index.ts): the minute heartbeats as they're passed. */
    tick(): void {
        const minutes = Beats.elapsed / 60;
        for (const m of MINUTES) {
            if (minutes >= m) Track.event('session', `${m}min`, 'reached', true);
        }
    },
};
