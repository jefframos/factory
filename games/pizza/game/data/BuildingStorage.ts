// BuildingStorage.ts
//
// Global, entity-independent building progression — same "static class +
// Signal + PlatformHandler persistence" shape as BackpackStorage/
// GlobalResourceStorage. Tracks, per BuildingId, the level already cleared
// AND the in-progress deposit toward the NEXT level's requirements — so a
// building mid-upgrade (some wood deposited, not all of it yet) survives a
// reload exactly like a non-empty backpack does.
//
// load() must be awaited once at boot (see index.ts) before anything reads
// getLevel()/getProgress(). Every mutation fires an async persist()
// (fire-and-forget, same convention as BackpackStorage) so BuildingZone's
// per-unit deposits never block on storage I/O.

import { Signal } from 'signals';
import PlatformHandler from 'core/platforms/PlatformHandler';
import { ResourceType } from '../actions/ResourceTypes';
import { BUILDING_CONFIG, BuildingId, BuildingLevelConfig, getNextLevelConfig } from './BuildingTypes';

const STORAGE_KEY = 'PIZZA_BUILDINGS';

interface BuildingState {
    /** 0 = not built yet. N = has cleared level N. */
    level: number;
    /** Progress toward level `level + 1`'s requirements — reset to {} whenever a level clears. */
    progress: Partial<Record<ResourceType, number>>;
}

function createDefaultState(): BuildingState {
    return { level: 0, progress: {} };
}

export class BuildingStorage {
    private static readonly states = new Map<BuildingId, BuildingState>();

    /** Fires with the building id whenever its deposit progress changes (not on level-up — see onLevelUp). */
    static readonly onProgressChanged: Signal = new Signal();
    /** Fires with (id, newLevel) once a level's requirements are fully met and cleared — see tryCompleteLevel(). */
    static readonly onLevelUp: Signal = new Signal();

    /** Call once at boot (see index.ts), before anything reads getLevel()/getProgress(). */
    static async load(): Promise<void> {
        try {
            const raw = await PlatformHandler.instance.platform.getItem(STORAGE_KEY);
            const parsed: Partial<Record<BuildingId, BuildingState>> = raw ? JSON.parse(raw) : {};
            for (const [id, state] of Object.entries(parsed)) {
                if (state && typeof state.level === 'number') {
                    this.states.set(id as BuildingId, { level: state.level, progress: { ...state.progress } });
                }
            }
        } catch (e) {
            console.error('BuildingStorage: failed to load save data', e);
        }
    }

    private static state(id: BuildingId): BuildingState {
        let state = this.states.get(id);
        if (!state) {
            state = createDefaultState();
            this.states.set(id, state);
        }
        return state;
    }

    static getLevel(id: BuildingId): number {
        return this.state(id).level;
    }

    static getProgress(id: BuildingId, type: ResourceType): number {
        return this.state(id).progress[type] ?? 0;
    }

    static isMaxLevel(id: BuildingId): boolean {
        return this.state(id).level >= BUILDING_CONFIG[id].levels.length;
    }

    /** The rung this building is currently working toward — `undefined` once isMaxLevel() is true. */
    static getNextLevelConfig(id: BuildingId): BuildingLevelConfig | undefined {
        return getNextLevelConfig(id, this.state(id).level);
    }

    /**
     * Credits `amount` units of `type` toward the CURRENT next-level requirement, capped so
     * progress never exceeds what that requirement actually asks for — returns how much was
     * actually accepted (<= amount), so a caller draining a backpack one unit at a time (see
     * BuildingZone) knows exactly how much to remove from wherever it came from.
     */
    static addProgress(id: BuildingId, type: ResourceType, amount: number): number {
        if (amount <= 0) {
            return 0;
        }

        const next = this.getNextLevelConfig(id);
        const need = next?.requirements[type] ?? 0;
        if (need <= 0) {
            return 0;
        }

        const state = this.state(id);
        const current = state.progress[type] ?? 0;
        const accepted = Math.min(amount, need - current);
        if (accepted <= 0) {
            return 0;
        }

        state.progress[type] = current + accepted;
        this.onProgressChanged.dispatch(id);
        void this.persist();
        return accepted;
    }

    /** True once every resource in the current next-level requirement has been fully deposited. */
    static isNextLevelReady(id: BuildingId): boolean {
        const next = this.getNextLevelConfig(id);
        if (!next) {
            return false;
        }

        const state = this.state(id);
        return Object.entries(next.requirements).every(([type, need]) => (state.progress[type as ResourceType] ?? 0) >= (need ?? 0));
    }

    /**
     * Clears the current level once its requirements are fully met (see isNextLevelReady()) —
     * bumps `level`, resets `progress` for the next rung, and fires onLevelUp. No-ops (returns
     * false) if requirements aren't actually met yet, so a caller can call this unconditionally
     * right after a deposit and just check the return value.
     */
    static tryCompleteLevel(id: BuildingId): boolean {
        if (!this.isNextLevelReady(id)) {
            return false;
        }

        const state = this.state(id);
        state.level += 1;
        state.progress = {};
        this.onLevelUp.dispatch(id, state.level);
        void this.persist();
        return true;
    }

    private static async persist(): Promise<void> {
        const data: Partial<Record<BuildingId, BuildingState>> = Object.fromEntries(this.states);
        await PlatformHandler.instance.platform.setItem(STORAGE_KEY, JSON.stringify(data));
    }

    /** Debug/dev reset — wipes every building back to level 0 with no progress, notifies subscribers, and removes the persisted save entirely. */
    static async clearAll(): Promise<void> {
        for (const id of this.states.keys()) {
            this.states.set(id, createDefaultState());
            this.onProgressChanged.dispatch(id);
        }
        this.states.clear();
        await PlatformHandler.instance.platform.removeItem(STORAGE_KEY);
    }
}
