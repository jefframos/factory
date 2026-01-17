// progressUtils.ts
import { Difficulty, GameProgress, SectionDefinition } from "./types";

export function getLevelDifficultyCompleted(progress: GameProgress, levelId: string, d: Difficulty): boolean {
    const lp = progress.levels[levelId];
    return lp?.difficulties?.[d]?.completed === true;
}

export function getLevelCompletionCount(progress: GameProgress, levelId: string): { done: number; total: number } {
    const diffs: Difficulty[] = ["easy", "medium", "hard"];
    let done = 0;

    for (const d of diffs) {
        if (getLevelDifficultyCompleted(progress, levelId, d)) {
            done += 1;
        }
    }

    return { done, total: diffs.length };
}

export function getSectionCompletion(progress: GameProgress, section: SectionDefinition): { done: number; total: number } {
    const diffs: Difficulty[] = ["easy", "medium", "hard"];
    const total = section.levels.length * diffs.length;

    let done = 0;
    for (const level of section.levels) {
        for (const d of diffs) {
            if (getLevelDifficultyCompleted(progress, level.id, d)) {
                done += 1;
            }
        }
    }

    return { done, total };
}
