// sim-battle.ts — npx ts-node --transpile-only games/mob/tools/sim-battle.ts
//
// Plays battles with no drawing, the cannon held at an aim, and prints how each went: who won, when, the base's HP,
// the most mobs at once, and how long a step took. For tuning game/data/MobConfig.ts as a system (the brief's warning:
// the numbers only work together).

import { Battle } from '../game/battle/Battle';
import { battleConfig } from '../game/data/MobConfig';

const STEP = 1 / 60;
const MAX_SECONDS = 150;

interface Run { label: string; battle: number; aim: (t: number, b: Battle) => number; fireLevel?: number }

function play(run: Run): string {
    const battle = new Battle(battleConfig(run.battle));
    battle.fireLevel = run.fireLevel ?? 1;
    let firstBaseHit = -1;
    let gateCopies = 0;
    battle.events = {
        baseHit: () => { if (firstBaseHit < 0) firstBaseHit = battle.time; },
        gate: (_g, _x, _z, made) => { gateCopies += made; },
    };
    const started = performance.now();
    let steps = 0;
    while (battle.state === 'playing' && battle.time < MAX_SECONDS) {
        battle.aimX = run.aim(battle.time, battle);
        battle.step(STEP);
        steps++;
    }
    const msPerStep = (performance.now() - started) / steps;
    const result = battle.state === 'playing' ? 'timeout' : battle.state;
    return `${run.label.padEnd(34)} ${result.padEnd(7)} at ${battle.time.toFixed(1).padStart(5)}s  base ${String(battle.baseHp).padStart(3)}/${battle.baseHpMax}  first hit ${firstBaseHit < 0 ? '  -  ' : firstBaseHit.toFixed(1) + 's'}  peak ${String(battle.peak).padStart(3)}  copies ${String(gateCopies).padStart(4)}  ${msPerStep.toFixed(2)}ms/step`;
}

const sweep = (t: number) => Math.sin(t * 0.8) * 3.5;
/** A decent player: shoots at the red closest to the cannon once one's in the near half, else through the x3 gate. */
const player = (_t: number, b: Battle) => {
    let threat = -1;
    for (let i = 0; i < b.count; i++) if (b.team[i] === 1 && b.z[i] > -12 && (threat < 0 || b.z[i] > b.z[threat])) threat = i;
    return threat >= 0 ? Math.max(-4.2, Math.min(4.2, b.x[threat])) : 2.45;
};
for (const battle of [0, 1, 2]) {
    const name = battleConfig(battle).name;
    console.log(`\n== ${battle + 1}. ${name}`);
    for (const run of [
        { label: 'decent player (defend, else x3)', battle, aim: player },
        { label: 'decent player, fire level 3', battle, aim: player, fireLevel: 3 },
        { label: 'through x3 (right)', battle, aim: () => 2.45 },
        { label: 'through x2 (left)', battle, aim: () => -2.45 },
        { label: 'between the gates (no gate)', battle, aim: () => 0 },
        { label: 'sweeping side to side', battle, aim: sweep },
        { label: 'through x3, fire level 5', battle, aim: () => 2.45, fireLevel: 5 },
    ]) console.log(play(run));
}
