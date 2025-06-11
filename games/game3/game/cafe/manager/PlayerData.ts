import { Observable } from '../utils/Observable';
export enum PlayerAttribute {
    SPEED = 'speed',
    CAPACITY = 'capacity',
    PROFIT = 'profit',
}

export class PlayerData {
    public attributes: Record<PlayerAttribute, Observable> = {
        [PlayerAttribute.SPEED]: new Observable(1),
        [PlayerAttribute.CAPACITY]: new Observable(1),
        [PlayerAttribute.PROFIT]: new Observable(1),
    };

    public dispose(): void {
        Object.values(this.attributes).forEach(attr => attr.dispose());
    }

    public toJSON(): any {
        return Object.fromEntries(
            Object.entries(this.attributes).map(([k, v]) => [k, v.value])
        );
    }

    public static fromJSON(json: any): PlayerData {
        const data = new PlayerData();
        for (const [key, val] of Object.entries(json ?? {})) {
            if (data.attributes[key as PlayerAttribute]) {
                data.attributes[key as PlayerAttribute].value = typeof val === 'number' ? val : 0;
            }
        }
        return data;
    }
}
