import PlatformHandler from "@core/platforms/PlatformHandler";

export interface ILevelData {
    stars: number;
}

export interface IGameplaySaveData {
    version: number; // Added to track breaking changes
    currentProgressIndex: number;
    levels: Record<number, ILevelData>;
    currency: number;
    unlockedAvatars: number[];
    currentAvatarId: number;
}

export class GameplayProgressStorage {
    private static readonly KEY = "HEX_GAME_PROGRESS";
    private static readonly CURRENT_VERSION = 1; // Increment this to wipe/reset data

    private static _cachedData: IGameplaySaveData | null = null;

    /**
     * Default state used when no data exists or when missing specific keys.
     */
    private static createDefaultData(): IGameplaySaveData {
        return {
            version: this.CURRENT_VERSION,
            currentProgressIndex: 0,
            levels: {},
            currency: 0,
            unlockedAvatars: [0],
            currentAvatarId: 0
        };
    }

    private static async ensureLoaded(): Promise<IGameplaySaveData> {
        if (this._cachedData) return this._cachedData;

        try {
            const raw = await PlatformHandler.instance.platform.getItem(this.KEY);
            let parsed = raw ? JSON.parse(raw) : null;

            // 1. Version Check: If version is different or missing, reset data
            if (parsed && parsed.version !== this.CURRENT_VERSION) {
                console.warn(`Save version mismatch (Found: ${parsed.version}, Required: ${this.CURRENT_VERSION}). Resetting storage.`);
                parsed = null;
            }

            // 2. Merge Defaults: If null, use defaults. If exists, fill in missing keys.
            if (!parsed) {
                this._cachedData = this.createDefaultData();
            } else {
                // This ensures if you add new properties to the interface later,
                // old saves will get them without losing their level progress.
                this._cachedData = { ...this.createDefaultData(), ...parsed };
            }
        } catch (e) {
            console.error("GameplayProgressStorage: Failed to load data", e);
            this._cachedData = this.createDefaultData();
        }

        return this._cachedData!;
    }

    public static async saveLevelComplete(index: number, stars: number = 3): Promise<number> {
        const data = await this.ensureLoaded();

        const existingStars = data.levels[index]?.stars || 0;

        // Calculate how many NEW stars were earned
        const starGain = Math.max(0, stars - existingStars);

        // Only update if the new score is higher
        if (stars > existingStars) {
            data.levels[index] = { stars: stars };
        }

        // Logic: Only increment the "Current Progress" if this is the highest level they've reached
        if (index === data.currentProgressIndex) {
            data.currentProgressIndex++;
        }

        await this.persist(data);

        // Return the gain so the Economy system knows how much to add
        return starGain;
    }

    public static getLevelData(index: number): ILevelData | null {
        if (!this._cachedData) {
            console.error("GameplayProgressStorage: Attempted to get level data before storage was loaded.");
            return null;
        }
        return this._cachedData.levels[index] || null;
    }

    public static async getLatestLevelIndex(): Promise<number> {
        const data = await this.ensureLoaded();
        return data.currentProgressIndex;
    }

    public static async getData(): Promise<IGameplaySaveData> {
        return await this.ensureLoaded();
    }

    public static async clearData(): Promise<void> {
        this._cachedData = this.createDefaultData();
        await PlatformHandler.instance.platform.removeItem(this.KEY);
    }
    // Add this to GameplayProgressStorage
    public static getDataSync(): IGameplaySaveData {
        return this._cachedData || this.createDefaultData();
    }
    public static async unlockAll(count: number): Promise<void> {
        const data = await this.ensureLoaded();
        data.currentProgressIndex = count;
        for (let i = 0; i < count; i++) {
            data.levels[i] = { stars: 3 };
        }

        this._cachedData = data;
        await this.persist(data);
    }

    /**
     * Updates specific keys and persists
     */
    public static async updateData(patch: Partial<IGameplaySaveData>): Promise<void> {
        const data = await this.ensureLoaded();
        this._cachedData = { ...data, ...patch };
        await this.persist(this._cachedData);
    }

    private static async persist(data: IGameplaySaveData): Promise<void> {
        await PlatformHandler.instance.platform.setItem(this.KEY, JSON.stringify(data));
    }
}