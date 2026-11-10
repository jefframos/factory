// grade-levels.ts — the level grader: robot players (game/sim) play levels where they are in the game and give each a
// difficulty grade, 0..100, into ui/grades.json (the editor shows them). Run it through grade-run.mjs (it bundles this
// with the current settings first):
//
//   node games/mob/tools/grade-run.mjs                 every level in the play order
//   node games/mob/tools/grade-run.mjs first-steps …   just those (each graded where it is in the order)
//   options: --changed (of all the levels, only those whose grade is missing or out of date: the level, those before it
//            or the settings changed, or the grading itself did: --grader-hash, which grade-run.mjs passes),
//            --careers N (goes per profile, default 3), --workers N, --no-save, --json (progress lines for the editor),
//            --state <file> (a JSON { zones?, levels?: { id: level } } used instead of what's on disk: the editor's
//            unsaved order and level).
//
// The work is shared out over worker threads a battle at a time: each go (a level x profile x career) is its tries and
// its stress probes, and a free thread takes the battle most surely needed (the next try, the next probe; then ones a go
// may need, ahead of what came back: the tries after the one still playing, the probes either way the search could go).
// So a full run plays what it would anyway, and a run of a level or two spreads each go over the threads instead of
// leaving them idle while a few goes play their tries one after another. The grades are the same either way (each
// battle has the luck it always had). Each level's grade is saved as soon as it's done (so stopping it part way keeps
// those). At the end, a report of the whole game as it stands (every level in play
// order with its latest grade, marked when that's out of date) goes to reports/latest.json, and a run of every level
// is also kept as reports/grades-<date>.json (the editor's Curve tab draws them, against the curve to aim for).

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import { BattleConfig } from '../game/data/MobConfig';
import { PlayEntry, ZoneConfig, buildPlayList, loopedBattle } from '../game/data/LevelList';
import { BattleRun, Go, MAX_TRIES, PROFILES, goScore, levelScore, loadoutAt, profileGrade, STRESS, stressRun, tryRun } from '../game/sim/Grading';
import { contextHash, hashString, levelHash } from '../web/public/mob-grade-key.js';

interface Inputs { root: string; statePath?: string }
/** A go: a level (its place in the play order) played by a profile, on its own luck. */
interface Job { index: number; profile: string; seed: number; career: number }
/** One battle of a go: try `t`, or stress probe `probe` at STRESS.ladder[`mid`]. */
type Fight = { key: string; t: number } | { key: string; probe: number; mid: number };
type FightJob = Fight & { go: number; index: number; profile: string; seed: number };
interface FightResult { go: number; key: string; run: BattleRun }
/** A battle a go could need, `depth` results away from being sure it does (0: it does). */
type Wanted = Fight & { depth: number };

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

function runFight(play: PlayEntry[], job: FightJob): BattleRun {
    const profile = PROFILES.find((p) => p.id === job.profile)!;
    const loadout = loadoutAt(play, job.index, profile.spend);
    const config = loopedBattle(play, job.index).config;
    return 't' in job ? tryRun(config, profile.skill, loadout, job.seed, job.t) : stressRun(config, profile.skill, loadout, job.seed, job.probe, job.mid);
}

/**
 * Where a go's battles stand (`runs`: those back, by key): the go itself when it's settled, else the battles it could
 * still need, each with its depth. The same steps as Grading's playGo: tries until a win (at most MAX_TRIES), then, won
 * first time, the stress probes' binary search.
 */
function plan(runs: Map<string, BattleRun>): { go?: Go; wanted: Wanted[] } {
    const wanted: Wanted[] = [];
    // The probes from (probe, lo, hi) on, either way each could go.
    const probes = (probe: number, lo: number, hi: number, depth: number): void => {
        if (probe >= STRESS.probes || lo >= hi) return;
        const mid = Math.floor((lo + hi) / 2);
        wanted.push({ key: `s${probe}:${mid}`, probe, mid, depth });
        probes(probe + 1, mid + 1, hi, depth + 1);
        probes(probe + 1, lo, mid, depth + 1);
    };
    const tries: BattleRun[] = [];
    let wonAt = -1;
    while (tries.length < MAX_TRIES) {
        const run = runs.get(`t${tries.length}`);
        if (!run) break;
        tries.push(run);
        if (run.won) {
            wonAt = tries.length - 1;
            break;
        }
    }
    if (wonAt < 0 && tries.length < MAX_TRIES) {
        for (let t = tries.length; t < MAX_TRIES; t++) wanted.push({ key: `t${t}`, t, depth: t - tries.length });
        // Won first time (not known yet): the probes come next.
        if (tries.length === 0) probes(0, 0, STRESS.ladder.length, 1);
        return { wanted };
    }
    if (wonAt !== 0) return { go: { tries, stress: null, score: goScore(tries, null) }, wanted };
    let lo = 0;
    let hi = STRESS.ladder.length;
    let probe = 0;
    for (; probe < STRESS.probes && lo < hi; probe++) {
        const mid = Math.floor((lo + hi) / 2);
        const run = runs.get(`s${probe}:${mid}`);
        if (!run) break;
        if (run.won) lo = mid + 1;
        else hi = mid;
    }
    if (probe >= STRESS.probes || lo >= hi) return { go: { tries, stress: lo, score: goScore(tries, lo) }, wanted };
    probes(probe, lo, hi, 0);
    return { wanted };
}

if (!isMainThread) {
    // A worker: plays the battles it's sent.
    const { play } = load(workerData as Inputs);
    parentPort!.on('message', (job: FightJob) => parentPort!.postMessage({ go: job.go, key: job.key, run: runFight(play, job) } satisfies FightResult));
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
    const named = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && ['--root', '--state', '--careers', '--workers', '--profiles', '--grader-hash'].includes(args[i - 1])));
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
    // Who plays a level: a profile with an `upTo` only the levels before it (in the play order).
    const profilesAt = (index: number) => profiles.filter((profile) => profile.upTo === undefined || index < profile.upTo);
    const graderHash = option('--grader-hash') ?? '';
    const gradesFile = path.join(inputs.root, 'ui', 'grades.json');
    // --changed (all levels asked for): only those whose grade is missing or out of date.
    const playedCount = levels.length;
    if (args.includes('--changed') && !named.length) {
        let stored: Record<string, StoredGrade> = {};
        try {
            stored = JSON.parse(fs.readFileSync(gradesFile, 'utf8')).levels ?? {};
        } catch {
            // None yet: every level.
        }
        const upToDate = (id: string, index: number): boolean => {
            const grade = stored[id];
            return !!grade && grade.index === index && grade.levelHash === levelHash(play[index].config)
                && grade.contextHash === contextHash(index, play.slice(0, index).map((e) => e.config), settings)
                && (!graderHash || grade.graderHash === graderHash);
        };
        const changed = levels.filter(({ id, index }) => !upToDate(id, index));
        levels.splice(0, levels.length, ...changed);
        if (!json) console.log(`${playedCount - changed.length} level(s) up to date, ${changed.length} to grade.`);
    }
    const jobs: Job[] = [];
    for (const { id, index } of levels) {
        for (const profile of profilesAt(index)) for (let c = 0; c < careers; c++) jobs.push({ index, profile: profile.id, seed: parseInt(hashString(`${id}:${profile.id}:${c}`), 16), career: c });
    }
    const total = jobs.length;
    say({ type: 'start', total, levels: levels.map((l) => l.id) });
    if (!json) console.log(`Grading ${levels.length} level(s): ${profiles.length} profiles x ${careers} goes each, on ${workers} threads…`);

    const goes = new Map<string, Go[]>();
    const left = new Map(levels.map((l) => [l.index, profilesAt(l.index).length * careers]));
    const save = !args.includes('--no-save');
    const summary: string[] = [];
    let done = 0;

    /** A level's last job back: its grade, saved. */
    const finishLevel = (index: number): void => {
        const entry = play[index];
        const config = loopedBattle(play, index).config;
        const grades = profilesAt(index).map((profile) => profileGrade(profile.id, loadoutAt(play, index, profile.spend), goes.get(`${index}:${profile.id}`) ?? []));
        const score = Math.round(levelScore(grades));
        const grade = {
            index,
            levelHash: levelHash(entry.config),
            contextHash: contextHash(index, play.slice(0, index).map((e) => e.config), settings),
            graderHash,
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
        const gos = jobs.map((job) => ({ job, runs: new Map<string, BattleRun>(), started: new Set<string>(), running: new Set<string>(), wanted: plan(new Map()).wanted, done: false }));
        let open = 0;
        let settled = 0;
        // Battles still playing for goes already settled (their threads are busy till they're back).
        let orphans = 0;
        /** Threads playing battles not sure to be needed: those may only take the threads beyond one per unsettled go
         *  (each of those needs one at any moment: else a sure battle waits behind a maybe). */
        const playingMaybes = (): number => {
            let n = orphans;
            for (let g = open; g < gos.length; g++) {
                const go = gos[g];
                if (go.done || !go.running.size) continue;
                for (const key of go.running) if (go.wanted.find((w) => w.key === key)?.depth !== 0) n++;
            }
            return n;
        };
        const idle: Worker[] = [];
        const pool: Worker[] = [];
        /** The battle to play next: the least deep one any go wants (the oldest go's first), not started yet. */
        const pick = (): FightJob | null => {
            while (open < gos.length && gos[open].done) open++;
            let best: Wanted | null = null;
            let bestGo = -1;
            for (let g = open; g < gos.length; g++) {
                const go = gos[g];
                if (go.done) continue;
                for (const want of go.wanted) {
                    if (go.started.has(want.key) || (best && want.depth >= best.depth)) continue;
                    best = want;
                    bestGo = g;
                }
                if (best?.depth === 0) break;
            }
            if (!best) return null;
            if (best.depth > 0 && playingMaybes() >= workers - (gos.length - settled)) return null;
            const go = gos[bestGo];
            go.started.add(best.key);
            go.running.add(best.key);
            const { depth: _depth, ...fight } = best;
            return { ...fight, go: bestGo, index: go.job.index, profile: go.job.profile, seed: go.job.seed };
        };
        const pump = (): void => {
            while (idle.length) {
                const job = pick();
                if (!job) break;
                idle.pop()!.postMessage(job);
            }
        };
        if (!jobs.length) return resolve();
        for (let w = 0; w < Math.min(workers, jobs.length * MAX_TRIES); w++) {
            const worker = new Worker(__filename, { workerData: inputs });
            worker.on('message', ({ go: g, key, run }: FightResult) => {
                idle.push(worker);
                const go = gos[g];
                go.running.delete(key);
                if (go.done) orphans--;
                else {
                    go.runs.set(key, run);
                    const now = plan(go.runs);
                    go.wanted = now.wanted;
                    if (now.go) {
                        go.done = true;
                        orphans += go.running.size;
                        settled++;
                        done++;
                        const at = `${go.job.index}:${go.job.profile}`;
                        // In career order, however they finish (so the saved goes don't shuffle from run to run).
                        const list = goes.get(at) ?? [];
                        list[go.job.career] = now.go;
                        goes.set(at, list);
                        say({ type: 'progress', done, total });
                        const remaining = left.get(go.job.index)! - 1;
                        left.set(go.job.index, remaining);
                        if (remaining === 0) finishLevel(go.job.index);
                        if (settled === gos.length) {
                            pool.forEach((w) => w.terminate());
                            return resolve();
                        }
                    }
                }
                pump();
            });
            worker.on('error', reject);
            pool.push(worker);
            idle.push(worker);
        }
        pump();
    });
    if (save) {
        // (A dated copy only when every level was graded this time.)
        const written = writeReport(inputs.root, play, settings, gradesFile, { full: !named.length && levels.length === playedCount, careers });
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
    /** The grading algorithm that made it (grade-run.mjs). */
    graderHash?: string;
    score: number;
    at: string;
    profiles: { id: string; score: number; firstWin: number; never: number; tries: number | null }[];
}
