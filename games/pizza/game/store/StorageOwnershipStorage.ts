// StorageOwnershipStorage.ts
//
// Which for-sale storages (see StorageConfig.price / resourceCost) the player
// has bought, plus partial progress toward the ones still for sale — coins
// (`progress`) and each required resource (`resources`, e.g. wood). Same shape
// as FarmPlotStorage.ts (owned ids + partial progress), same static-class +
// PlatformHandler persistence. load() must be awaited once at boot (see
// index.ts) since PizzaScene.setupStorages() reads it while building.
//
// Progress only ever accumulates; tryCompletePurchase() is what flips a
// storage to owned, once every part of its cost is paid.

import { Signal } from 'signals';
import PlatformHandler from 'core/platforms/PlatformHandler';
import { ResourceType } from '../actions/ResourceTypes';
import type { StorageResourceCost } from '../data/StorageTypes';

const STORAGE_KEY = 'PIZZA_STORAGE_OWNERSHIP';

export class StorageOwnershipStorage {
    private static readonly ownedIds = new Set<string>();
    private static readonly progress = new Map<string, number>();
    private static readonly resources = new Map<string, Map<ResourceType, number>>();

    /** Fires with the storage id the moment it's bought. */
    static readonly onPurchase: Signal = new Signal();
    /** Fires with the storage id whenever its coin or resource progress changes. */
    static readonly onProgressChanged: Signal = new Signal();

    static async load(): Promise<void> {
        try {
            const raw = await PlatformHandler.instance.platform.getItem(STORAGE_KEY);
            const parsed: { owned?: string[]; progress?: Record<string, number>; resources?: Record<string, Record<string, number>> } = raw ? JSON.parse(raw) : {};
            for (const id of parsed.owned ?? []) {
                this.ownedIds.add(id);
            }
            for (const [id, amount] of Object.entries(parsed.progress ?? {})) {
                if (typeof amount === 'number' && amount > 0) {
                    this.progress.set(id, amount);
                }
            }
            for (const [id, byType] of Object.entries(parsed.resources ?? {})) {
                const map = new Map<ResourceType, number>();
                for (const [type, amount] of Object.entries(byType ?? {})) {
                    if (typeof amount === 'number' && amount > 0) {
                        map.set(type as ResourceType, amount);
                    }
                }
                if (map.size > 0) {
                    this.resources.set(id, map);
                }
            }
        } catch (e) {
            console.error('StorageOwnershipStorage: failed to load save data', e);
        }
    }

    static isOwned(id: string): boolean {
        return this.ownedIds.has(id);
    }

    /** Coins paid so far toward this storage's price. */
    static getProgress(id: string): number {
        return this.progress.get(id) ?? 0;
    }

    /** Units of `type` paid so far toward this storage's resourceCost. */
    static getResourceProgress(id: string, type: ResourceType): number {
        return this.resources.get(id)?.get(type) ?? 0;
    }

    static addProgress(id: string, amount: number): void {
        if (this.ownedIds.has(id) || amount <= 0) {
            return;
        }
        this.progress.set(id, this.getProgress(id) + amount);
        void this.persist();
        this.onProgressChanged.dispatch(id);
    }

    static addResourceProgress(id: string, type: ResourceType, amount: number): void {
        if (this.ownedIds.has(id) || amount <= 0) {
            return;
        }
        let map = this.resources.get(id);
        if (!map) {
            map = new Map();
            this.resources.set(id, map);
        }
        map.set(type, (map.get(type) ?? 0) + amount);
        void this.persist();
        this.onProgressChanged.dispatch(id);
    }

    /** Marks the storage owned (and fires onPurchase) once coins >= `price` and every resource cost is met. Returns whether it's owned now. */
    static tryCompletePurchase(id: string, price: number, resourceCost: readonly StorageResourceCost[]): boolean {
        if (this.ownedIds.has(id)) {
            return true;
        }
        const paid = this.getProgress(id) >= price
            && resourceCost.every(cost => this.getResourceProgress(id, cost.resourceType) >= cost.amount);
        if (!paid) {
            return false;
        }
        this.progress.delete(id);
        this.resources.delete(id);
        this.ownedIds.add(id);
        void this.persist();
        this.onProgressChanged.dispatch(id);
        this.onPurchase.dispatch(id);
        return true;
    }

    /** Debug/dev reset — same convention as every other *Storage.ts's own clearAll(). */
    static async clearAll(): Promise<void> {
        this.ownedIds.clear();
        this.progress.clear();
        this.resources.clear();
        await PlatformHandler.instance.platform.removeItem(STORAGE_KEY);
    }

    private static async persist(): Promise<void> {
        await PlatformHandler.instance.platform.setItem(STORAGE_KEY, JSON.stringify({
            owned: [...this.ownedIds],
            progress: Object.fromEntries(this.progress),
            resources: Object.fromEntries([...this.resources].map(([id, map]) => [id, Object.fromEntries(map)])),
        }));
    }
}
