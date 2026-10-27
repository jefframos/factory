// LevelCatalog.ts
//
// Loads every levels/*.json at build time and exposes them in the order given by levels/index.json,
// plus a tiny localStorage-backed progression ("which level is next").

import type { LevelData } from './LevelData';
import type { LevelStyles } from './WorldStyles';
import order from '../../levels/index.json';
import worldData from '../../levels/worlds.json';

const files = import.meta.glob('../../levels/*.json', { eager: true, import: 'default' }) as Record<string, LevelData>;
const PROGRESS_KEY = 'bandit-controller.levelProgress';
const COMPLETED_KEY = 'bandit-controller.completedLevels';
const UNLOCK_ALL_KEY = 'bandit-controller.unlockAll';
const TUTORIAL_WORLD_ID = 'tutorial';

export interface WorldInfo {
    id: string;
    name: string;
    /** 1-based position in the campaign (drives star gates and payouts). */
    number: number;
    /** True for the opening tutorial world, which is shown unnumbered. */
    tutorial: boolean;
    /** Player-facing number: 'T' for the tutorial, then 1, 2, ... for the real worlds. */
    label: string;
    levels: LevelData[];
}

interface WorldFile {
    id: string;
    name: string;
    styles?: LevelStyles;
    levels: string[];
}

let cache: { levels: LevelData[]; worlds: WorldInfo[] } | undefined;

/** Worlds define the campaign order and the look of their levels (world styles override a level's own). */
function build(): { levels: LevelData[]; worlds: WorldInfo[] } {
    if (cache) {
        return cache;
    }
    const byId = new Map<string, LevelData>();
    for (const level of Object.values(files)) {
        if (level?.id && level.floor) {
            byId.set(level.id, level);
        }
    }
    const levels: LevelData[] = [];
    const worlds: WorldInfo[] = [];
    const used = new Set<string>();
    let numbered = 0;
    (worldData.worlds as WorldFile[]).forEach((entry, index) => {
        const members: LevelData[] = [];
        for (const id of entry.levels) {
            const level = byId.get(id);
            if (level && !used.has(id)) {
                used.add(id);
                members.push({ ...level, styles: { ...level.styles, ...entry.styles } });
            }
        }
        if (members.length > 0) {
            const tutorial = entry.id === TUTORIAL_WORLD_ID;
            const label = tutorial ? 'T' : String(++numbered);
            worlds.push({ id: entry.id, name: entry.name, number: index + 1, tutorial, label, levels: members });
            levels.push(...members);
        }
    });
    const extras = [...(order.levels as string[]), ...byId.keys()]
        .filter((id, index, all) => all.indexOf(id) === index && byId.has(id) && !used.has(id))
        .map((id) => byId.get(id) as LevelData);
    levels.push(...extras);
    cache = { levels, worlds };
    return cache;
}

function allLevels(): LevelData[] {
    return build().levels;
}

function readCompleted(): Set<string> {
    try {
        return new Set(JSON.parse(window.localStorage.getItem(COMPLETED_KEY) ?? '[]') as string[]);
    } catch {
        return new Set();
    }
}

const STARS_KEY = 'bandit-controller.stars';

function starsTotal(): number {
    try {
        return Object.values(JSON.parse(window.localStorage.getItem(STARS_KEY) ?? '{}') as Record<string, number>).reduce((a, b) => a + b, 0);
    } catch {
        return 0;
    }
}

/** Stars needed to enter a world: 1 per level of the worlds before it, per world step. */
export function worldGateStars(number: number): number {
    const previous = build().worlds[number - 2];
    return previous ? previous.levels.length * (number - 1) : 0;
}

export const LevelCatalog = {
    all: allLevels,

    isCompleted(level: LevelData): boolean {
        return readCompleted().has(level.id);
    },

    markCompleted(level: LevelData): void {
        const done = readCompleted();
        done.add(level.id);
        window.localStorage.setItem(COMPLETED_KEY, JSON.stringify([...done]));
    },

    /** A level is playable once the one before it is done (or progress already reached it). */
    isUnlocked(index: number): boolean {
        if (this.isAllUnlocked()) {
            return true;
        }
        const levels = allLevels();
        const found = levels[index] ? this.locate(levels[index]) : undefined;
        if (found && starsTotal() < worldGateStars(found.world.number)) {
            return false;
        }
        if (index <= 0 || index <= this.getIndex()) {
            return true;
        }
        return this.isCompleted(levels[index - 1]);
    },

    /** Settings cheat: every level and world gate opens, without marking anything completed. */
    isAllUnlocked(): boolean {
        return window.localStorage.getItem(UNLOCK_ALL_KEY) === '1';
    },

    unlockAll(): void {
        window.localStorage.setItem(UNLOCK_ALL_KEY, '1');
    },

    /** Completed levels in `world`, for the "3/10" badges. */
    worldProgress(world: WorldInfo): { done: number; total: number } {
        const done = readCompleted();
        return { done: world.levels.filter((level) => done.has(level.id)).length, total: world.levels.length };
    },

    worlds(): WorldInfo[] {
        return build().worlds;
    },

    /** World and 1-based level number within it, or undefined for levels outside every world. */
    locate(level: LevelData): { world: WorldInfo; levelNumber: number } | undefined {
        const world = build().worlds.find((entry) => entry.levels.includes(level));
        return world ? { world, levelNumber: world.levels.indexOf(level) + 1 } : undefined;
    },

    /** True when `level` is the last one of its world. */
    isWorldFinale(level: LevelData): boolean {
        const found = this.locate(level);
        return Boolean(found && found.levelNumber === found.world.levels.length);
    },

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
