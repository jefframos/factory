export interface AsyncGameStorage<TData> {
    load(): Promise<TData | undefined>;
    save(data: TData): Promise<void>;
    clear(): Promise<void>;
}

export class LocalStorageGameStorage<TData> implements AsyncGameStorage<TData> {
    public constructor(private readonly storageKey: string) {}

    public async load(): Promise<TData | undefined> {
        const raw = window.localStorage.getItem(this.storageKey);
        if (!raw) return undefined;

        try {
            return JSON.parse(raw) as TData;
        } catch (error) {
            console.warn(`Failed to parse save data for ${this.storageKey}`, error);
            return undefined;
        }
    }

    public async save(data: TData): Promise<void> {
        window.localStorage.setItem(this.storageKey, JSON.stringify(data));
    }

    public async clear(): Promise<void> {
        window.localStorage.removeItem(this.storageKey);
    }
}
