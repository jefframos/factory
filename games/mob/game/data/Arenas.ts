// Arenas.ts
//
// The arenas, as the editor's Arena tab saves them: one JSON file each in games/mob/arenas/ (ArenaConfig.ts has what's
// in one and how a match is built from it). Bundled by Vite.

import { ArenaConfig } from './ArenaConfig';

const FILES = import.meta.glob<{ default: ArenaConfig }>('../../arenas/*.json', { eager: true });

/** Every arena file, by id (its file name). */
export const ARENAS_BY_ID: Record<string, ArenaConfig> = Object.fromEntries(
    Object.entries(FILES).map(([file, module]) => [file.replace(/^.*\/([\w-]+)\.json$/, '$1'), module.default]),
);

/** The arenas in the order they open (by the trophies they need, then their story level), with their ids. */
export const ARENA_ORDER: { id: string; arena: ArenaConfig }[] = Object.entries(ARENAS_BY_ID)
    .map(([id, arena]) => ({ id, arena }))
    .sort((a, b) => (a.arena.trophies ?? 0) - (b.arena.trophies ?? 0) || (a.arena.unlockAt ?? 0) - (b.arena.unlockAt ?? 0) || a.id.localeCompare(b.id));

/** Whether an arena's open: the player through to story level `reached` (1-based: the next to play), with `trophies`. */
export function arenaOpen(arena: ArenaConfig, reached: number, trophies: number): boolean {
    return reached >= (arena.unlockAt ?? 0) && trophies >= (arena.trophies ?? 0);
}

/** What an arena still needs: the story level, or the trophies (null: it's open). */
export function arenaNeeds(arena: ArenaConfig, reached: number, trophies: number): { level?: number; trophies?: number } | null {
    if (reached < (arena.unlockAt ?? 0)) return { level: arena.unlockAt };
    if (trophies < (arena.trophies ?? 0)) return { trophies: arena.trophies };
    return null;
}

/** The arena the main screen shows: the last one open (else the first, padlocked), and the next one to open, if any. */
export function arenaFor(reached: number, trophies: number): { current: { id: string; arena: ArenaConfig } | null; open: boolean; next: { id: string; arena: ArenaConfig } | null } {
    const open = ARENA_ORDER.filter((entry) => arenaOpen(entry.arena, reached, trophies));
    const current = open[open.length - 1] ?? ARENA_ORDER[0] ?? null;
    const next = ARENA_ORDER.find((entry) => !arenaOpen(entry.arena, reached, trophies)) ?? null;
    return { current, open: open.length > 0, next };
}
