export interface GameEconomyData {
    gold: number;
}

export interface AsyncGameStorage {
    load(): Promise<GameEconomyData>;
    save(data: GameEconomyData): Promise<void>;
}

export class LocalStorageGameStorage implements AsyncGameStorage {
    private readonly key = "mining-demo-economy";

    public async load(): Promise<GameEconomyData> {
        const raw = window.localStorage.getItem(this.key);

        if (!raw) {
            return { gold: 0 };
        }

        try {
            return JSON.parse(raw) as GameEconomyData;
        } catch {
            return { gold: 0 };
        }
    }

    public async save(data: GameEconomyData): Promise<void> {
        window.localStorage.setItem(this.key, JSON.stringify(data));
    }
}

export class GameEconomy {
    private data: GameEconomyData = { gold: 0 };

    public constructor(private readonly storage: AsyncGameStorage) {}

    public async load(): Promise<void> {
        this.data = await this.storage.load();
    }

    public get gold(): number {
        return this.data.gold;
    }

    public async addGold(amount: number): Promise<void> {
        this.data.gold += amount;
        await this.storage.save(this.data);
    }
}
