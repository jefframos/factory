// sim-battle.ts — npx ts-node --transpile-only games/mob/tools/sim-battle.ts [level numbers...]
//
// Plays battles with no drawing, the cannon aimed by a few strategies, and prints how each went: who won, when, the
// base's HP, the most mobs at once, gate copies, giants, and how long a step took. For tuning MobConfig.ts / MobLevels.ts
// as a system (the brief's warning: the numbers only work together).

import { Battle, RED } from '../game/battle/Battle';
import * as fs from 'fs';
import * as path from 'path';
import { BattleConfig } from '../game/data/MobConfig';
import { ZoneConfig, buildPlayList, loopedBattle } from '../game/data/LevelList';

// The levels and zones as the game has them (it bundles them with Vite; here they're read from disk).
const MOB = path.resolve(__dirname, '..');
const levelFiles = fs.readdirSync(path.join(MOB, 'levels')).filter((f) => f.endsWith('.json'));
const byId: Record<string, BattleConfig> = Object.fromEntries(levelFiles.map((f) => [f.replace(/\.json$/, ''), JSON.parse(fs.readFileSync(path.join(MOB, 'levels', f), 'utf8'))]));
const zones: ZoneConfig[] = JSON.parse(fs.readFileSync(path.join(MOB, 'ui', 'zones.json'), 'utf8')).zones;
const PLAY = buildPlayList(byId, zones);
const LEVELS = PLAY.map((entry) => entry.config);
const battleConfig = (index: number) => loopedBattle(PLAY, index).config;

const STEP = 1 / 60;
const MAX_SECONDS = 150;

type Aim = (t: number, b: Battle) => number;
interface Run { label: string; aim: Aim; fireLevel?: number }

function play(index: number, run: Run): string {
    const battle = new Battle(battleConfig(index));
    battle.fireLevel = run.fireLevel ?? 1;
    battle.events = {};
    const started = performance.now();
    let steps = 0;
    while (battle.state === 'playing' && battle.time < MAX_SECONDS) {
        battle.aimX = Math.max(-4.2, Math.min(4.2, run.aim(battle.time, battle)));
        battle.step(STEP);
        steps++;
    }
    const msPerStep = (performance.now() - started) / steps;
    const result = battle.state === 'playing' ? 'timeout' : battle.state;
    const s = battle.giantStats;
    const each = (n: number, kills: number) => (n ? `${n}x${(kills / n).toFixed(0)}` : '-');
    const walls = battle.blocks.filter((b) => b.breakable).map((b) => (b.alive ? `${b.hp}/${b.hpMax}` : 'broken')).join(',');
    const forts = battle.targets.length > 1 ? `  forts ${battle.targets.map((f) => f.hp).join('/')}` : '';
    const pushes = battle.pushBlocks.length ? `  push ${battle.pushBlocks.map((p) => (p.alive ? p.nowZ.toFixed(1) : 'open')).join(',')}` : '';
    return `  ${run.label.padEnd(30)} ${result.padEnd(7)} ${battle.time.toFixed(1).padStart(5)}s  base ${String(battle.baseHp).padStart(3)}/${battle.baseHpMax}  peak ${String(battle.peak).padStart(3)}  giants blue ${each(s.blue, s.blueKills).padEnd(6)} red ${each(s.red, s.redKills).padEnd(6)}${walls ? `  wall ${walls}` : ''}${forts}${pushes}  ${msPerStep.toFixed(2)}ms`;
}

/** The best gate's x right now (the highest value; it follows a moving one). */
const bestGate = (b: Battle) => b.gates.reduce((best, gate) => (gate.value > best.value ? gate : best), b.gates[0]).nowX;
/** A red giant anywhere (the biggest threat: shot at as soon as it shows), else the red closest to the cannon once it's in
 *  the near half, if any. */
function threat(b: Battle): number {
    for (let i = 0; i < b.count; i++) if (b.team[i] === RED && b.big[i]) return i;
    let found = -1;
    for (let i = 0; i < b.count; i++) if (b.team[i] === RED && b.z[i] > -12 && (found < 0 || b.z[i] > b.z[found])) found = i;
    return found;
}
const decent: Aim = (_t, b) => { const t = threat(b); return t >= 0 ? b.x[t] : bestGate(b); };
const decentPad: Aim = (_t, b) => { const t = threat(b); return t >= 0 ? b.x[t] : (b.pads[0]?.x ?? bestGate(b)); };

const only = process.argv.slice(2).map(Number).filter((n) => n > 0);
LEVELS.forEach((level, index) => {
    if (only.length && !only.includes(index + 1)) return;
    console.log(`\n== ${index + 1}. ${level.name} (${level.kind})`);
    const runs: Run[] = [
        { label: 'decent (defend, else best gate)', aim: decent },
        { label: 'decent, fire level 3', aim: decent, fireLevel: 3 },
        { label: 'hold the best gate', aim: (_t, b) => bestGate(b) },
        { label: 'hold the middle', aim: () => 0 },
        { label: 'sweep side to side', aim: (t) => Math.sin(t * 0.8) * 3.8 },
    ];
    if (level.pads?.length) runs.splice(1, 0, { label: 'decent, feeding the pad', aim: decentPad });
    for (const run of runs) console.log(play(index, run));
});
