import { GridMatrix } from "./HexTypes";

export interface LevelData {
    name: string;
    gridType: string;
    matrix: GridMatrix;
}

export class LevelDataManager {
    private static levels: LevelData[] = [];

    /**
     * Call this once at the start of the scene
     */
    public static init(jsonData: any): void {
        this.levels = jsonData.levels;
    }

    /**
     * Gets a random level from the entire list
     */
    public static getRandomLevel(): LevelData {
        if (this.levels.length === 0) throw new Error("LevelDataManager not initialized with levels!");
        const index = Math.floor(Math.random() * this.levels.length);
        return this.levels[index];
    }

    /**
     * Gets levels filtered by type (e.g., 'Dense' or 'Shape')
     */
    public static getLevelsByType(type: string): LevelData[] {
        return this.levels.filter(l => l.gridType === type);
    }
}