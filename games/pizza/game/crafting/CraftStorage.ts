// CraftStorage.ts
//
// Global, entity-independent crafting-table progression — same "static
// class + Signal + PlatformHandler persistence" shape as BuildingStorage,
// but tracking a SET of independently-completed recipe ids per craft table
// rather than one linear level number, since a table's recipes aren't a
// ladder (see CraftTypes.ts's own doc) — "pickaxe" and some other recipe can
// be crafted in either order, or not at all.
//
// getNextRecipe() is the one place that decides which recipe is "active"
// right now: the first entry in the table's own `recipes` list whose id
// isn't already in `completedRecipeIds`. CraftZone drains resources toward
// THAT recipe's cost only, same as BuildingZone always draining toward
// getNextLevelConfig()'s requirements.
//
// load() must be awaited once at boot (see index.ts) before anything reads
// getState()/getNextRecipe(). Every mutation fires an async persist()
// (fire-and-forget, same convention as every other *Storage.ts here).

import { Signal } from 'signals';
import PlatformHandler from 'core/platforms/PlatformHandler';
import { ResourceType } from '../actions/ResourceTypes';
import { CraftRecipeDef, CraftTableConfig } from './CraftTypes';
import { ItemStorage } from './ItemStorage';

const STORAGE_KEY = 'PIZZA_CRAFT_TABLES';

interface CraftState {
    completedRecipeIds: string[];
    /** Progress toward the CURRENT active recipe's cost (see getNextRecipe()) — reset to {} whenever a recipe completes. Meaningless once every recipe is completed. */
    progress: Partial<Record<ResourceType, number>>;
}

function createDefaultState(): CraftState {
    return { completedRecipeIds: [], progress: {} };
}

export class CraftStorage {
    private static readonly states = new Map<string, CraftState>();

    /** Fires with the craft table id whenever its deposit progress OR its completed-recipe set changes. */
    static readonly onChange: Signal = new Signal();

    /** Call once at boot (see index.ts), before anything reads getState()/getNextRecipe(). */
    static async load(): Promise<void> {
        try {
            const raw = await PlatformHandler.instance.platform.getItem(STORAGE_KEY);
            const parsed: Record<string, CraftState> = raw ? JSON.parse(raw) : {};
            for (const [id, state] of Object.entries(parsed)) {
                if (state && Array.isArray(state.completedRecipeIds)) {
                    this.states.set(id, { completedRecipeIds: [...state.completedRecipeIds], progress: { ...state.progress } });
                }
            }
        } catch (e) {
            console.error('CraftStorage: failed to load save data', e);
        }
    }

    private static state(id: string): CraftState {
        let state = this.states.get(id);
        if (!state) {
            state = createDefaultState();
            this.states.set(id, state);
        }
        return state;
    }

    /** Read-only snapshot of `id`'s current state. */
    static getState(id: string): Readonly<CraftState> {
        return this.state(id);
    }

    /** The first recipe in `config.recipes` not yet completed — undefined once every recipe's been crafted (see isFullyCrafted()). */
    static getNextRecipe(id: string, config: CraftTableConfig): CraftRecipeDef | undefined {
        const state = this.state(id);
        return config.recipes.find(recipe => !state.completedRecipeIds.includes(recipe.id));
    }

    static getProgress(id: string, type: ResourceType): number {
        return this.state(id).progress[type] ?? 0;
    }

    /** True once every recipe in `config.recipes` has been crafted at this table. */
    static isFullyCrafted(id: string, config: CraftTableConfig): boolean {
        return this.getNextRecipe(id, config) === undefined;
    }

    /**
     * Credits `amount` units of `type` toward the CURRENT active recipe's cost, capped so
     * progress never exceeds what that recipe actually asks for — returns how much was
     * actually accepted (<= amount), same convention as BuildingStorage.addProgress(), so a
     * caller draining a backpack one unit at a time (see CraftZone) knows exactly how much to
     * remove from wherever it came from. No-ops (returns 0) once every recipe is crafted.
     */
    static addProgress(id: string, config: CraftTableConfig, type: ResourceType, amount: number): number {
        if (amount <= 0) {
            return 0;
        }

        const recipe = this.getNextRecipe(id, config);
        const need = recipe?.cost[type] ?? 0;
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
        this.onChange.dispatch(id);
        void this.persist();
        return accepted;
    }

    /** True once every resource in the active recipe's cost has been fully deposited. */
    static isNextRecipeReady(id: string, config: CraftTableConfig): boolean {
        const recipe = this.getNextRecipe(id, config);
        if (!recipe) {
            return false;
        }

        const state = this.state(id);
        return Object.entries(recipe.cost).every(([type, need]) => (state.progress[type as ResourceType] ?? 0) >= (need ?? 0));
    }

    /**
     * Completes the active recipe once its full cost has been deposited (see
     * isNextRecipeReady()) — marks it crafted, resets `progress` for whichever recipe becomes
     * active next, credits ItemStorage with the recipe's payout, and fires onChange. Returns
     * the just-completed recipe (undefined if it isn't actually fully paid for yet, or every
     * recipe is already crafted), so a caller can call this unconditionally right after
     * crediting progress and just check the return value — same convention as
     * BuildingStorage.tryCompleteLevel().
     */
    static tryCompleteRecipe(id: string, config: CraftTableConfig): CraftRecipeDef | undefined {
        if (!this.isNextRecipeReady(id, config)) {
            return undefined;
        }

        const recipe = this.getNextRecipe(id, config)!;
        const state = this.state(id);
        state.completedRecipeIds.push(recipe.id);
        state.progress = {};
        ItemStorage.add(recipe.result.item, recipe.result.amount);
        this.onChange.dispatch(id);
        void this.persist();
        return recipe;
    }

    private static async persist(): Promise<void> {
        const data: Record<string, CraftState> = Object.fromEntries(this.states);
        await PlatformHandler.instance.platform.setItem(STORAGE_KEY, JSON.stringify(data));
    }

    /** Debug/dev reset — wipes every craft table back to no recipes crafted/no progress, notifies subscribers, and removes the persisted save entirely. */
    static async clearAll(): Promise<void> {
        for (const id of this.states.keys()) {
            this.states.set(id, createDefaultState());
            this.onChange.dispatch(id);
        }
        this.states.clear();
        await PlatformHandler.instance.platform.removeItem(STORAGE_KEY);
    }
}
