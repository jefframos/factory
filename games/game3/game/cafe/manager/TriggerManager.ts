import { Signal } from 'signals';
import { TriggerAction } from './TriggerAction';
import { TriggerBox } from './TriggerBox';

interface TriggerData {
    id: string;
    data: Record<string, any>;
    box: TriggerBox;
}

export class TriggerManager {
    private static triggers: Map<string, TriggerData> = new Map();
    public static onTriggerStay: Signal = new Signal(); // (triggerId, source, data)
    public static onTriggerEnter: Signal = new Signal(); // (triggerId, source, data)
    public static onTriggerExit: Signal = new Signal(); // (triggerId, source, data)

    private static triggerActions: Map<string, TriggerAction> = new Map();

    public static registerTrigger(trigger: TriggerBox, action: TriggerAction): void {
        this.triggerActions.set(trigger.id, action);

        trigger.onCollideEnter.add((trigger, source, data) => {
            const action = TriggerManager.triggerActions.get(trigger.id);
            action?.onEnter?.(trigger, source);
        });

        trigger.onCollide.add((trigger, source, data) => {
            const action = TriggerManager.triggerActions.get(trigger.id);
            action?.onStay?.(trigger, source);
        });

        trigger.onCollideExit.add((trigger, source, data) => {
            const action = TriggerManager.triggerActions.get(trigger.id);
            action?.onExit?.(trigger, source);
        });

    }


    // public static registerTrigger(triggerBox: TriggerBox, data: Record<string, any> = {}) {
    //     this.triggers.set(triggerBox.id, {
    //         id: triggerBox.id,
    //         data,
    //         box: triggerBox,
    //     });

    //     triggerBox.onCollide.add((trigger: Collider, source: any) => {
    //         if (source?.tag === 'PLAYER') {
    //             this.onTriggerStay.dispatch(trigger.id, source, data);
    //         }
    //     });

    //     triggerBox.onCollideEnter.add((trigger: Collider, source: any) => {
    //         if (source?.tag === 'PLAYER') {
    //             this.onTriggerEnter.dispatch(trigger.id, source, data);
    //         }
    //     });

    //     triggerBox.onCollideExit.add((trigger: Collider, source: any) => {
    //         if (source?.tag === 'PLAYER') {
    //             this.onTriggerExit.dispatch(trigger.id, source, data);
    //         }
    //     });
    // }

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
