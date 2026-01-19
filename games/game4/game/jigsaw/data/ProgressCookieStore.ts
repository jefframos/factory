// ProgressCookieStore.ts

import { Difficulty, GameProgress, LevelProgress } from "games/game4/types";

export class ProgressCookieStore {
    private readonly cookieName: string;
    private readonly version: number;

    public constructor(cookieName = "jg_progress_v1", version = 1) {
        this.cookieName = cookieName;
        this.version = version;
    }

    public static isFirstTime(cookieName = "jg_progress_v1"): boolean {
        const parts = document.cookie.split(";").map((p) => p.trim());
        return !parts.some((p) => p.startsWith(cookieName + "="));
    }

    public load(): GameProgress {
        const raw = this.readCookie(this.cookieName);
        if (!raw) return this.createEmpty();

        try {
            const decoded = decodeURIComponent(raw);
            const parsed = JSON.parse(decoded) as Partial<GameProgress>;

            if (!parsed || typeof parsed !== "object") return this.createEmpty();
            if (parsed.version !== this.version) return this.createEmpty();

            // Return the full object including unlockedLevels
            return {
                version: this.version,
                levels: parsed.levels ?? {},
                unlockedLevels: parsed.unlockedLevels ?? {},
                coins: parsed.coins ?? 0, // Default starting coins
                gems: parsed.gems ?? 0      // Default starting gems
            };
        }
        catch {
            return this.createEmpty();
        }
    }
    public markLevelUnlocked(progress: GameProgress, levelId: string): GameProgress {
        const next: GameProgress = {
            ...progress,
            unlockedLevels: {
                ...(progress.unlockedLevels ?? {}),
                [levelId]: true,
            },
        };

        return next;
    }
    public isLevelUnlocked(progress: GameProgress, levelId: string): boolean {
        return !!progress.unlockedLevels?.[levelId];
    }
    public save(progress: GameProgress): void {
        const safe: GameProgress = {
            ...progress, // Spread the progress to catch coins/gems
            version: this.version,
        };

        const str = JSON.stringify(safe);
        const encoded = encodeURIComponent(str);

        const maxAgeSeconds = 60 * 60 * 24 * 365;
        document.cookie = `${this.cookieName}=${encoded}; Max-Age=${maxAgeSeconds}; Path=/; SameSite=Lax`;
    }

    public markCompleted(
        progress: GameProgress,
        levelId: string,
        difficulty: Difficulty,
        timeMs: number
    ): GameProgress {
        const next = this.clone(progress);

        const level = next.levels[levelId] ?? this.createEmptyLevel(levelId);
        const entry = level.difficulties[difficulty];

        entry.completed = true;
        entry.lastTimeMs = timeMs;
        entry.completedAt = Date.now();

        if (entry.bestTimeMs == null || timeMs < entry.bestTimeMs) {
            entry.bestTimeMs = timeMs;
        }

        next.levels[levelId] = level;
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
        // shallow is enough if we always replace nested objects we mutate;
        // here we mutate nested entries, so do a structured clone.
        return JSON.parse(JSON.stringify(progress)) as GameProgress;
    }

    private readCookie(name: string): string | null {
        const parts = document.cookie.split(";").map((p) => p.trim());
        for (const p of parts) {
            if (p.startsWith(name + "=")) {
                return p.substring(name.length + 1);
            }
        }
        return null;
    }

    public resetGameProgress(): void {
        // 1. Clear the specific game progress cookie
        // We set Max-Age to -1 and an expired Date to ensure the browser deletes it
        document.cookie = `${this.cookieName}=; Path=/; Max-Age=-1; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax`;

        // 2. Optional: If you use other keys or localStorage, clear those too
        // localStorage.clear(); 

        // 3. Reload the page to reset the application state
        window.location.reload();
    }
}
