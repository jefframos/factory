// grade-run.mjs — bundles the level grader (grade-levels.ts, with the settings as they are now: esbuild inlines the
// JSON) and runs it. From the command line, with grade-levels.ts's arguments:
//
//   node games/mob/tools/grade-run.mjs [level ids…] [--changed] [--careers N] [--workers N] [--no-save]
//
// The editor's server uses startGrading() to run it in the background (its progress as JSON lines).
//
// The grader's fingerprint (`--grader-hash`): a hash of every file bundled into it (the robots, the battle, the settings
// it inlines…), but not the levels and their order (each grade keeps its own level's and what's before it). A grade
// made by another fingerprint is out of date: the way levels are graded changed, so `--changed` grades it again.

import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const MOB_ROOT = path.resolve(HERE, '..');
const OUT = path.join(os.tmpdir(), 'mob-grader', 'grade-levels.cjs');

/** What a grade's fingerprint leaves out: the levels, their order, and what the tools write. */
const NOT_THE_ALGORITHM = /(^|[\\/])(levels[\\/][^\\/]+\.json|ui[\\/](zones|grades|gaps)\.json)$/;

/** Bundles grade-levels.ts into one script (outside the repo): its path, and the grading algorithm's fingerprint. */
export async function buildGrader() {
    const esbuild = await import('esbuild');
    const result = await esbuild.build({
        entryPoints: [path.join(HERE, 'grade-levels.ts')],
        bundle: true,
        platform: 'node',
        format: 'cjs',
        target: 'node18',
        outfile: OUT,
        logLevel: 'warning',
        metafile: true,
    });
    const hash = crypto.createHash('sha1');
    for (const input of Object.keys(result.metafile.inputs).sort()) {
        if (NOT_THE_ALGORITHM.test(input)) continue;
        hash.update(input);
        hash.update(fs.readFileSync(path.resolve(process.cwd(), input)));
    }
    return { script: OUT, hash: hash.digest('hex').slice(0, 16) };
}

/**
 * Runs the grader with `args` (its own, plus --root and --json). `onMessage` gets each progress message ({ type: …
 * }), `onExit` the exit code and the end of what it printed to stderr. Returns the child process (kill() stops it).
 */
export async function startGrading(args, { onMessage = () => {}, onExit = () => {} } = {}) {
    const { script, hash } = await buildGrader();
    const child = spawn(process.execPath, [script, '--root', MOB_ROOT, '--json', '--grader-hash', hash, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let buffer = '';
    let errors = '';
    child.stdout.on('data', (chunk) => {
        buffer += chunk;
        let at;
        while ((at = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, at).trim();
            buffer = buffer.slice(at + 1);
            if (!line.startsWith('@@')) continue;
            try {
                onMessage(JSON.parse(line.slice(2)));
            } catch {
                // Not one of its messages.
            }
        }
    });
    child.stderr.on('data', (chunk) => {
        errors = (errors + chunk).slice(-4000);
    });
    child.on('exit', (code) => onExit(code, errors));
    return child;
}

// From the command line: build it and run it here.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const { script, hash } = await buildGrader();
    const child = spawn(process.execPath, [script, '--root', MOB_ROOT, '--grader-hash', hash, ...process.argv.slice(2)], { stdio: 'inherit' });
    child.on('exit', (code) => process.exit(code ?? 0));
}
