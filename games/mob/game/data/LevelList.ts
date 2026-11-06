// LevelList.ts
//
// The play order, with no file loading (so the game, which bundles the JSON with Vite, and the headless tools, which
// read it from disk, share it): the zones in order (ui/zones.json), each zone's levels (levels/<id>.json) in its order.
// After the last level of the last zone it all repeats, a little harder each loop.
//
// A zone is pure looks: its `theme` picks the environment (Themes.ts) a level is drawn in; any level plays in any theme.

import { BattleConfig } from './MobConfig';

export interface ZoneConfig {
    id: string;
    name: string;
    /** The environment its levels are drawn in (Themes.ts: 'beach', 'castle', ...). */
    theme: string;
    /** Level ids (levels/<id>.json), in play order. */
    levels: string[];
}

export interface PlayEntry {
    id: string;
    zone: ZoneConfig;
    config: BattleConfig;
}

/** How much harder each loop through all the levels gets (red rates and base HP). */
const LOOP_HARDER = 0.15;

/** Every zone's levels in order (ids with no file are skipped, with a warning). */
export function buildPlayList(levels: Record<string, BattleConfig>, zones: readonly ZoneConfig[]): PlayEntry[] {
    const list: PlayEntry[] = [];
    for (const zone of zones) {
        for (const id of zone.levels) {
            const config = levels[id];
            if (config) list.push({ id, zone, config });
            else console.warn(`[mob] zone ${zone.id}: no level "${id}"`);
        }
    }
    return list;
}

/** Battle `index` (0-based, counting up forever): its entry, and its config made harder on each loop. */
export function loopedBattle(list: readonly PlayEntry[], index: number): { entry: PlayEntry; config: BattleConfig } {
    const entry = list[((index % list.length) + list.length) % list.length];
    const harder = 1 + Math.floor(index / list.length) * LOOP_HARDER;
    const level = entry.config;
    return {
        entry,
        config: {
            ...level,
            redRate: level.redRate * harder,
            redRateEnd: level.redRateEnd * harder,
            baseHp: Math.round(level.baseHp * harder),
            reward: Math.round(level.reward * harder),
        },
    };
}
