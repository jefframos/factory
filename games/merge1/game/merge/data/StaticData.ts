export interface IAnimalStaticData {
    level: number;
    name: string;
    spriteId: string;
    animationId: string;
    colors: string[];
    coinValue: number;
    spawnTimer: number;
}

export class StaticData {
    private static _animals: Map<number, IAnimalStaticData> = new Map();
    public static get entityCount(): number {
        return StaticData._animals.size;
    }
    /**
     * Call this at the start of your game with your JSON data
     */
    public static parseData(jsonData: any[]): void {
        console.log('WHAT')
        this._animals.clear();
        jsonData.forEach(item => {
            this._animals.set(item.level, {
                level: item.level,
                spriteId: item.spriteId,
                name: item.name,
                animationId: item.animationId,
                colors: item.colors,
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
            return {
                level: 0,
                name: "Unknown",
                spriteId: "",
                animationId: "",
                colors: [],
                coinValue: 0,
                spawnTimer: 0
            };
        }
        return data;
    }
}