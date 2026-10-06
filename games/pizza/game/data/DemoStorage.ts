// DemoStorage.ts
//
// Whether the end-of-demo popup (see DemoTypes.ts) was already shown — so it shows once per save.
// Same static-class + PlatformHandler shape as every other *Storage.ts; load() is called lazily
// (idempotent) by PizzaScene, like StoreMoneyStorage.

import PlatformHandler from 'core/platforms/PlatformHandler';

const STORAGE_KEY = 'PIZZA_DEMO_END_SHOWN';

export class DemoStorage {
    private static endShown = false;
    private static loaded = false;
    private static loading?: Promise<void>;

    static load(): Promise<void> {
        this.loading ??= (async () => {
            try {
                this.endShown = (await PlatformHandler.instance.platform.getItem(STORAGE_KEY)) === 'true';
            } catch (e) {
                console.error('DemoStorage: failed to load save data', e);
            }
            this.loaded = true;
        })();
        return this.loading;
    }

    static isLoaded(): boolean {
        return this.loaded;
    }

    static isEndShown(): boolean {
        return this.endShown;
    }

    static markEndShown(): void {
        this.endShown = true;
        void PlatformHandler.instance.platform.setItem(STORAGE_KEY, 'true');
    }

    /** Debug/dev reset — same convention as every other *Storage.ts's own clearAll(). */
    static async clearAll(): Promise<void> {
        this.endShown = false;
        await PlatformHandler.instance.platform.removeItem(STORAGE_KEY);
    }
}
