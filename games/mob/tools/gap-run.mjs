// gap-run.mjs — bundles the gap check (gap-check.ts, with units.json as it is now: esbuild inlines it) and runs it on
// one level, for the editor's Check gaps (its server: POST /api/mob/gaps). From the command line:
//
//   node games/mob/tools/gap-run.mjs games/mob/levels/islands.json      → its JSON

import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(os.tmpdir(), 'mob-grader');
const OUT = path.join(DIR, 'gap-check.cjs');

/** The bundle being built (shared by the checks that ask within a few seconds: a check-all's run at once). */
let building = null;
let builtAt = 0;
function buildGapCheck() {
    if (!building || Date.now() - builtAt > 5000) {
        builtAt = Date.now();
        building = build();
        building.catch(() => { building = null; });
    }
    return building;
}

async function build() {
    const esbuild = await import('esbuild');
    await esbuild.build({ entryPoints: [path.join(HERE, 'gap-check.ts')], bundle: true, platform: 'node', format: 'cjs', target: 'node18', outfile: OUT, logLevel: 'warning' });
    return OUT;
}

/** The gap check of `level` (a level's JSON, saved or not). */
export async function checkGaps(level) {
    const script = await buildGapCheck();
    const file = path.join(DIR, `gaps-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    await fs.writeFile(file, JSON.stringify(level));
    try {
        const stdout = await new Promise((resolve, reject) => {
            execFile(process.execPath, [script, '--level', file], { maxBuffer: 64 * 1024 * 1024, timeout: 120000 }, (error, out, err) => (error ? reject(new Error(err.trim().split(/\r?\n/).slice(-3).join(' ') || error.message)) : resolve(out)));
        });
        return JSON.parse(stdout);
    } finally {
        fs.rm(file, { force: true }).catch(() => {});
    }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const level = JSON.parse(await fs.readFile(process.argv[2], 'utf8'));
    process.stdout.write(JSON.stringify(await checkGaps(level)));
}
