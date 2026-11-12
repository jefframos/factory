// Grading.ts
//
// A level's difficulty, 0 (anyone wins it first go) to 100 (most players never do), from robot players (Robot.ts)
// playing it where it is in the game:
//
// - Profiles: a skill (how well they play) and how much of their coins they spend on upgrades. A level's grade is
//   all of theirs, weighted (PROFILES' `weight`: the average players count most).
// - What they have by then: everyone's coins at a level are the start coins plus the rewards of every level before it
//   (as if each was won), and the cards of every house before it. Each profile spends its share of those, the
//   cheapest next level first (the cannon's three upgrades, and the cards it has), as a player buying what they can
//   afford would: so the same level is graded harder early in the game, easier late, and moving it changes its grade.
// - A go: battles until a win, each loss making the next try easier exactly as the game does (settings.json `retry`),
//   up to the most it eases (8 tries at 10% a try up to 70%). Won the first time: 0..35 by how much harder the level
//   would have to be before it lost (the stress test: STRESS, the reds coming faster and the buildings tougher, as the
//   retry easing in reverse; mostly that, a little how close the reds came); won on a later try: 35 up to 95 the more
//   tries it took; never: 100. (Without the stress test every easy level would score about the same, whatever you
//   changed, since everyone wins it first go.)
// - Each profile has several goes (`careers`, each with its own luck), averaged.

import { Battle } from '../battle/Battle';
import { BattleConfig, RETRY_EASE, UPGRADES, UpgradeKind, easedConfig, useField } from '../data/MobConfig';
import { PlayEntry, loopedBattle } from '../data/LevelList';
import { CARD_KINDS, CardKind, SETTINGS, storyCardsBy } from '../data/Settings';
import { Robot, RobotCard, Skill } from './Robot';

export const SKILLS: Record<'pro' | 'average' | 'casual' | 'newbie', Skill> = {
    pro: { id: 'pro', name: 'Pro', think: 0.08, aimNoise: 0.05, dragSpeed: 40, sight: 1, planning: 1, replan: 1.2, coverage: 1, slack: 1, cardDelay: 0, cardForget: 0, burst: false, wander: 0 },
    average: { id: 'average', name: 'Average', think: 0.35, aimNoise: 0.45, dragSpeed: 16, sight: 0.65, planning: 0.6, replan: 2.5, coverage: 0.6, slack: 0.4, cardDelay: 2, cardForget: 0.1, burst: false, wander: 0.04 },
    casual: { id: 'casual', name: 'Casual', think: 0.55, aimNoise: 0.8, dragSpeed: 11, sight: 0.45, planning: 0.3, replan: 3.5, coverage: 0.3, slack: 0.1, cardDelay: 4, cardForget: 0.25, burst: false, wander: 0.1 },
    newbie: { id: 'newbie', name: 'Newbie', think: 0.8, aimNoise: 1.2, dragSpeed: 8, sight: 0.3, planning: 0, replan: 4, coverage: 0, slack: 0, cardDelay: 7, cardForget: 0.45, burst: false, wander: 0.18 },
};

export interface Profile {
    id: string;
    name: string;
    skill: Skill;
    /** The share of their coins they spend on upgrades (0: none, 1: all). */
    spend: number;
    /** How much they count towards a level's grade. */
    weight: number;
    /** Only played on the levels before this one in the play order (a newbie doesn't get further): the rest are graded
     *  without them, the others' weights sharing the grade. */
    upTo?: number;
}

export const PROFILES: Profile[] = [
    { id: 'pro', name: 'Pro, upgrades everything', skill: SKILLS.pro, spend: 1, weight: 0.1 },
    { id: 'pro-raw', name: 'Pro, never upgrades', skill: SKILLS.pro, spend: 0, weight: 0.1 },
    { id: 'average', name: 'Average, upgrades everything', skill: SKILLS.average, spend: 1, weight: 0.3 },
    { id: 'average-raw', name: 'Average, never upgrades', skill: SKILLS.average, spend: 0, weight: 0.2 },
    { id: 'casual', name: 'Casual, spends half', skill: SKILLS.casual, spend: 0.5, weight: 0.2 },
    { id: 'newbie', name: 'Newbie, never upgrades', skill: SKILLS.newbie, spend: 0, weight: 0.1, upTo: 10 },
];

/** A quick grade's profiles (the default: about half the time): the players most like the real ones. A complete grade
 *  (`--complete`) plays all of PROFILES. */
export const QUICK_PROFILES = ['average', 'casual', 'newbie'];

/** What a profile has at a level: its coins by then, what it spent, its upgrades' levels and its cards'. */
export interface Loadout {
    coins: number;
    spent: number;
    fire: number;
    capacity: number;
    recharge: number;
    cards: Partial<Record<CardKind, number>>;
}

/** A profile's loadout at battle `index`: everything before it won, `spend` of the coins spent cheapest first. */
export function loadoutAt(play: readonly PlayEntry[], index: number, spend: number): Loadout {
    let coins = SETTINGS.startCoins;
    const owned = new Set<CardKind>();
    for (let k = 0; k < index; k++) {
        const config = loopedBattle(play, k).config;
        coins += config.reward;
    }
    // The story's cards, as its wins give them (STORY_CARDS): `index` levels won by battle `index`.
    for (const kind of storyCardsBy(index)) owned.add(kind);
    const levels: Record<UpgradeKind, number> = { fire: 1, capacity: 1, recharge: 1 };
    const cards: Partial<Record<CardKind, number>> = Object.fromEntries([...owned].map((kind) => [kind, 1]));
    let budget = Math.floor(coins * Math.max(0, Math.min(1, spend)));
    let spent = 0;
    for (;;) {
        let best: { cost: number; buy: () => void } | null = null;
        for (const kind of ['fire', 'capacity', 'recharge'] as UpgradeKind[]) {
            const upgrade = UPGRADES[kind];
            if (levels[kind] >= upgrade.max) continue;
            const cost = upgrade.cost[levels[kind] - 1];
            if (cost !== undefined && cost <= budget && (!best || cost < best.cost)) best = { cost, buy: () => { levels[kind]++; } };
        }
        // (The cards' levels cost gems, not coins: a career's cards stay at level 1.)
        if (!best) break;
        best.buy();
        budget -= best.cost;
        spent += best.cost;
    }
    return { coins, spent, ...levels, cards };
}

/** One battle: how it went. */
export interface BattleRun {
    won: boolean;
    /** Seconds it lasted. */
    time: number;
    /** How close the reds came to the line (0..1, Battle.danger's peak). */
    danger: number;
    /** The buildings' hits left, as a share (0 when won). */
    left: number;
}

/** The fixed step (the game's), and how long a battle may go on before it counts as lost (a stalemate). */
const STEP = 1 / 60;
const MAX_SECONDS = 150;

/** A seeded random (mulberry32): the same seed, the same battle. */
export function seeded(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Plays `config` once with `skill` and `loadout`, on the luck `seed` gives (Battle's Math.random too). */
export function playBattle(config: BattleConfig, skill: Skill, loadout: Loadout, seed: number): BattleRun {
    const random = seeded(seed);
    const before = Math.random;
    Math.random = random;
    try {
        useField(config);
        const battle = new Battle(config, {});
        // Nobody's looking: no turning to face the way they go (it changes nothing else).
        battle.faces = false;
        battle.fireLevel = loadout.fire;
        battle.capacityLevel = loadout.capacity;
        battle.rechargeLevel = loadout.recharge;
        const cards: RobotCard[] = CARD_KINDS.filter((kind) => loadout.cards[kind] !== undefined).map((kind) => ({ kind, level: loadout.cards[kind]! }));
        const robot = new Robot(battle, skill, cards, seeded(seed ^ 0x9e3779b9));
        let danger = 0;
        while (battle.state === 'playing' && battle.time < MAX_SECONDS) {
            robot.step(STEP);
            battle.step(STEP);
            if (battle.danger > danger) danger = battle.danger;
        }
        const won = battle.state === 'won';
        return { won, time: Math.round(battle.time * 10) / 10, danger: won ? danger : 1, left: battle.baseHp / Math.max(1, battle.baseHpMax) };
    } finally {
        Math.random = before;
    }
}

/** The stress test: how much harder a level won first go gets (x the red rates, / the red giants' gap, the buildings'
 *  hits x its square root), step by step; the robot replays it at these (a binary search: `probes` plays) to find the first it
 *  loses. Surviving them all: no stress score at all. `danger`: the share of the first-go score from how close the reds
 *  came, the rest from the stress. */
export const STRESS = { ladder: [1.15, 1.35, 1.6, 1.9, 2.25, 2.7, 3.2, 3.8, 4.5, 5.4, 6.5, 8], probes: 4, danger: 0.25 };

/** A level made `factor` times harder (the retry easing turned round). */
export function harderConfig(config: BattleConfig, factor: number): BattleConfig {
    return {
        ...config,
        redRate: config.redRate * factor,
        redRateEnd: config.redRateEnd * factor,
        redGiantEvery: config.redGiantEvery ? config.redGiantEvery / factor : config.redGiantEvery,
        // The buildings by less (its square root), or the hardest steps would play for minutes.
        baseHp: Math.ceil(config.baseHp * Math.sqrt(factor)),
        targets: config.targets?.map((target) => ({ ...target, hp: Math.ceil(target.hp * Math.sqrt(factor)) })),
    };
}

/** A stress probe on its own: probe number `probe` (its luck) at STRESS.ladder[`mid`]. The grader can play these in
 *  parallel ahead of the binary search (grade-levels.ts), so this is the one place a probe's battle is defined. */
export function stressRun(config: BattleConfig, skill: Skill, loadout: Loadout, seed: number, probe: number, mid: number): BattleRun {
    return playBattle(harderConfig(config, STRESS.ladder[mid]), skill, loadout, seed * 17 + probe * 104729 + 1);
}

/** How many of STRESS.ladder's steps a go won first time survives (0 .. ladder length), by binary search. */
function stressSteps(config: BattleConfig, skill: Skill, loadout: Loadout, seed: number): number {
    // The first step lost is in [lo, hi] (hi = length: none lost).
    let lo = 0;
    let hi = STRESS.ladder.length;
    for (let probe = 0; probe < STRESS.probes && lo < hi; probe++) {
        const mid = Math.floor((lo + hi) / 2);
        const run = stressRun(config, skill, loadout, seed, probe, mid);
        if (run.won) lo = mid + 1;
        else hi = mid;
    }
    return lo;
}

/** The most tries a go has: one plain, then one for each easing step up to the most (8 at 10% up to 70%). */
export const MAX_TRIES = Math.round(RETRY_EASE.most / Math.max(0.01, RETRY_EASE.step)) + 1;

/** A profile's go at a level: its tries (until a win), and the go's grade. */
export interface Go {
    tries: BattleRun[];
    /** Won first go: how many stress steps it survived (STRESS.ladder; null: not tested). */
    stress: number | null;
    score: number;
}

/** Try `t` of a go on its own (each eased a step more than the last); like stressRun, for playing them in parallel. */
export function tryRun(config: BattleConfig, skill: Skill, loadout: Loadout, seed: number, t: number): BattleRun {
    return playBattle(easedConfig(config, Math.min(RETRY_EASE.most, t * RETRY_EASE.step)), skill, loadout, seed * 31 + t * 7919);
}

/** Tries until a win (each loss easier, as the game does), at most MAX_TRIES. */
export function playGo(config: BattleConfig, skill: Skill, loadout: Loadout, seed: number): Go {
    const tries: BattleRun[] = [];
    for (let t = 0; t < MAX_TRIES; t++) {
        const run = tryRun(config, skill, loadout, seed, t);
        tries.push(run);
        if (run.won) break;
    }
    const stress = tries.length === 1 && tries[0].won ? stressSteps(config, skill, loadout, seed) : null;
    return { tries, stress, score: goScore(tries, stress) };
}

/** A go's grade (see the top). */
export function goScore(tries: readonly BattleRun[], stress: number | null = null): number {
    const last = tries[tries.length - 1];
    if (!last?.won) return 100;
    if (tries.length === 1) {
        if (stress === null) return 35 * last.danger;
        const tight = 1 - stress / STRESS.ladder.length;
        return 35 * (STRESS.danger * last.danger + (1 - STRESS.danger) * tight);
    }
    return 35 + 60 * ((tries.length - 1) / MAX_TRIES);
}

/** A profile's grade at a level: its goes', averaged; and how they went. */
export interface ProfileGrade {
    id: string;
    score: number;
    /** Goes won the first time, and goes never won, as shares. */
    firstWin: number;
    never: number;
    /** Tries a won go took, on average (NaN: none won). */
    tries: number;
    loadout: Loadout;
    goes: Go[];
}

export function profileGrade(id: string, loadout: Loadout, goes: Go[]): ProfileGrade {
    const won = goes.filter((go) => go.tries[go.tries.length - 1]?.won);
    return {
        id,
        score: goes.reduce((sum, go) => sum + go.score, 0) / Math.max(1, goes.length),
        firstWin: goes.filter((go) => go.tries.length === 1 && go.tries[0].won).length / Math.max(1, goes.length),
        never: (goes.length - won.length) / Math.max(1, goes.length),
        tries: won.length ? won.reduce((sum, go) => sum + go.tries.length, 0) / won.length : NaN,
        loadout,
        goes,
    };
}

/** The level's grade: its profiles', weighted. */
export function levelScore(grades: readonly ProfileGrade[]): number {
    let sum = 0;
    let weights = 0;
    for (const grade of grades) {
        const weight = PROFILES.find((profile) => profile.id === grade.id)?.weight ?? 0;
        sum += grade.score * weight;
        weights += weight;
    }
    return weights ? sum / weights : 0;
}
