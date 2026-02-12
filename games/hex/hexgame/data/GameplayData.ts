import { Signal } from "signals";

export interface LevelSessionStats {
    worldId: string;
    levelId: string;
    moves: number;
    startTime: number;
    durationSeconds: number;
}

export class GameplayData {
    public readonly onLevelComplete: Signal = new Signal(); // Dispatches LevelSessionStats

    private moves: number = 0;
    private startTime: number = 0;
    private activeWorldId: string = "";
    private activeLevelId: string = "";

    public startSession(worldId: string, levelId: string): void {
        this.activeWorldId = worldId;
        this.activeLevelId = levelId;
        this.moves = 0;
        this.startTime = Date.now();
    }

    public recordMove(): void {
        this.moves++;
    }

    public completeLevel(): void {
        const stats: LevelSessionStats = {
            worldId: this.activeWorldId,
            levelId: this.activeLevelId,
            moves: this.moves,
            startTime: this.startTime,
            durationSeconds: (Date.now() - this.startTime) / 1000
        };
        this.onLevelComplete.dispatch(stats);
    }
}