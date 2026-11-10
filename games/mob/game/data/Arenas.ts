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

/** The arenas in the order they open (their `unlockAt`), with their ids. */
export const ARENA_ORDER: { id: string; arena: ArenaConfig }[] = Object.entries(ARENAS_BY_ID)
    .map(([id, arena]) => ({ id, arena }))
    .sort((a, b) => (a.arena.unlockAt ?? 0) - (b.arena.unlockAt ?? 0) || a.id.localeCompare(b.id));

/** Whether an arena's open, with the player through to story level `reached` (1-based: the next to play). */
export function arenaOpen(arena: ArenaConfig, reached: number): boolean {
    return reached >= (arena.unlockAt ?? 0);
}

/** The arena the main screen shows: the last one open (else the first, padlocked), and the next one to open, if any. */
export function arenaFor(reached: number): { current: { id: string; arena: ArenaConfig } | null; open: boolean; next: { id: string; arena: ArenaConfig } | null } {
    const open = ARENA_ORDER.filter((entry) => arenaOpen(entry.arena, reached));
    const current = open[open.length - 1] ?? ARENA_ORDER[0] ?? null;
    const next = ARENA_ORDER.find((entry) => !arenaOpen(entry.arena, reached)) ?? null;
    return { current, open: open.length > 0, next };
}
