export class GlobalDataManager {
    private static readonly STORAGE_KEY = 'globalMatchStats';

    private static data: {
        mergeStats: Record<number, number>;
        pieceCount: Record<number, number>;
        [key: string]: any; // allow custom keys like "highscore"
    } = GlobalDataManager.load();

    public static addMerge(value: number): void {
        this.data.mergeStats[value] = (this.data.mergeStats[value] ?? 0) + 1;
        this.save();
    }

    public static addPiece(value: number): void {
        this.data.pieceCount[value] = (this.data.pieceCount[value] ?? 0) + 1;
        this.save();
    }

    public static setData(key: string, value: any): void {
        this.data[key] = value;
        this.save();
    }

    public static getData<T = any>(key: string): T | undefined {
        return this.data[key] as T | undefined;
    }

    public static wipe(): void {
        localStorage.removeItem(this.STORAGE_KEY);
        this.data = { mergeStats: {}, pieceCount: {} };
    }

    public static save(): void {
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.data));
    }

    public static load(): typeof GlobalDataManager.data {
        const raw = localStorage.getItem(this.STORAGE_KEY);
        return raw
            ? JSON.parse(raw)
            : { mergeStats: {}, pieceCount: {} };
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
