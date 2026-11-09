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
