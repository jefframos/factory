import { ResourceType } from "./MiningDemoTypes";
import { FarmSaveStorage } from "./FarmSaveStorage";

export interface GameEconomyData {
    gold: number;
    iron: number;
    coal: number;
    crystal: number;
}

export interface AsyncGameStorage {
    load(): Promise<GameEconomyData>;
    save(data: GameEconomyData): Promise<void>;
}

export class FarmEconomyStorage implements AsyncGameStorage {
    public constructor(private readonly farmSaveStorage: FarmSaveStorage) { }

    public async load(): Promise<GameEconomyData> {
        return this.farmSaveStorage.loadEconomy();
    }

    public async save(data: GameEconomyData): Promise<void> {
        await this.farmSaveStorage.saveEconomy(data);
    }
}

export class GameEconomy {
    private data: GameEconomyData = createDefaultEconomyData();

    public constructor(private readonly storage: AsyncGameStorage) { }

    public async load(): Promise<void> {
        this.data = await this.storage.load();
    }

    public get gold(): number {
        return this.data.gold;
    }

    public getResourceAmount(resourceType: ResourceType): number {
        return this.data[resourceType];
    }

    public canSpendGold(amount: number): boolean {
        return this.data.gold >= amount;
    }

    public async spendGold(amount: number): Promise<boolean> {
        if (!this.canSpendGold(amount)) {
            return false;
        }

        this.data.gold -= amount;
        await this.storage.save(this.data);

        return true;
    }

    public async addResource(resourceType: ResourceType, amount: number): Promise<void> {
        this.data[resourceType] += amount;
        await this.storage.save(this.data);
    }

    public async addResources(resources: Partial<Record<ResourceType, number>>): Promise<void> {
        for (const [resourceType, amount] of Object.entries(resources)) {
            if (!amount) continue;
            this.data[resourceType as ResourceType] += amount;
        }

        await this.storage.save(this.data);
    }

    public getDebugText(): string {
        return [
            `Gold: ${this.data.gold.toFixed(1)}`,
            `Iron: ${this.data.iron.toFixed(1)}`,
            `Coal: ${this.data.coal.toFixed(1)}`,
            `Crystal: ${this.data.crystal.toFixed(1)}`,
        ].join("\n");
    }
}

function createDefaultEconomyData(): GameEconomyData {
    return {
        gold: 0,
        iron: 0,
        coal: 0,
        crystal: 0,
    };
}
