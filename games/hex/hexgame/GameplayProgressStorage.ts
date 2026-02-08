// GameplayProgressStorage.ts
export class GameplayProgressStorage {
    private static readonly KEY = "HEX_GAME_PROGRESS";

    public static saveLevelComplete(index: number, stars: number = 3): void {
        const data = this.getData();
        data.levels[index] = { stars: Math.max(data.levels[index]?.stars || 0, stars) };

        // Advance current progress if we finished the latest level
        if (index === data.currentProgressIndex) {
            data.currentProgressIndex++;
        }

        localStorage.setItem(this.KEY, JSON.stringify(data));
    }

    public static getData() {
        const raw = localStorage.getItem(this.KEY);
        return raw ? JSON.parse(raw) : { currentProgressIndex: 0, levels: {} };
    }

    public static getLatestLevelIndex(): number {
        return this.getData().currentProgressIndex;
    }

    public static clearData(): void {
        localStorage.removeItem(this.KEY);
    }

    public static unlockAll(count: number): void {
        const data = { currentProgressIndex: count, levels: {} };
        for (let i = 0; i < count; i++) data.levels[i] = { stars: 3 };
        localStorage.setItem(this.KEY, JSON.stringify(data));
    }
}