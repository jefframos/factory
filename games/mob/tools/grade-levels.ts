// grade-levels.ts — the level grader: robot players (game/sim) play levels where they are in the game and give each a
// difficulty grade, 0..100, into ui/grades.json (the editor shows them). Run it through grade-run.mjs (it bundles this
// with the current settings first):
//
//   node games/mob/tools/grade-run.mjs                 every level in the play order
//   node games/mob/tools/grade-run.mjs first-steps …   just those (each graded where it is in the order)
//   options: --careers N (goes per profile, default 3), --workers N, --no-save, --json (progress lines for the editor),
//            --state <file> (a JSON { zones?, levels?: { id: level } } used instead of what's on disk: the editor's
//            unsaved order and level).
//
// The work (each level x profile x go) is shared out over worker threads; each level's grade is saved as soon as it's
// done (so stopping it part way keeps those). At the end, a report of the whole game as it stands (every level in play
// order with its latest grade, marked when that's out of date) goes to reports/latest.json, and a run of every level
// is also kept as reports/grades-<date>.json (the editor's Curve tab draws them, against the curve to aim for).

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import { BattleConfig } from '../game/data/MobConfig';
import { PlayEntry, ZoneConfig, buildPlayList, loopedBattle } from '../game/data/LevelList';
import { Go, MAX_TRIES, PROFILES, levelScore, loadoutAt, playGo, profileGrade, STRESS } from '../game/sim/Grading';
import { contextHash, hashString, levelHash } from '../web/public/mob-grade-key.js';

interface Inputs { root: string; statePath?: string }
interface Job { index: number; profile: string; seed: number }
interface JobResult { job: Job; go: Go }

const args = process.argv.slice(2);
const option = (name: string): string | undefined => {
    const at = args.indexOf(name);
    return at >= 0 ? args[at + 1] : undefined;
};

/** The levels, the zones and the settings, from disk, with the editor's unsaved ones (`--state`) over them. */
function load(inputs: Inputs): { play: PlayEntry[]; settings: unknown } {
    const levelsDir = path.join(inputs.root, 'levels');
    const byId: Record<string, BattleConfig> = Object.fromEntries(fs.readdirSync(levelsDir).filter((f) => f.endsWith('.json')).map((f) => [f.replace(/\.json$/, ''), JSON.parse(fs.readFileSync(path.join(levelsDir, f), 'utf8'))]));
    let zones: ZoneConfig[] = JSON.parse(fs.readFileSync(path.join(inputs.root, 'ui', 'zones.json'), 'utf8')).zones;
    if (inputs.statePath) {
        const state = JSON.parse(fs.readFileSync(inputs.statePath, 'utf8')) as { zones?: { zones: ZoneConfig[] }; levels?: Record<string, BattleConfig> };
        if (state.zones?.zones) zones = state.zones.zones;
        Object.assign(byId, state.levels ?? {});
    }
    const settings = JSON.parse(fs.readFileSync(path.join(inputs.root, 'ui', 'settings.json'), 'utf8'));
    return { play: buildPlayList(byId, zones), settings };
}

function runJob(play: PlayEntry[], job: Job): Go {
    const profile = PROFILES.find((p) => p.id === job.profile)!;
    const loadout = loadoutAt(play, job.index, profile.spend);
    return playGo(loopedBattle(play, job.index).config, profile.skill, loadout, job.seed);
}

if (!isMainThread) {
    // A worker: plays the jobs it's sent.
    const { play } = load(workerData as Inputs);
    parentPort!.on('message', (job: Job) => parentPort!.postMessage({ job, go: runJob(play, job) } satisfies JobResult));
} else {
    main().catch((error) => {
        console.error(error);
        process.exit(1);
    });
}

async function main(): Promise<void> {
    const json = args.includes('--json');
    const inputs: Inputs = { root: option('--root') ?? path.resolve(__dirname, '..'), statePath: option('--state') };
    const careers = Math.max(1, Number(option('--careers') ?? 3));
    const workers = Math.max(1, Number(option('--workers') ?? Math.min(16, os.cpus().length - 2)));
    const named = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && ['--root', '--state', '--careers', '--workers', '--profiles'].includes(args[i - 1])));
    // --profiles a,b: only those (for trying the robots out; a grade needs them all, so nothing's saved).
    const only = option('--profiles')?.split(',');
    const profiles = only ? PROFILES.filter((p) => only.includes(p.id)) : PROFILES;
    if (only) args.push('--no-save');
    const { play, settings } = load(inputs);
    const say = (message: object): void => { if (json) console.log(`@@${JSON.stringify(message)}`); };

    // Each level to grade: where it is in the play order.
    const wanted = named.length ? named : [...new Set(play.map((entry) => entry.id))];
    const levels: { id: string; index: number }[] = [];
    for (const id of wanted) {
        const index = play.findIndex((entry) => entry.id === id);
        if (index < 0) say({ type: 'skipped', id, reason: 'not in any zone' });
        else levels.push({ id, index });
    }
    const jobs: Job[] = [];
    for (const { id, index } of levels) {
        for (const profile of profiles) for (let c = 0; c < careers; c++) jobs.push({ index, profile: profile.id, seed: parseInt(hashString(`${id}:${profile.id}:${c}`), 16) });
    }
    const total = jobs.length;
    say({ type: 'start', total, levels: levels.map((l) => l.id) });
    if (!json) console.log(`Grading ${levels.length} level(s): ${profiles.length} profiles x ${careers} goes each, on ${workers} threads…`);

    const goes = new Map<string, Go[]>();
    const left = new Map(levels.map((l) => [l.index, profiles.length * careers]));
    const gradesFile = path.join(inputs.root, 'ui', 'grades.json');
    const save = !args.includes('--no-save');
    const summary: string[] = [];
    let done = 0;

    /** A level's last job back: its grade, saved. */
    const finishLevel = (index: number): void => {
        const entry = play[index];
        const config = loopedBattle(play, index).config;
        const grades = profiles.map((profile) => profileGrade(profile.id, loadoutAt(play, index, profile.spend), goes.get(`${index}:${profile.id}`) ?? []));
        const score = Math.round(levelScore(grades));
        const grade = {
            index,
            levelHash: levelHash(entry.config),
            contextHash: contextHash(index, play.slice(0, index).map((e) => e.config), settings),
            score,
            at: new Date().toISOString(),
            careers,
            maxTries: MAX_TRIES,
            profiles: grades.map((p) => ({
                id: p.id,
                score: Math.round(p.score),
                firstWin: p.firstWin,
                never: p.never,
                tries: Number.isNaN(p.tries) ? null : Math.round(p.tries * 10) / 10,
                loadout: p.loadout,
                goes: p.goes.map((go) => go.tries.map((t) => [t.won ? 1 : 0, t.time, Math.round(t.danger * 100) / 100])),
                // Each go won first time: how many stress steps (STRESS.ladder) it survived.
                stress: p.goes.map((go) => go.stress),
            })),
        };
        if (save) {
            let file: { levels: Record<string, unknown> } = { levels: {} };
            try {
                file = JSON.parse(fs.readFileSync(gradesFile, 'utf8'));
            } catch {
                // None yet.
            }
            file.levels = { ...(file.levels ?? {}), [entry.id]: grade };
            fs.writeFileSync(gradesFile, `${JSON.stringify(file, null, 2)}\n`);
        }
        say({ type: 'level', id: entry.id, index, score });
        summary.push(`${String(index + 1).padStart(3)}. ${config.name.padEnd(26)} ${String(score).padStart(3)}   ${grades.map((p) => `${p.id} ${Math.round(p.score)}`).join('  ')}`);
        if (!json) console.log(summary[summary.length - 1]);
        // --verbose: every go's tries (W/L, seconds, how close the reds came).
        if (!json && args.includes('--verbose')) {
            for (const p of grades) {
                const l = p.loadout;
                console.log(`       ${p.id.padEnd(12)} coins ${l.coins} (spent ${l.spent}) fire ${l.fire} energy ${l.capacity} recharge ${l.recharge} cards ${JSON.stringify(l.cards)}`);
                for (const go of p.goes) console.log(`         ${go.tries.map((t) => `${t.won ? 'W' : 'L'}${t.time}s/${t.danger.toFixed(2)}`).join(' ')}${go.stress === null ? '' : `  stress ${go.stress}/${STRESS.ladder.length}`}  -> ${Math.round(go.score)}`);
            }
        }
    };

    await new Promise<void>((resolve, reject) => {
        let next = 0;
        let busy = 0;
        const pool: Worker[] = [];
        const feed = (worker: Worker): void => {
            if (next >= jobs.length) {
                if (busy === 0) {
                    pool.forEach((w) => w.terminate());
                    resolve();
                }
                return;
            }
            busy++;
            worker.postMessage(jobs[next++]);
        };
        for (let w = 0; w < Math.min(workers, jobs.length || 1); w++) {
            const worker = new Worker(__filename, { workerData: inputs });
            worker.on('message', ({ job, go }: JobResult) => {
                busy--;
                done++;
                const key = `${job.index}:${job.profile}`;
                goes.set(key, [...(goes.get(key) ?? []), go]);
                say({ type: 'progress', done, total });
                const remaining = left.get(job.index)! - 1;
                left.set(job.index, remaining);
                if (remaining === 0) finishLevel(job.index);
                feed(worker);
            });
            worker.on('error', reject);
            pool.push(worker);
            feed(worker);
        }
        if (!jobs.length) resolve();
    });
    if (save) {
        const written = writeReport(inputs.root, play, settings, gradesFile, { full: !named.length, careers });
        if (!json) console.log(`Report: ${written.map((file) => path.relative(process.cwd(), file)).join(', ')}`);
    }
    say({ type: 'done' });
    if (!json && save) console.log(`Saved ${path.relative(process.cwd(), gradesFile)}`);
}

/** The whole game's grades as they stand, in play order, into reports/ (latest.json; and a dated copy for a full run). */
function writeReport(root: string, play: PlayEntry[], settings: unknown, gradesFile: string, { full, careers }: { full: boolean; careers: number }): string[] {
    let file: { levels: Record<string, StoredGrade> } = { levels: {} };
    try {
        file = JSON.parse(fs.readFileSync(gradesFile, 'utf8'));
    } catch {
        // None.
    }
    const at = new Date();
    const levels = play.map((entry, index) => {
        const grade = file.levels?.[entry.id];
        const fresh = !!grade && grade.index === index && grade.levelHash === levelHash(entry.config)
            && grade.contextHash === contextHash(index, play.slice(0, index).map((e) => e.config), settings);
        const config = loopedBattle(play, index).config;
        return {
            index, id: entry.id, name: config.name, kind: config.kind, zone: entry.zone.id, zoneName: entry.zone.name,
            reward: config.reward, redRate: config.redRate, redRateEnd: config.redRateEnd, baseHp: config.baseHp,
            score: grade?.score ?? null, stale: !!grade && !fresh, gradedAt: grade?.at ?? null,
            profiles: Object.fromEntries((grade?.profiles ?? []).map((p) => [p.id, { score: p.score, firstWin: p.firstWin, never: p.never, tries: p.tries }])),
        };
    });
    const report = {
        at: at.toISOString(), full, careers,
        profiles: PROFILES.map((p) => ({ id: p.id, name: p.name, weight: p.weight })),
        levels,
    };
    const dir = path.join(root, 'reports');
    fs.mkdirSync(dir, { recursive: true });
    const text = `${JSON.stringify(report, null, 2)}\n`;
    const written = [path.join(dir, 'latest.json')];
    if (full) {
        const pad = (n: number) => String(n).padStart(2, '0');
        written.push(path.join(dir, `grades-${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}.json`));
    }
    for (const out of written) fs.writeFileSync(out, text);
    return written;
}

/** A level's grade as ui/grades.json keeps it (the part the report reads). */
interface StoredGrade {
    index: number;
    levelHash: string;
    contextHash: string;
    score: number;
    at: string;
    profiles: { id: string; score: number; firstWin: number; never: number; tries: number | null }[];
}
