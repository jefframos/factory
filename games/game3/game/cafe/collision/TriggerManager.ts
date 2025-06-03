import { Signal } from 'signals';
import { Collider } from './Collider';
import { TriggerBox } from './TriggerBox';

interface TriggerData {
    id: string;
    data: Record<string, any>;
    box: TriggerBox;
}

export class TriggerManager {
    private static triggers: Map<string, TriggerData> = new Map();
    public static onTriggerActivated: Signal = new Signal(); // (triggerId, source, data)

    public static registerTrigger(triggerBox: TriggerBox, data: Record<string, any> = {}) {
        this.triggers.set(triggerBox.id, {
            id: triggerBox.id,
            data,
            box: triggerBox,
        });

        triggerBox.onCollided.add((trigger: Collider, source: any) => {
            if (source?.tag === 'PLAYER') {
                this.onTriggerActivated.dispatch(trigger.id, source, data);
            }
        });
    }

    public static unregisterTrigger(id: string): void {
        this.triggers.delete(id);
    }

    public static getData(id: string): Record<string, any> | undefined {
        return this.triggers.get(id)?.data;
    }

    public static clear(): void {
        this.triggers.clear();
    }
}
