import { AsyncStorage } from "./AsyncStorage";
import { EconomyData, ResourceType } from "./MiningDemoTypes";

export class EconomyService {
    private static readonly STORAGE_KEY = "mining-demo:economy";

    private data: EconomyData = {
        gold: 0,
    };

    public constructor(private readonly storage: AsyncStorage) {}

    public getData(): Readonly<EconomyData> {
        return this.data;
    }

    public getResourceAmount(resourceType: ResourceType): number {
        return this.data[resourceType];
    }

    public async load(): Promise<void> {
        const raw = await this.storage.getItem(EconomyService.STORAGE_KEY);

        if (!raw) {
            await this.save();
            return;
        }

        try {
            const parsed = JSON.parse(raw) as Partial<EconomyData>;

            this.data = {
                gold: parsed.gold ?? 0,
            };
        } catch {
            this.data = { gold: 0 };
            await this.save();
        }
    }

    public async addResource(resourceType: ResourceType, amount: number): Promise<void> {
        if (amount <= 0) return;

        this.data[resourceType] += amount;
        await this.save();
    }

    public async reset(): Promise<void> {
        this.data = { gold: 0 };
        await this.save();
    }

    private async save(): Promise<void> {
        await this.storage.setItem(
            EconomyService.STORAGE_KEY,
            JSON.stringify(this.data)
        );
    }
}
