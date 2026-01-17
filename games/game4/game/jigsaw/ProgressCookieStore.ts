// ProgressCookieStore.ts

import { Difficulty, GameProgress, LevelProgress } from "games/game4/types";

export class ProgressCookieStore {
    private readonly cookieName: string;
    private readonly version: number;

    public constructor(cookieName = "jg_progress_v1", version = 1) {
        this.cookieName = cookieName;
        this.version = version;
    }

    public load(): GameProgress {
        const raw = this.readCookie(this.cookieName);
        if (!raw) {
            return this.createEmpty();
        }

        try {
            const decoded = decodeURIComponent(raw);
            const parsed = JSON.parse(decoded) as Partial<GameProgress>;

            if (!parsed || typeof parsed !== "object") {
                return this.createEmpty();
            }

            if (parsed.version !== this.version) {
                // If you later introduce migrations, do it here.
                return this.createEmpty();
            }

            if (!parsed.levels || typeof parsed.levels !== "object") {
                return this.createEmpty();
            }

            return {
                version: this.version,
                levels: parsed.levels as Record<string, LevelProgress>
            };
        }
        catch {
            return this.createEmpty();
        }
    }

    public save(progress: GameProgress): void {
        const safe: GameProgress = {
            version: this.version,
            levels: progress.levels ?? {}
        };

        const str = JSON.stringify(safe);
        const encoded = encodeURIComponent(str);

        // 365 days. Adjust as needed.
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
            levels: {}
        };
    }

    private createEmptyLevel(levelId: string): LevelProgress {
        return {
            id: levelId,
            difficulties: {
                easy: { completed: false },
                medium: { completed: false },
                hard: { completed: false }
            }
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
}
