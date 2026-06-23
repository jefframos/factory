export interface AsyncStorage {
    getItem(key: string): Promise<string | null>;
    setItem(key: string, value: string): Promise<void>;
    removeItem(key: string): Promise<void>;
}

export class LocalStorageAsyncStorage implements AsyncStorage {
    public async getItem(key: string): Promise<string | null> {
        return window.localStorage.getItem(key);
    }

    public async setItem(key: string, value: string): Promise<void> {
        window.localStorage.setItem(key, value);
    }

    public async removeItem(key: string): Promise<void> {
        window.localStorage.removeItem(key);
    }
}
