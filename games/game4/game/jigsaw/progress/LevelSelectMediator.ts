// LevelSelectMediator.ts
import { Signal } from "signals";
import { Difficulty, GameProgress, LevelDefinition, SectionDefinition } from "../../../types";
import { ProgressCookieStore } from "../ProgressCookieStore";

export interface PlayLevelRequest {
    levelId: string;
    difficulty: Difficulty;
    level: LevelDefinition;
    section: SectionDefinition;
    allowRotation: boolean;
}

export class LevelSelectMediator {
    public readonly onPlayLevel: Signal = new Signal(); // dispatch(PlayLevelRequest)
    public readonly onProgressChanged: Signal = new Signal(); // dispatch(GameProgress)

    private readonly store: ProgressCookieStore;
    private progress: GameProgress;

    private sections: SectionDefinition[] = [];
    private levelIndex: Map<string, { level: LevelDefinition; section: SectionDefinition }> = new Map();

    public constructor(store: ProgressCookieStore) {
        this.store = store;
        this.progress = this.store.load();
    }

    public setSections(sections: SectionDefinition[]): void {
        this.sections = sections;
        this.levelIndex.clear();

        for (const s of sections) {
            for (const l of s.levels) {
                this.levelIndex.set(l.id, { level: l, section: s });
            }
        }
    }

    public getProgress(): GameProgress {
        return this.progress;
    }

    public requestPlay(levelId: string, difficulty: Difficulty): void {
        const hit = this.levelIndex.get(levelId);
        if (!hit) {
            return;
        }

        const req: PlayLevelRequest = {
            levelId,
            difficulty,
            level: hit.level,
            section: hit.section,
            allowRotation: true
        };

        this.onPlayLevel.dispatch(req);
    }

    public reportLevelCompleted(levelId: string, difficulty: Difficulty, timeMs: number): void {
        this.progress = this.store.markCompleted(this.progress, levelId, difficulty, timeMs);
        this.store.save(this.progress);
        this.onProgressChanged.dispatch(this.progress);
    }
}
