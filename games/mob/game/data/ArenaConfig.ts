// ArenaConfig.ts
//
// The arena mode (a fake multiplayer match: you against a robot, game/sim/DuelRobot): an arena is one file in
// games/mob/arenas/<id>.json (the editor's Arena tab), and it describes the player's half of the field — the gates,
// walls, houses, barriers, spinners… as a level has them, and where the player's towers stand. The enemy's half is the
// same, mirrored across the middle of the field (arenaBattle): its gates and houses work for the reds, coming down.
//
// Each side has its cannon (it has life: `cannonHp`, hit on the cannon itself, but only once all its towers have fallen:
// till then it's shielded) a little up the field (`cannonZ`), sliding `cannonRange` either way, and its towers behind it
// (`targets`: where each stands; `towerHp` each). The side behind can boost its cannon now and then (`boost*`). The
// match lasts `seconds`; a side whose cannon falls, or all of whose buildings do, loses at once, else when the time's up
// the side with more life left wins (equal: a draw).
//
// No Vite here (the headless match simulator bundles it for node): the files are loaded by Arenas.ts.

import { BattleConfig, GateConfig, GrinderConfig, HelmetConfig, ObstacleConfig, PadConfig, PipeConfig, PusherConfig, SpinnerConfig, TargetConfig } from './MobConfig';

export interface ArenaConfig {
    name: string;
    /** Its look (a Themes id): the beach when unset. */
    theme?: string;
    /** It opens once the player reaches this story level (1-based; unset: from the start). */
    unlockAt?: number;
    /** The whole field (both halves): 10 x 30 when unset. */
    width?: number;
    length?: number;
    /** The match's length (seconds). */
    seconds?: number;
    /** Each tower's life, and the cannon's. */
    towerHp?: number;
    cannonHp?: number;
    /** The player's cannon: its row (z: negative is up the field, in front of the towers), how far it slides either way
     *  from the middle, and how wide it is to the reds (its life is hit there, following it). */
    cannonZ?: number;
    cannonRange?: number;
    cannonWidth?: number;
    /** The player's towers: each one's middle across (x), its front (z, the line the reds hit) and width; `hp` its own
     *  life (unset: towerHp). Unset: one each side, at the back. */
    targets?: { x: number; z?: number; width?: number; hp?: number }[];
    /** How the enemy's half is made from the player's: 'vertical' (mirrored across the middle line: each piece in front of
     *  its copy) or 'both' (and left for right: turned half a turn, so a big gate on one side faces the other side's).
     *  Unset: vertical. */
    mirror?: 'vertical' | 'both';
    /** The comeback boost (BOOST in ARENA_RULES): fire rate times `boostRate` for `boostSeconds`, every `boostCooldown`
     *  seconds at most, for the side behind by `boostBehind` of its starting life. */
    boostRate?: number;
    boostSeconds?: number;
    boostCooldown?: number;
    boostBehind?: number;
    /** The player's half (z from the cannon, 0, up to the middle, -length/2), as a level has it. */
    gates?: GateConfig[];
    obstacles?: ObstacleConfig[];
    spinners?: SpinnerConfig[];
    pushers?: PusherConfig[];
    pads?: PadConfig[];
    helmets?: HelmetConfig[];
    pipes?: PipeConfig[];
    grinders?: GrinderConfig[];
}

/** An arena's defaults (ARENA_RULES): the field, the match, the buildings. */
export const ARENA_RULES = {
    width: 10,
    length: 30,
    seconds: 90,
    towerHp: 150,
    cannonHp: 300,
    /** The towers (unset in an arena): each `width` wide, `inset` in from the side (to its middle), their front `towerZ`. */
    tower: { width: 2, inset: 1 },
    towerZ: -0.4,
    /** The cannon (unset in an arena): its row, up the field in front of the towers; its width to the reds; it slides as
     *  far as a level's does (`margin` short of the field's side). */
    cannonZ: -2.4,
    cannonWidth: 1.8,
    cannonMargin: 0.8,
    /** A cannon's life is hit this far in front of its row (its muzzle's side). */
    cannonFront: 0.6,
    boost: { rate: 1.6, seconds: 6, cooldown: 20, behind: 0.08 },
    /** Gates the whole field can have (a mob remembers the ones it's crossed in 8 bits): half for each side. */
    mostGates: 4,
};

/** The arena's field size and rules, its own or the defaults. */
export function arenaRules(arena: ArenaConfig): { width: number; length: number; seconds: number; towerHp: number; cannonHp: number } {
    return {
        width: arena.width ?? ARENA_RULES.width,
        length: arena.length ?? ARENA_RULES.length,
        seconds: arena.seconds ?? ARENA_RULES.seconds,
        towerHp: arena.towerHp ?? ARENA_RULES.towerHp,
        cannonHp: arena.cannonHp ?? ARENA_RULES.cannonHp,
    };
}

/** The player's towers: the arena's, or one each side at the back. */
export function arenaTowers(arena: ArenaConfig): { x: number; z: number; width: number; hp: number }[] {
    const { width, towerHp } = arenaRules(arena);
    const towerX = width / 2 - ARENA_RULES.tower.inset;
    const towers = arena.targets ?? [{ x: -towerX }, { x: towerX }];
    return towers.map((t) => ({ x: t.x, z: t.z ?? ARENA_RULES.towerZ, width: t.width ?? ARENA_RULES.tower.width, hp: t.hp ?? towerHp }));
}

/** The player's cannon: its row (z), its slide either way, its width. */
export function arenaCannon(arena: ArenaConfig): { z: number; range: number; width: number } {
    const { width } = arenaRules(arena);
    return {
        z: arena.cannonZ ?? ARENA_RULES.cannonZ,
        range: Math.max(0, Math.min(width / 2 - 0.5, arena.cannonRange ?? width / 2 - ARENA_RULES.cannonMargin)),
        width: arena.cannonWidth ?? ARENA_RULES.cannonWidth,
    };
}

/** The player's buildings (the reds' aim): its towers, and its cannon's life (on the cannon: the battle moves it). */
export function ownBuildings(arena: ArenaConfig): TargetConfig[] {
    const { cannonHp } = arenaRules(arena);
    const cannon = arenaCannon(arena);
    return [
        ...arenaTowers(arena),
        { x: 0, z: cannon.z - ARENA_RULES.cannonFront, width: cannon.width, hp: cannonHp, kind: 'cannon' },
    ];
}

/** How far each cannon slides from the middle. */
export function arenaCannonRange(arena: ArenaConfig): number {
    return arenaCannon(arena).range;
}

const flip = <T extends { team?: 'blue' | 'red' }>(team: T['team']): 'blue' | 'red' => (team === 'red' ? 'blue' : 'red');

/**
 * The match's battle: the arena's half as the blues' (whatever's on it set to theirs), and its mirror across the middle
 * (z' = -length - z) as the reds' — gates, houses, barriers and pipes working for the reds, the rest shared. The reds'
 * buildings are `targets` (the blues' aim, as in a level), the blues' `blueTargets`.
 */
export function arenaBattle(arena: ArenaConfig): BattleConfig {
    const { width, length, seconds } = arenaRules(arena);
    const m = (z: number): number => -length - z;
    // Both ways: left for right too (half a turn round the field's middle).
    const both = arena.mirror === 'both';
    const mx = (x: number): number => (both ? -x : x);
    const own = <T extends { team?: 'blue' | 'red' }>(item: T): T => ({ ...item, team: item.team ?? 'blue' });
    const mirror = <T extends { x: number; z: number; team?: 'blue' | 'red' }>(item: T): T => ({ ...item, x: mx(item.x), z: m(item.z), team: flip<T>(item.team ?? 'blue') });
    const gates = (arena.gates ?? []).slice(0, ARENA_RULES.mostGates);
    const obstacles = arena.obstacles ?? [];
    const spinners = arena.spinners ?? [];
    const grinders = arena.grinders ?? [];
    const buildings = ownBuildings(arena);
    return {
        name: arena.name,
        kind: 'Arena',
        width,
        length,
        // (A swinging gate swings the other way when turned, so its copy keeps pace with it mirrored.)
        gates: [...gates.map(own), ...gates.map((gate) => ({ ...mirror(gate), ...(gate.swing && both ? { swing: { ...gate.swing, range: -gate.swing.range } } : {}) }))],
        obstacles: [
            ...obstacles,
            ...obstacles.map((o): ObstacleConfig => ({
                ...o,
                // (Mirrored one way, a polygon's corners run the other way round: put back. Turned, they don't.)
                ...(o.points
                    ? { points: both ? o.points.map(([x, z]) => [mx(x), m(z)] as [number, number]) : o.points.map(([x, z]) => [x, m(z)] as [number, number]).reverse() }
                    : { x: mx(o.x ?? 0), z: m(o.z ?? 0) }),
            })),
        ],
        // A mirrored spinner turns the other way, from half a turn on (its arms mirrored as it goes).
        // (Turned: a spinner the same way half a turn on, a pusher half a swing on.)
        spinners: [...spinners, ...spinners.map((s) => (both
            ? { ...s, x: mx(s.x), z: m(s.z), phase: (s.phase ?? 0) + 0.5 }
            : { ...s, z: m(s.z), speed: -s.speed, phase: 0.5 - (s.phase ?? 0) }))],
        pushers: [...(arena.pushers ?? []), ...(arena.pushers ?? []).map((p) => ({ ...p, x: mx(p.x), z: m(p.z), ...(both ? { phase: (p.phase ?? 0) + 0.5 } : {}) }))],
        pads: [...(arena.pads ?? []).map(own), ...(arena.pads ?? []).map((pad) => mirror(pad))],
        helmets: [...(arena.helmets ?? []).map(own), ...(arena.helmets ?? []).map((h) => mirror(h))],
        // A pipe keeps its team (blue: blues only), its mirror the other side's (red); a purple one stays both.
        pipes: [
            ...(arena.pipes ?? []).map((p): PipeConfig => ({ ...p, team: p.team ?? 'blue' })),
            ...(arena.pipes ?? []).map((p): PipeConfig => ({ ...p, x: mx(p.x), toX: mx(p.toX), z: m(p.z), toZ: m(p.toZ), team: (p.team ?? 'blue') === 'both' ? 'both' : p.team === 'red' ? 'blue' : 'red' })),
        ],
        // A rolling one rolls the other way (its swing mirrored).
        grinders: [...grinders, ...grinders.map((g) => ({ ...g, x: mx(g.x), z: m(g.z), ...(g.move ? { move: { ...g.move, range: g.axis === 'x' || both ? -g.move.range : g.move.range } } : {}) }))],
        redRate: 0,
        redRateEnd: 0,
        redRamp: 1,
        baseHp: 0,
        reward: 0,
        targets: buildings.map((b) => ({ ...b, x: mx(b.x), z: m(b.z!) })),
        blueTargets: buildings,
        duel: {
            seconds, cannonRange: arenaCannonRange(arena), cannonZ: arenaCannon(arena).z,
            boost: {
                rate: arena.boostRate ?? ARENA_RULES.boost.rate, seconds: arena.boostSeconds ?? ARENA_RULES.boost.seconds,
                cooldown: arena.boostCooldown ?? ARENA_RULES.boost.cooldown, behind: arena.boostBehind ?? ARENA_RULES.boost.behind,
            },
        },
    };
}
