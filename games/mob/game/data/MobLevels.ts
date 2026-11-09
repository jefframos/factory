// MobLevels.ts
//
// The battles, as the editor saves them (npm run editor): one JSON file per level in games/mob/levels/, the zones and
// their play order in games/mob/ui/zones.json. Bundled by Vite (a save reloads the dev game). LevelList.ts has the
// order and the looping.
//
// The field: x from -ARENA.halfWidth to +ARENA.halfWidth (-5..5), z from the cannon (0) to the base's front
// (ARENA.baseZ, -24) — a level's `width` / `length` make it bigger (MobConfig FIELD; it grows from the bottom centre).
// Blues come up from z = -1; reds come down from the base.

import { BattleConfig } from './MobConfig';
import { PlayEntry, ZoneConfig, buildPlayList, loopedBattle } from './LevelList';
import zonesFile from '../../ui/zones.json';

const FILES = import.meta.glob<{ default: BattleConfig }>('../../levels/*.json', { eager: true });

/** Every level file, by id (its file name). */
export const LEVELS_BY_ID: Record<string, BattleConfig> = Object.fromEntries(
    Object.entries(FILES).map(([file, module]) => [file.replace(/^.*\/([\w-]+)\.json$/, '$1'), module.default]),
);

export const ZONES: ZoneConfig[] = (zonesFile as { zones: ZoneConfig[] }).zones;

/** The play order: every zone's levels. */
export const PLAY: PlayEntry[] = buildPlayList(LEVELS_BY_ID, ZONES);

/** Battle `index` (0-based, counting up forever): its config, harder on each loop. */
export function battleConfig(index: number): BattleConfig {
    return loopedBattle(PLAY, index).config;
}

/** Battle `index`'s zone (its theme). */
export function battleZone(index: number): ZoneConfig {
    return loopedBattle(PLAY, index).entry.zone;
}

/** Where battle `index` sits: its level id, its zone, whether it's that zone's first or last, and the last of them all. */
export function battleInfo(index: number): { id: string; zone: string; firstInZone: boolean; lastInZone: boolean; lastOfAll: boolean } {
    const at = ((index % PLAY.length) + PLAY.length) % PLAY.length;
    const entry = PLAY[at];
    return {
        id: entry.id,
        zone: entry.zone.id,
        firstInZone: at === 0 || PLAY[at - 1].zone !== entry.zone,
        lastInZone: at === PLAY.length - 1 || PLAY[at + 1].zone !== entry.zone,
        lastOfAll: at === PLAY.length - 1,
    };
}

/** Where battle `index` (the next to play) is in its area: the zone, its number (1-based), how many of its levels are
 *  done before this one, how many it has, and the zone after it (the first again after the last). */
export function areaProgress(index: number): { zone: ZoneConfig; number: number; done: number; total: number; next: ZoneConfig } {
    const at = ((index % PLAY.length) + PLAY.length) % PLAY.length;
    const zone = PLAY[at].zone;
    const inZone = PLAY.filter((entry) => entry.zone === zone);
    const zoneIndex = ZONES.indexOf(zone);
    return { zone, number: zoneIndex + 1, done: inZone.indexOf(PLAY[at]), total: inZone.length, next: ZONES[(zoneIndex + 1) % ZONES.length] };
}

/** An area as the player has it (areaStates): its state, how many of its levels are beaten, and its first level's index. */
export interface AreaState { zone: ZoneConfig; state: 'done' | 'current' | 'open' | 'locked'; done: number; total: number; first: number }

/**
 * Every zone as the player has it, with battle `index` the next to beat (`furthest`: the furthest that can be picked,
 * MobSave.furthest): done (all its levels beaten), current (where `index` is: how many done), open (not reached, but
 * it can be picked: every level unlocked) or locked.
 */
export function areaStates(index: number, furthest: number): AreaState[] {
    // Past the end of the list (it loops): every zone's been beaten.
    const looped = index >= PLAY.length;
    const at = ((index % PLAY.length) + PLAY.length) % PLAY.length;
    const current = PLAY[at].zone;
    let start = 0;
    return ZONES.map((zone) => {
        const total = PLAY.filter((entry) => entry.zone === zone).length;
        const first = start;
        start += total;
        if (zone === current) return { zone, state: 'current' as const, done: at - first, total, first };
        if (looped || first + total <= index) return { zone, state: 'done' as const, done: total, total, first };
        return { zone, state: first <= furthest ? 'open' as const : 'locked' as const, done: 0, total, first };
    });
}
