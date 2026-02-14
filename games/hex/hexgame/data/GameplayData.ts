import { Signal } from "signals";

export interface LevelSessionStats {
    worldId: string;
    levelId: string;
    moves: number;
    startTime: number;
    durationSeconds: number;
    hintsUsed: number;
    isSkipped: boolean;
    stars: number; // 1: Skip, 2: Hinted, 3: Perfect
}

export class GameplayData {
    public readonly onLevelComplete: Signal = new Signal(); // Dispatches LevelSessionStats

    private moves: number = 0;
    private startTime: number = 0;
    private activeWorldId: string = "";
    private activeLevelId: string = "";
    private hintsUsed: number = 0;
    private isSkipped: boolean = false;

    public startSession(worldId: string, levelId: string): void {
        this.activeWorldId = worldId;
        this.activeLevelId = levelId;
        this.moves = 0;
        this.hintsUsed = 0;
        this.isSkipped = false;
        this.startTime = Date.now();
    }

    public recordMove(): void {
        this.moves++;
    }

    public recordHint(): void {
        this.hintsUsed++;
    }

    /**
     * Call this if the player manually skips the level
     */
    public skipLevel(): void {
        this.isSkipped = true;
        this.completeLevel();
    }

    public completeLevel(): void {
        const stats: LevelSessionStats = {
            worldId: this.activeWorldId,
            levelId: this.activeLevelId,
            moves: this.moves,
            startTime: this.startTime,
            durationSeconds: (Date.now() - this.startTime) / 1000,
            hintsUsed: this.hintsUsed,
            isSkipped: this.isSkipped,
            stars: this.calculateStars()
        };

        this.onLevelComplete.dispatch(stats);
    }

    private calculateStars(): number {
        if (this.isSkipped) {
            return 1;
        }

        if (this.hintsUsed > 0) {
            return 2;
        }

        return 3;
    }
}