export interface IAnimalStaticData {
    level: number;
    spriteId: string;
    animationId: string;
    coinValue: number;
    spawnTimer: number;
}

export class StaticData {
    private static _animals: Map<number, IAnimalStaticData> = new Map();

    /**
     * Call this at the start of your game with your JSON data
     */
    public static parseData(jsonData: any[]): void {
        this._animals.clear();
        jsonData.forEach(item => {
            this._animals.set(item.level, {
                level: item.level,
                spriteId: item.spriteId,
                animationId: item.animationId,
                coinValue: Math.pow(2, item.level),//item.coinValue,
                spawnTimer: item.spawnTimer
            });
        });
        console.log(`StaticData: Parsed ${this._animals.size} animal levels.`);
    }

    public static getAnimalData(level: number): IAnimalStaticData {
        const data = this._animals.get(level);
        if (!data) {
            console.error(`No static data found for level ${level}`);
            // Return a fallback so the game doesn't crash
            return { level, spriteId: "error", animationId: "idle", coinValue: 1, spawnTimer: 10 };
        }
        return data;
    }
}