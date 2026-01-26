import { MissionDefinition } from "../missions/MissionTypes";

export enum ProgressionType {
    MAIN = "MAIN",
    SEASONAL = "SEASONAL",
    RANKED = "RANKED"
}

export interface IProgressionData {
    level: number;
    xp: number;
    highestMergeLevel: number;
}

// GameStorage.ts

export interface IMissionState {
    id: string;

    // current mission progress (derived but we persist it for convenience/UI)
    progress: number;
    completed: boolean;
    claimed: boolean;

    // NEW: baseline snapshot at activation time
    startValue?: number;

    completedAt?: number;
    claimedAt?: number;
}


export interface IMissionStatsSaveData {
    tapsOnCreatures: number;
    mergesDone: number;
    eggsHatched: number;
    lifetimeEarned: Record<string, number>;
}



export interface IMissionsSaveData {
    activeMissionId: string | null;
    activeDef?: MissionDefinition | null;
    states: Record<string, IMissionState>;

    nextMissionAtMs?: number;

    // per-template progression (tap: 25,30,35… etc.)
    counters?: Record<string, number>;

    // NEW: tier cadence
    tierCycleIndex?: number;                 // index into cadence array
    tierCounters?: Record<number, number>;   // tier -> how many missions of this tier have been assigned/claimed (optional)
}


export interface IRoomStateSaveData {
    id: string;
    entities: any[];
    coinsOnGround: any[];
    // For “generators keep running while hidden/offline”
    lastSimulatedAtMs?: number;
}

export interface IFarmSaveData {
    progressions: Record<string, IProgressionData>;
    currencies: Record<string, number>;

    // OLD (keep for migration only):
    entities?: any[];
    coinsOnGround?: any[];

    // NEW:
    rooms?: Record<string, IRoomStateSaveData>;
    activeRoomId?: string;

    shopHistory: Record<string, number>;
    flags: any;
    missions?: IMissionsSaveData;
    missionStats?: IMissionStatsSaveData;
}



export default class GameStorage {
    private static _instance: GameStorage;
    private readonly STORAGE_KEY: string = "farm_game_state_v3";

    // Internal cache to ensure all systems share the same object in memory
    private _cachedState: IFarmSaveData | null = null;

    public static get instance(): GameStorage {
        return this._instance || (this._instance = new GameStorage());
    }

    private constructor() {
        // Pre-warm the cache
        this.getFullState();
    }

    /**
     * Retrieves the current state. 
     * Prioritizes cache for performance and data consistency.
     */
    public getFullState(): IFarmSaveData {
        if (!this._cachedState) {
            try {
                const data = localStorage.getItem(this.STORAGE_KEY);
                if (data) {
                    this._cachedState = JSON.parse(data);
                } else {
                    this._cachedState = this.createEmptyState();
                }
            } catch (e) {
                console.error("GameStorage: Failed to parse save data. Resetting to empty state.", e);
                this._cachedState = this.createEmptyState();
            }
        }
        return this._cachedState!;
    }

    /**
     * Updates specific keys in the state without overwriting everything.
     * Use this for Shop updates, XP gains, or Currency changes.
     */
    public updateState(patch: Partial<IFarmSaveData>): void {
        const currentState = this.getFullState();

        // Merge patch into state
        this._cachedState = { ...currentState, ...patch };

        // Commit to disk
        this.persist();
    }

    /**
     * Overwrites the entire state.
     * Updates the cache simultaneously to prevent "stale data" reads.
     */
    public saveFullState(data: IFarmSaveData): void {
        this._cachedState = { ...data };
        this.persist();
    }

    /**
     * Private helper to stringify and write to LocalStorage
     */
    private persist(): void {
        if (!this._cachedState) return;
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this._cachedState));
    }

    public createEmptyState(): IFarmSaveData {
        return {
            progressions: {},
            currencies: {},
            entities: [],
            coinsOnGround: [],
            shopHistory: {},
            flags: {},
        };
    }
    public getBool(key: string, fallback: boolean = false): boolean {
        const state = this.getFullState() as any;
        const flags = state?.flags ?? {};
        const v = flags[key];
        return typeof v === "boolean" ? v : fallback;
    }

    public setBool(key: string, value: boolean): void {
        const state = (this.getFullState() as any) ?? {};
        const flags = state.flags ?? {};
        flags[key] = value;
        this.updateState({ flags });
    }

    /**
     * Wipes data. Reload is recommended to clear all Singleton memory.
     */
    public resetGameProgress(reload: boolean = false): void {
        localStorage.removeItem(this.STORAGE_KEY);
        this._cachedState = this.createEmptyState();
        if (reload) window.location.reload();
    }
}