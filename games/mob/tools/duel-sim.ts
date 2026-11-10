// duel-sim.ts — the arena simulator: robot against robot on an arena (game/sim/Duel.ts), for the editor's Arena tab
// (its server: POST /api/mob/duel-sim, through duel-run.mjs, which bundles this). Prints a JSON summary:
//
//   node <bundle> --job <file.json>
//
// The job: { arena, blue: MatchSide, red: MatchSide, matches }, or with `against: [skill…]` instead of `red`: each of
// those skills (the red side's cards and upgrades the blue's), `matches` each. Out: { runs: [{ blue, red, won, lost,
// draw, time, blueHp, redHp, blueMax, redMax, matches: [...] }] }.
//
// A ladder job: { arena, ladder, player: MatchSide, matches } — the player (a robot, with its cards and cannon) plays
// `matches` in a row from a new record, each against the opponent the ladder gives it then (game/data/ArenaLadder).
// Out: { climb: [{ rating, tier, opponent, result, time, blueHp, redHp }], record }.

import * as fs from 'fs';
import { ArenaConfig } from '../game/data/ArenaConfig';
import { Ladder, afterMatch, freshRecord, opponentFor } from '../game/data/ArenaLadder';
import { MatchResult, MatchSide, playMatch } from '../game/sim/Duel';
import { SKILLS } from '../game/sim/Grading';

interface Job { arena: ArenaConfig; blue: MatchSide; red?: MatchSide; against?: (keyof typeof SKILLS)[]; matches?: number; ladder?: Ladder; player?: MatchSide }

const at = process.argv.indexOf('--job');
const job = JSON.parse(fs.readFileSync(process.argv[at + 1], 'utf8')) as Job;
const matches = Math.max(1, Math.min(200, job.matches ?? 10));
if (job.ladder && job.player) {
    let record = freshRecord();
    const climb = [];
    for (let k = 0; k < matches; k++) {
        const opponent = opponentFor(job.ladder, record, job.player);
        const red: MatchSide = { skill: opponent.skill, cards: opponent.cards, fire: opponent.fire, capacity: opponent.capacity, recharge: opponent.recharge };
        const m = playMatch(job.arena, job.player, red, 5000 + k * 7919, k % 2 === 1);
        climb.push({ rating: record.rating, tier: opponent.tier.name, opponent: red, result: m.result, time: m.time, blueHp: m.blueHp, redHp: m.redHp });
        record = afterMatch(job.ladder, record, m.result);
    }
    process.stdout.write(JSON.stringify({ climb, record }));
    process.exit(0);
}
const reds: MatchSide[] = job.against?.length ? job.against.map((skill) => ({ ...job.blue, skill })) : [job.red ?? job.blue];
const runs = reds.map((red) => {
    const played: MatchResult[] = [];
    for (let k = 0; k < matches; k++) played.push(playMatch(job.arena, job.blue, red, 1000 + k * 7919, k % 2 === 1));
    const mean = (pick: (m: MatchResult) => number) => Math.round((played.reduce((sum, m) => sum + pick(m), 0) / played.length) * 10) / 10;
    return {
        blue: job.blue.skill, red: red.skill,
        won: played.filter((m) => m.result === 'won').length,
        lost: played.filter((m) => m.result === 'lost').length,
        draw: played.filter((m) => m.result === 'draw').length,
        time: mean((m) => m.time), blueHp: mean((m) => m.blueHp), redHp: mean((m) => m.redHp),
        blueMax: played[0]?.blueMax ?? 0, redMax: played[0]?.redMax ?? 0,
        matches: played,
    };
});
process.stdout.write(JSON.stringify({ runs }));
