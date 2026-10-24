// LevelCatalog.ts
//
// Loads every levels/*.json at build time and exposes them in the order given by levels/index.json,
// plus a tiny localStorage-backed progression ("which level is next").

import type { LevelData } from './LevelData';
import order from '../../levels/index.json';

const files = import.meta.glob('../../levels/level-*.json', { eager: true, import: 'default' }) as Record<string, LevelData>;
const PROGRESS_KEY = 'bandit-controller.levelProgress';

function allLevels(): LevelData[] {
    const byId = new Map<string, LevelData>();
    for (const level of Object.values(files)) {
        byId.set(level.id, level);
    }
    const ordered = (order.levels as string[]).map((id) => byId.get(id)).filter((level): level is LevelData => Boolean(level));
    const unlisted = [...byId.values()].filter((level) => !ordered.includes(level));
    return [...ordered, ...unlisted];
}

export const LevelCatalog = {
    all: allLevels,

    count(): number {
        return allLevels().length;
    },

    getIndex(): number {
        const stored = Number(window.localStorage.getItem(PROGRESS_KEY));
        const count = allLevels().length;
        return Number.isFinite(stored) && count > 0 ? Math.min(Math.max(0, Math.floor(stored)), count - 1) : 0;
    },

    setIndex(index: number): void {
        window.localStorage.setItem(PROGRESS_KEY, String(index));
    },

    /** ?level=<id or 1-based number> overrides saved progression (used by the editor's Play button). */
    current(): LevelData {
        const levels = allLevels();
        const param = new URLSearchParams(window.location.search).get('level');
        if (param) {
            const found = levels.find((level) => level.id === param) ?? levels[Number(param) - 1];
            if (found) {
                return found;
            }
        }
        return levels[this.getIndex()];
    },

    /** Jumps straight to level `index` (debug menu); drops any ?level override so it sticks as saved progress. */
    select(index: number): void {
        this.setIndex(index);
        const url = new URL(window.location.href);
        if (url.searchParams.has('level')) {
            url.searchParams.delete('level');
            window.history.replaceState(null, '', url);
        }
    },

    hasNext(current: LevelData): boolean {
        const levels = allLevels();
        return levels.indexOf(current) < levels.length - 1;
    },

    /** Saves progress to the level after `current`; wraps to the first level after the last one. */
    advance(current: LevelData): void {
        const levels = allLevels();
        const next = levels.indexOf(current) + 1;
        this.setIndex(next >= levels.length ? 0 : next);
        const url = new URL(window.location.href);
        if (url.searchParams.has('level')) {
            url.searchParams.delete('level');
            window.history.replaceState(null, '', url);
        }
    },
};
