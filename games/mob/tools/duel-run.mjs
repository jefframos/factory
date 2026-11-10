// duel-run.mjs — bundles the arena simulator (duel-sim.ts, with the settings as they are now: esbuild inlines them) and
// runs a job, for the editor's Arena tab (its server: POST /api/mob/duel-sim). From the command line:
//
//   node games/mob/tools/duel-run.mjs games/mob/arenas/beach.json [blue skill] [red skill] [matches]   → its JSON

import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(os.tmpdir(), 'mob-grader');
const OUT = path.join(DIR, 'duel-sim.cjs');

async function build() {
    const esbuild = await import('esbuild');
    await esbuild.build({ entryPoints: [path.join(HERE, 'duel-sim.ts')], bundle: true, platform: 'node', format: 'cjs', target: 'node18', outfile: OUT, logLevel: 'warning' });
    return OUT;
}

/** Robot-against-robot matches (see duel-sim.ts for the job and what comes back). */
export async function simulateDuel(job) {
    const script = await build();
    await fs.mkdir(DIR, { recursive: true });
    const file = path.join(DIR, `duel-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    await fs.writeFile(file, JSON.stringify(job));
    try {
        const stdout = await new Promise((resolve, reject) => {
            execFile(process.execPath, [script, '--job', file], { maxBuffer: 64 * 1024 * 1024, timeout: 300000 }, (error, out, err) => (error ? reject(new Error(err.trim().split(/\r?\n/).slice(-3).join(' ') || error.message)) : resolve(out)));
        });
        return JSON.parse(stdout);
    } finally {
        fs.rm(file, { force: true }).catch(() => {});
    }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const arena = JSON.parse(await fs.readFile(process.argv[2], 'utf8'));
    const side = (skill) => ({ skill, cards: { giant: 1, truck: 1, saucer: 1, car: 1 }, fire: 1, capacity: 1, recharge: 1 });
    const result = await simulateDuel({ arena, blue: side(process.argv[3] ?? 'average'), red: side(process.argv[4] ?? 'average'), matches: Number(process.argv[5] ?? 4) });
    for (const run of result.runs) {
        console.log(`${run.blue} vs ${run.red}: won ${run.won} lost ${run.lost} draw ${run.draw} · ${run.time}s · life ${run.blueHp}/${run.blueMax} vs ${run.redHp}/${run.redMax}`);
        for (const m of run.matches) console.log(`   ${m.result.padEnd(4)} ${m.time}s  ${m.blueHp} vs ${m.redHp}  down ${m.blueDown}/${m.redDown}`);
    }
}
