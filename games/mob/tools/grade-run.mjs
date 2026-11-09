// grade-run.mjs — bundles the level grader (grade-levels.ts, with the settings as they are now: esbuild inlines the
// JSON) and runs it. From the command line, with grade-levels.ts's arguments:
//
//   node games/mob/tools/grade-run.mjs [level ids…] [--careers N] [--workers N] [--no-save]
//
// The editor's server uses startGrading() to run it in the background (its progress as JSON lines).

import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const MOB_ROOT = path.resolve(HERE, '..');
const OUT = path.join(os.tmpdir(), 'mob-grader', 'grade-levels.cjs');

/** Bundles grade-levels.ts into one script (outside the repo); its path. */
export async function buildGrader() {
    const esbuild = await import('esbuild');
    await esbuild.build({
        entryPoints: [path.join(HERE, 'grade-levels.ts')],
        bundle: true,
        platform: 'node',
        format: 'cjs',
        target: 'node18',
        outfile: OUT,
        logLevel: 'warning',
    });
    return OUT;
}

/**
 * Runs the grader with `args` (its own, plus --root and --json). `onMessage` gets each progress message ({ type: …
 * }), `onExit` the exit code and the end of what it printed to stderr. Returns the child process (kill() stops it).
 */
export async function startGrading(args, { onMessage = () => {}, onExit = () => {} } = {}) {
    const script = await buildGrader();
    const child = spawn(process.execPath, [script, '--root', MOB_ROOT, '--json', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
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
    const script = await buildGrader();
    const child = spawn(process.execPath, [script, '--root', MOB_ROOT, ...process.argv.slice(2)], { stdio: 'inherit' });
    child.on('exit', (code) => process.exit(code ?? 0));
}
