import { ItemType } from '../../progression/ProgressionManager';


export interface OrderEntry {
    itemType: ItemType;
    amount: number;
}


export class OrderTable {
    public static getFirstOrder(): OrderEntry[] {
        return [{ itemType: ItemType.COFFEE, amount: 1 }];
    }

    public static getRandomOrder(): OrderEntry[] {
        const all: ItemType[] = [ItemType.COFFEE];//, ItemType.MUFFIN, ItemType.CROISSANT];
        const order: OrderEntry[] = [];

        const count = 1 + Math.floor(Math.random() * 2); // 1-2 items
        for (let i = 0; i < count; i++) {
            const type = all[Math.floor(Math.random() * all.length)];
            const amount = 1 + Math.floor(Math.random() * 2); // 1–2 of each
            order.push({ itemType: type, amount });
        }

        return order;
    }
}
