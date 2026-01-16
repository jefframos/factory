import { ItemType } from '../progression/ProgressionManager';

export interface ItemAssetData {
    spriteId: string; // texture name/id for PIXI.Sprite.from(...)
    width: number;
    height: number;
}

export class ItemAssetRegistry {
    private static assets: Map<ItemType, ItemAssetData> = new Map();

    public static register(type: ItemType, data: ItemAssetData): void {
        this.assets.set(type, data);
    }

    public static get(type: ItemType): ItemAssetData {
        const data = this.assets.get(type);
        if (!data) {
            throw new Error(`ItemAssetRegistry: No asset data registered for type "${type}"`);
        }
        return data;
    }

    public static tryGet(type: ItemType): ItemAssetData | undefined {
        return this.assets.get(type);
    }

    public static has(type: ItemType): boolean {
        return this.assets.has(type);
    }

    public static clear(): void {
        this.assets.clear();
    }
}
