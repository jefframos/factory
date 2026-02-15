import { Signal } from "signals";
import { Choice, Difficulty } from "../HexTypes";

export interface LevelSessionStats {
    worldId: string;
    levelId: string;
    moves: number;
    startTime: number;
    durationSeconds: number;
    hintsUsed: number;
    isSkipped: boolean;
    difficulty: Difficulty;
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
    private difficulty: Difficulty = Difficulty.EASY;

    public startSession(worldId: string, levelId: string, difficulty: Difficulty): void {
        this.activeWorldId = worldId;
        this.activeLevelId = levelId;
        this.moves = 0;
        this.hintsUsed = 0;
        this.isSkipped = false;
        this.difficulty = difficulty;
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
    public addSkipLevel(): void {
        this.isSkipped = true;
    }
    public skipLevel(): void {
        this.isSkipped = true;
        this.completeLevel();
    }
    public getSnapshot(): LevelSessionStats {
        return {
            worldId: this.activeWorldId,
            levelId: this.activeLevelId,
            moves: this.moves,
            startTime: this.startTime,
            durationSeconds: (Date.now() - this.startTime) / 1000,
            hintsUsed: this.hintsUsed,
            isSkipped: this.isSkipped,
            difficulty: this.difficulty,
            stars: this.calculateStars()
        };
    }
    public completeLevel(choice: Choice): void {
        const stats = this.getSnapshot();

        this.onLevelComplete.dispatch(stats, choice);
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