// funnel.mjs — reads a Poki progress export (progress-events*.csv) as the farm game's funnel, in play order.
//
//   node games/mow/data/funnel.mjs games/mow/data/progress-events-new.csv
//
// Prints each step's players (gameplays), its share of the players who started (session-new + session-returning) and
// of the step before. Builds with the numbered `step` events (GameAnalytics.step()) are read straight from them; older
// exports are mapped from their individual events (OLD_STEPS).

import fs from 'node:fs';

const file = process.argv[2];
if (!file) {
    console.error('usage: node funnel.mjs <progress-events.csv>');
    process.exit(1);
}
const rows = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/).slice(1).map((line) => line.split(','));
const players = new Map(rows.map(([event, gameplays]) => [event, Number(gameplays)]));
/** Each event's columns (gameplays, starts, completes, fails, lefts). */
const columns = new Map(rows.map(([event, ...rest]) => [event, rest.map(Number)]));
const count = (event) => players.get(event) ?? 0;

/** Before the `step` events: each step's event in the old names. */
const OLD_STEPS = [
    ['loaded', 'game-loading'],
    ['moved', 'tutorial-01-move'],
    ['first cut', 'tutorial-02-cut'],
    ['bag full', 'bag-farmtest-full'],
    ['grass into a station', 'tutorial-04-sell'],
    ['push mower', 'tool-farmtest-01-pushmower'],
    ['yard done', 'district-yard'],
    ['first bag upgrade', 'upgrade-farmtest-capacity-01'],
    ['lawn tractor', 'tool-farmtest-02-lawntractor'],
    ['first blades', 'upgrade-farmtest-blades-01'],
    ['park done', 'district-park'],
    ['big tractor', 'tool-farmtest-03-bigtractor'],
    ['den found', 'den-chicken-found'],
    ['2nd hen', 'den-chicken-hen-02'],
    ['den lesson done', 'den-chicken-tutorial'],
    ['trucks', 'den-chicken-dock'],
    ['wilds done', 'district-wilds'],
    ['egg belt', 'den-chicken-belt'],
    ['helper', 'den-chicken-helper'],
    ['gold machine', 'den-chicken-gold'],
    ['section 4 bought', 'unlock-section-4'],
    ['truck helper', 'den-chicken-truck-helper'],
    ['gold belt', 'den-chicken-gold-belt'],
    ['section 4 done', 'district-section-4'],
];

const stepRows = [...players.keys()].filter((event) => /^step-\d\d-/.test(event)).sort();
const started = count('session-new') + count('session-returning');
if (stepRows.length) {
    // The new layout: each step started (it became the goal), completed, and the players who left during it.
    const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '-');
    console.log(`${file}\nplayers who started: ${started}\n\nstep                        started   done   left  done%  of all`);
    for (const event of stepRows) {
        const [, starts, completes, , lefts] = columns.get(event);
        console.log(`${event.replace(/^step-/, '').padEnd(26)} ${String(starts).padStart(8)} ${String(completes).padStart(6)} ${String(lefts).padStart(6)} ${pct(completes, starts).padStart(6)} ${pct(completes, started).padStart(7)}`);
    }
    process.exit(0);
}
const steps = OLD_STEPS;

const pct = (a, b) => (b > 0 ? `${((a / b) * 100).toFixed(0)}%`.padStart(5) : '    -');
console.log(`${file}\nplayers who started: ${started} (new ${count('session-new')}, returning ${count('session-returning')})\n`);
console.log('step                     players  of all  of prev');
let previous = 0;
for (const [name, event] of steps) {
    const n = count(event);
    console.log(`${name.padEnd(24)} ${String(n).padStart(7)}  ${pct(n, started)}   ${previous ? pct(n, previous) : '    -'}`);
    previous = n || previous;
}
console.log('\nactive play (players reaching n minutes in a session):');
for (const minutes of [1, 2, 3, 5, 8, 12, 20, 30]) {
    const n = count(`playtime-min-${minutes}`);
    console.log(`  ${String(minutes).padStart(2)} min ${String(n).padStart(6)}  ${pct(n, started)}`);
}
console.log('\nplayer levels:');
for (let level = 2; level <= 20; level++) {
    const n = count(`level-${String(level).padStart(2, '0')}`);
    if (n) console.log(`  level ${String(level).padStart(2)} ${String(n).padStart(6)}  ${pct(n, started)}`);
}
