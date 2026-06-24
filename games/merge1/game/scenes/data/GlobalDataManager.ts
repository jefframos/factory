import PlatformHandler from "core/platforms/PlatformHandler";

export class GlobalDataManager {
    private static readonly STORAGE_KEY = 'globalMatchStats';

    private static data: {
        mergeStats: Record<number, number>;
        pieceCount: Record<number, number>;
        [key: string]: any; // allow custom keys like "highscore"
    } = { mergeStats: {}, pieceCount: {} };
    private static isHydrated = false;
    private static hydrationPromise: Promise<void> | null = null;
    private static writeQueue: Promise<void> = Promise.resolve();

    private static createDefaultData(): typeof GlobalDataManager.data {
        return { mergeStats: {}, pieceCount: {} };
    }

    public static async ready(): Promise<void> {
        await this.ensureHydrated();
    }

    private static async ensureHydrated(): Promise<void> {
        if (this.isHydrated) {
            return;
        }

        if (!this.hydrationPromise) {
            this.hydrationPromise = this.hydrateFromPlatform();
        }

        await this.hydrationPromise;
    }

    private static async hydrateFromPlatform(): Promise<void> {
        try {
            const raw = await PlatformHandler.instance.platform.getItem(this.STORAGE_KEY);
            this.data = raw ? JSON.parse(raw) : this.createDefaultData();
        } catch (e) {
            console.error("GlobalDataManager: Failed to load data", e);
            this.data = this.createDefaultData();
        } finally {
            this.isHydrated = true;
            this.hydrationPromise = null;
        }
    }

    public static addMerge(value: number): void {
        if (!this.isHydrated) {
            void this.ensureHydrated();
        }
        this.data.mergeStats[value] = (this.data.mergeStats[value] ?? 0) + 1;
        void this.save();
    }

    public static addPiece(value: number): void {
        if (!this.isHydrated) {
            void this.ensureHydrated();
        }
        this.data.pieceCount[value] = (this.data.pieceCount[value] ?? 0) + 1;
        void this.save();
    }

    public static setData(key: string, value: any): void {
        if (!this.isHydrated) {
            void this.ensureHydrated();
        }
        this.data[key] = value;
        void this.save();
    }

    public static getData<T = any>(key: string): T | undefined {
        return this.data[key] as T | undefined;
    }

    public static wipe(): void {
        this.data = this.createDefaultData();
        this.writeQueue = this.writeQueue
            .then(async () => {
                await PlatformHandler.instance.platform.removeItem(this.STORAGE_KEY);
            })
            .catch((e) => {
                console.error("GlobalDataManager: Failed to wipe data", e);
            });
    }

    public static async save(): Promise<void> {
        const serialized = JSON.stringify(this.data);
        this.writeQueue = this.writeQueue
            .then(async () => {
                await PlatformHandler.instance.platform.setItem(this.STORAGE_KEY, serialized);
            })
            .catch((e) => {
                console.error("GlobalDataManager: Failed to save data", e);
            });

        await this.writeQueue;
    }

    public static load(): typeof GlobalDataManager.data {
        if (!this.isHydrated) {
            void this.ensureHydrated();
        }
        return this.data;
    }

    public static getStats(): typeof GlobalDataManager.data {
        return this.data;
    }

    public static getReadableStats(): string {
        const mergeList = Object.entries(this.data.mergeStats ?? {})
            .sort(([a], [b]) => Number(a) - Number(b))
            .map(([val, count]) => `Merged ${val}: ${count}`)
            .join('\n');

        const createdList = Object.entries(this.data.pieceCount ?? {})
            .sort(([a], [b]) => Number(a) - Number(b))
            .map(([val, count]) => `Created ${val}: ${count}`)
            .join('\n');

        return `=== Global Stats ===\n${mergeList}\n\n${createdList}`;
    }
}
