// WallConfig.ts
//
// The game's tuning (ui/wall.json), typed, and what follows from it: a wall by its number, the damage and the price of a
// PUNCH HARDER level, the tool in hand, the crew's prices and the boosts.

import data from '../../ui/wall.json';
import type { HoldPose, SwingSettings } from '../player/swing';

export type MaterialLook = 'concrete' | 'brick' | 'stone' | 'iron' | 'veins' | 'stripes' | 'circuit' | 'boxes' | 'planks' | 'gate';
export type HitSound = 'soft' | 'wood' | 'stone' | 'metal' | 'glass';

export interface MaterialDef {
    name: string;
    look: MaterialLook;
    colors: string[];
    core: string[];
    dust: string;
    chip: number;
    hit: HitSound;
    cash?: number;
    /** The colour of what's round it, and of the lights on its gate. */
    room: string;
    accent: string;
    /** Round again after the last one: its colours turned this much round the wheel (0 to 1). */
    hue?: number;
}

/** A tool in hand: a type of it in a colour (`base`: fists, or the type's id; `tint`, `glow`: its metal). */
export interface ToolDef {
    id: string;
    base: string;
    name: string;
    bite: { wide: number; deep: number };
    model?: string;
    tint?: string;
    glow?: number;
    hold?: HoldPose;
    swing?: SwingSettings;
}

export interface CrewDef {
    id: string;
    name: string;
    plural: string;
    wall: number;
    cost: number;
    dps: number;
    every: number;
    size: number;
    z: number;
    style: 'leap' | 'throw';
    shows: number;
}

/** What owning a boost does. */
export interface BoostEffect {
    /** Times one of the crew's damage (`crewId`), or all of it (`crew`). */
    crewId?: string;
    crew?: number;
    /** Times a hit's damage; a share of the crew's damage a second added to each hit. */
    punch?: number;
    punchFromCrew?: number;
    cash?: number;
    weak?: number;
    /** More combo steps. */
    combo?: number;
}

export interface BoostDef {
    id: string;
    title: string;
    /** What it makes better, and how much. */
    what: string;
    value: string;
    icon: string;
    /** There from this wall, or this many copies of one of the crew. */
    wall?: number;
    crew?: string;
    count?: number;
    bricks: number;
    effect: BoostEffect;
}

export const WALL = data.wall;
export const CAMERA = data.camera;
const MATERIALS = data.materials as unknown as Record<string, MaterialDef>;
/** The types of tool (not the fists). */
export const TOOL_TYPES = data.tools.types as unknown as (Omit<ToolDef, 'base'> & { model: string })[];
export const FISTS: ToolDef = { id: 'fists', base: 'fists', name: 'Fists', bite: data.tools.fists.bite };
const PUNCH = data.punch;
export const CASH = data.cash;
export const CREW = data.crew as unknown as CrewDef[];
export const WEAK = data.weak;
export const MEDAL = data.medal;
export const SHOWS = data.shows;
export const REWIND = data.rewind;

/** A kind of enemy. */
export interface EnemyKind {
    name: string;
    model: string;
    height: number;
    float?: number;
    pace?: number;
    tint?: number;
    /** Its colours this much brighter. */
    bright?: number;
    /** The biggest it gets (a boss). */
    most?: number;
    /** How it takes another colour: its bones only, or all of it turned to another hue (`base`: its own; `sat`: at least this vivid). */
    paint?: 'bone' | 'hue';
    base?: number;
    sat?: number;
    /** The colour it's in, if it's not its own (bossAt says). */
    coat?: Coat;
    /** Two of them: where each stands, and how many colours on. */
    pair?: EnemyKind[];
    x?: number;
    next?: number;
}

/** A colour over an enemy's own. */
export interface Coat {
    how: 'bone' | 'hue';
    hue: number;
    base: number;
    sat: number;
    dark: number;
}

const kindOf = (kind: Record<string, unknown>): EnemyKind => ({ ...(kind as unknown as EnemyKind), tint: kind.tint ? Number(`0x${String(kind.tint).slice(1)}`) : undefined });
export const ENEMIES = data.enemies;
const BOSSES = (data.enemies.boss.kinds as Record<string, unknown>[]).map(kindOf);
const MINIONS = (data.enemies.minions.kinds as Record<string, unknown>[]).map(kindOf);
const ENEMIES_KEY = 'wall.debug.enemies';

/** Enemies and bosses at all: the config's, or tried the other way (?enemies=0 or 1, the debug panel's switch). */
export const enemiesOn: boolean = (() => {
    try {
        const asked = /[?&]enemies=([01])/.exec(window.location.search)?.[1] ?? (/[?&](debug|dev)\b/.test(window.location.search) ? localStorage.getItem(ENEMIES_KEY) : null);
        return asked === null || asked === undefined ? data.enemies.on : asked === '1';
    } catch {
        return data.enemies.on;
    }
})();

/** Debug: the other way round, from the next load on. */
export function switchEnemies(): void {
    try {
        localStorage.setItem(ENEMIES_KEY, enemiesOn ? '0' : '1');
    } catch {
        // Not kept, then.
    }
}

export const isBossWall = (n: number): boolean => enemiesOn && n % ENEMIES.boss.every === 0;

/** What waits behind a wall. */
export function fightAt(n: number): 'boss' | 'minions' | undefined {
    if (!enemiesOn) return undefined;
    if (isBossWall(n)) return 'boss';
    const { every, from } = ENEMIES.minions;
    return n >= from && (n - from) % every === 0 ? 'minions' : undefined;
}

/** Which boss a wall's is (from 0). */
export const bossNumber = (n: number): number => Math.max(1, Math.round(n / ENEMIES.boss.every)) - 1;

/** The `i`th boss (from 0), in a run after `rewinds`: the kinds in turn, each bigger than the last, in the next colour every so often. */
export function bossAt(i: number, rewinds: number): EnemyKind {
    const { grow, growRun, colorEvery, colors } = ENEMIES.boss;
    const step = Math.floor(i / colorEvery) + rewinds;
    const kind = BOSSES[(i + rewinds) % BOSSES.length];
    const dressed = (one: EnemyKind): EnemyKind => {
        const { hue, dark = 1 } = colors[(step + (one.next ?? 0)) % colors.length] as { hue?: number; dark?: number };
        const coat = hue === undefined || !one.paint ? undefined : { how: one.paint, hue, base: one.base ?? 0, sat: one.sat ?? 0, dark };
        return { ...one, coat, height: Math.min(one.most ?? Infinity, one.height * (1 + grow * i + growRun * rewinds)) };
    };
    const { name } = colors[step % colors.length];
    return { ...dressed(kind), name: name ? `${name} ${kind.name}` : kind.name, pair: kind.pair?.map(dressed) };
}

export const bossKind = (n: number, rewinds: number): EnemyKind => bossAt(bossNumber(n), rewinds);

/** The minions behind a wall: the kinds in turn, door by door (a boss's are those of the door before it). */
export function minionKind(n: number): EnemyKind {
    let doors = 0;
    for (let wall = 1; wall <= n; wall++) if (fightAt(wall) === 'minions') doors++;
    return MINIONS[Math.max(0, doors - 1) % MINIONS.length];
}

/** The models a kind takes (a pair's are two). */
export const enemyModels = ({ model, pair }: EnemyKind): string[] => pair?.map((one) => one.model) ?? [model];

/** The models what's behind a wall takes (a boss's minions too, in case it gets away); none if there's nothing. */
export function fightModels(n: number, rewinds: number): string[] {
    const kind = fightAt(n);
    if (!kind) return [];
    const minions = enemyModels(minionKind(n));
    return kind === 'boss' ? [...enemyModels(bossKind(n, rewinds)), ...minions] : minions;
}

/** The `n`th wall (from 1): its HP and what it's made of. */
export function wallAt(n: number): { hp: number; material: MaterialDef } {
    const { wallHp, wallMaterials, hpGrowth, roundFrom } = data;
    const last = wallHp[wallHp.length - 1];
    const hp = wallHp[n - 1] ?? last * Math.pow(hpGrowth, n - wallHp.length);
    // (A boss's is always the same: there's no mistaking it.)
    if (isBossWall(n)) return { hp: Math.round(hp), material: MATERIALS[ENEMIES.boss.material] };
    // (Round again without the weakest ones.)
    const over = n - 1 - wallMaterials.length;
    const again = wallMaterials.slice(roundFrom - 1);
    const round = over < 0 ? 0 : Math.floor(over / again.length) + 1;
    const material = MATERIALS[over < 0 ? wallMaterials[n - 1] : again[over % again.length]];
    if (round === 0) return { hp: Math.round(hp), material };
    return { hp: Math.round(hp), material: { ...material, name: `${material.name} ${'+'.repeat(Math.min(5, round))}`, hue: (round * 0.31) % 1 } };
}

/** The PUNCH HARDER level a player has at a wall, given if it hasn't been bought (0: none). */
export const givenLevel = (wall: number): number => data.punch.given.reduce((level, gift) => (wall >= gift.wall ? Math.max(level, gift.level) : level), 0);

/** What a hit does at a PUNCH HARDER level. */
export function punchDamage(level: number): number {
    let damage = PUNCH.damage;
    for (let i = 0; i < level; i++) damage *= punchMult(i);
    return damage;
}

/** What the next PUNCH HARDER level (after `level`) multiplies by, and its price (the first is free). */
export const punchMult = (level: number): number => PUNCH.mult[Math.min(level, PUNCH.mult.length - 1)];
export const punchCost = (level: number): number => (level === 0 ? 0 : Math.round(PUNCH.cost * Math.pow(PUNCH.costGrowth, level - 1)));

/** One more of the crew, with `owned` of them already. */
export const crewCost = (def: CrewDef, owned: number): number => Math.round(def.cost * Math.pow(data.crewGrowth, owned));

/** The medals wall `n` brings as it comes down. */
export const medalsOf = (n: number): number => (n >= MEDAL.wall ? n : 0);

/** The bricks wall `n` brings as it comes down. */
export const bricksOf = (n: number): number => Math.floor(data.bricks.base + data.bricks.perWall * n);

/** Every boost: each of the crew's own, and the others. */
export const BOOSTS: BoostDef[] = [
    ...CREW.flatMap((crew, place) => data.crewBoosts.tiers.map((tier): BoostDef => ({
        id: `${crew.id}-${tier.at}`,
        title: crew.plural.toUpperCase(),
        what: crew.plural.toUpperCase(),
        value: `x${tier.mult} DAMAGE`,
        icon: `Wall_${crew.id}`,
        crew: crew.id,
        count: tier.at,
        bricks: tier.bricks + place * data.crewBoosts.typeBricks,
        effect: { crewId: crew.id, crew: tier.mult },
    }))),
    ...(data.boosts as BoostDef[]),
];

/** The tool a PUNCH HARDER level brings: the types in turn, in the next colour every so often. */
export function toolAt(level: number): ToolDef {
    const { from, perTier, tiers } = data.tools;
    if (level < from) return FISTS;
    const n = level - from;
    const type = TOOL_TYPES[n % TOOL_TYPES.length];
    const place = Math.floor(n / perTier);
    const tier = tiers[Math.min(place, tiers.length - 1)];
    // (Past the last colour it's only better.)
    const plus = Math.max(0, Math.floor((n - perTier * tiers.length) / TOOL_TYPES.length) + (n >= perTier * tiers.length ? 1 : 0));
    return { ...type, id: `${tier.id}-${type.id}${plus ? `-${plus}` : ''}`, base: type.id, name: `${tier.name} ${type.name}${plus ? ` +${plus}` : ''}`, tint: tier.color, glow: tier.glow };
}

/** The level a tool first comes with. */
export function toolLevel(id: string): number {
    const { from, perTier, tiers } = data.tools;
    for (let level = from; level < from + perTier * tiers.length + 200; level++) if (toolAt(level).id === id) return level;
    return 0;
}

/** Every tool had by a level: the fists first, each kind and colour once. */
export function toolsUpTo(level: number): ToolDef[] {
    const { from, perTier, tiers } = data.tools;
    const last = Math.min(level, from + perTier * tiers.length - 1);
    return [FISTS, ...Array.from({ length: Math.max(0, last - from + 1) }, (_, i) => toolAt(from + i))];
}

/** 1234 -> 1.23K: three figures, as few letters as it takes. */
export function short(value: number): string {
    if (value < 1000) return value < 10 && value % 1 ? value.toFixed(1) : String(Math.floor(value));
    const units = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];
    const power = Math.min(units.length - 1, Math.floor(Math.log10(value) / 3));
    const scaled = value / Math.pow(1000, power);
    return `${scaled < 10 ? scaled.toFixed(2) : scaled < 100 ? scaled.toFixed(1) : Math.floor(scaled)}${units[power]}`;
}

/** Seeded random in [0, 1). */
export function seededRandom(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** A number in [0, 1) from whole coordinates: the same every time. */
export function hash(x: number, y: number, z: number, seed: number): number {
    let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 2147483647) ^ Math.imul(seed | 0, 1274126177);
    h = Math.imul(h ^ (h >>> 13), 1103515245);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise in [0, 1]. */
export function noise2(x: number, y: number, seed: number): number {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const sx = (x - x0) ** 2 * (3 - 2 * (x - x0));
    const sy = (y - y0) ** 2 * (3 - 2 * (y - y0));
    const a = hash(x0, y0, 0, seed) * (1 - sx) + hash(x0 + 1, y0, 0, seed) * sx;
    const b = hash(x0, y0 + 1, 0, seed) * (1 - sx) + hash(x0 + 1, y0 + 1, 0, seed) * sx;
    return a * (1 - sy) + b * sy;
}
