import PlatformHandler from "@core/platforms/PlatformHandler";
import { Difficulty, GameProgress, LevelProgress } from "games/game4/types";

export class ProgressCookieStore {
    private readonly storageKey: string;
    private readonly version: number;

    /** Static tracker for the number of unique levels that have been finished */
    public static totalCompletedLevels: number = 0;

    public constructor(storageKey = "jg_progress_v1", version = 1) {
        this.storageKey = storageKey;
        this.version = version;

        // Initialize the static counter by loading current data
        this.syncCompletionCount();
    }

    /**
     * Now considers "First Time" as someone who has never saved 
     * OR someone who hasn't finished a single level yet.
     */
    public static async isFirstTime(storageKey = "jg_progress_v1"): Promise<boolean> {
        const noData = await PlatformHandler.instance.platform.getItem(storageKey) === null;
        return noData || ProgressCookieStore.totalCompletedLevels === 0;
    }

    /**
     * Calculates how many levels have at least one difficulty completed
     * and updates the static variable.
     */
    private async syncCompletionCount(): Promise<void> {
        const progress = await this.load();
        let count = 0;

        for (const levelId in progress.levels) {
            const level = progress.levels[levelId];
            const isFinished = Object.values(level.difficulties).some(d => d.completed);
            if (isFinished) {
                count++;
            }
        }

        ProgressCookieStore.totalCompletedLevels = count;
    }

    /**
     * Loads progress from localStorage.
     */
    public async load(): Promise<GameProgress> {
        try {
            const raw = await PlatformHandler.instance.platform.getItem(this.storageKey);
            if (!raw) return this.createEmpty();

            const parsed = JSON.parse(raw) as Partial<GameProgress>;

            if (!parsed || typeof parsed !== "object") return this.createEmpty();
            if (parsed.version !== this.version) return this.createEmpty();

            return {
                version: this.version,
                levels: parsed.levels ?? {},
                unlockedLevels: parsed.unlockedLevels ?? {},
                coins: parsed.coins ?? 0,
                gems: parsed.gems ?? 0
            };
        } catch (error) {
            console.error("Error loading progress from localStorage:", error);
            return this.createEmpty();
        }
    }

    /**
     * Saves progress to localStorage and updates the static counter.
     */
    public save(progress: GameProgress): void {
        try {
            const safe: GameProgress = {
                ...progress,
                version: this.version,
            };

            const str = JSON.stringify(safe);
            PlatformHandler.instance.platform.setItem(this.storageKey, str);

            // Update the counter whenever we save
            this.syncCompletionCount();
        } catch (error) {
            console.error("Error saving progress to localStorage:", error);
        }
    }

    /**
     * Unlocks a specific level and returns the updated state.
     */
    public markLevelUnlocked(progress: GameProgress, levelId: string): GameProgress {
        const next: GameProgress = {
            ...this.clone(progress),
            unlockedLevels: {
                ...(progress.unlockedLevels ?? {}),
                [levelId]: true,
            },
        };

        this.save(next);
        return next;
    }

    public isLevelUnlocked(progress: GameProgress, levelId: string): boolean {
        return !!progress.unlockedLevels?.[levelId];
    }

    /**
     * Records level completion and updates best times.
     */
    public async markCompleted(
        progress: GameProgress,
        levelId: string,
        difficulty: Difficulty,
        timeMs: number
    ): Promise<GameProgress> {
        const next = this.clone(progress);

        if (!next.levels[levelId]) {
            next.levels[levelId] = this.createEmptyLevel(levelId);
        }

        const level = next.levels[levelId];
        const entry = level.difficulties[difficulty];

        entry.completed = true;
        entry.lastTimeMs = timeMs;
        entry.completedAt = Date.now();

        if (entry.bestTimeMs == null || timeMs < entry.bestTimeMs) {
            entry.bestTimeMs = timeMs;
        }

        await this.save(next); // This will trigger syncCompletionCount()
        return next;
    }

    public getLevel(progress: GameProgress, levelId: string): LevelProgress | undefined {
        return progress.levels[levelId];
    }

    private createEmpty(): GameProgress {
        return {
            version: this.version,
            levels: {},
            unlockedLevels: {},
            coins: 50,
            gems: 0
        };
    }

    private createEmptyLevel(levelId: string): LevelProgress {
        return {
            id: levelId,
            difficulties: {
                easy: { completed: false },
                medium: { completed: false },
                hard: { completed: false }
            },
        };
    }

    private clone(progress: GameProgress): GameProgress {
        return JSON.parse(JSON.stringify(progress)) as GameProgress;
    }

    public resetGameProgress(reload: boolean = false): void {
        localStorage.removeItem(this.storageKey);
        ProgressCookieStore.totalCompletedLevels = 0; // Reset static counter
        if (reload) {
            window.location.reload();
        }
    }
}