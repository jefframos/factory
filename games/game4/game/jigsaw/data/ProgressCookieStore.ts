import { Difficulty, GameProgress, LevelProgress } from "games/game4/types";

export class ProgressCookieStore {
    private readonly storageKey: string;
    private readonly version: number;

    /**
     * Using storageKey instead of cookieName for clarity, 
     * but keeping the default value for backward compatibility.
     */
    public constructor(storageKey = "jg_progress_v1", version = 1) {
        this.storageKey = storageKey;
        this.version = version;
    }

    /**
     * Checks if the user has any saved progress.
     */
    public static isFirstTime(storageKey = "jg_progress_v1"): boolean {
        return localStorage.getItem(storageKey) === null;
    }

    /**
     * Loads progress from localStorage.
     */
    public load(): GameProgress {
        try {
            const raw = localStorage.getItem(this.storageKey);
            if (!raw) return this.createEmpty();

            const parsed = JSON.parse(raw) as Partial<GameProgress>;

            // Basic validation
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
     * Saves progress to localStorage.
     */
    public save(progress: GameProgress): void {
        try {
            const safe: GameProgress = {
                ...progress,
                version: this.version,
            };

            const str = JSON.stringify(safe);
            localStorage.setItem(this.storageKey, str);
        } catch (error) {
            console.error("Error saving progress to localStorage (Storage might be full):", error);
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

        // Persist immediately to prevent loss of state
        this.save(next);
        return next;
    }

    public isLevelUnlocked(progress: GameProgress, levelId: string): boolean {
        return !!progress.unlockedLevels?.[levelId];
    }

    /**
     * Records level completion and updates best times.
     */
    public markCompleted(
        progress: GameProgress,
        levelId: string,
        difficulty: Difficulty,
        timeMs: number
    ): GameProgress {
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

        this.save(next);
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

    /**
     * Creates a deep clone to avoid accidental mutations of the current state.
     */
    private clone(progress: GameProgress): GameProgress {
        return JSON.parse(JSON.stringify(progress)) as GameProgress;
    }

    /**
     * Completely resets progress and reloads the page.
     */
    public resetGameProgress(): void {
        localStorage.removeItem(this.storageKey);
        window.location.reload();
    }
}