import { Signal } from 'signals';
import { TriggerAction } from './TriggerAction';
import { TriggerBox } from './TriggerBox';
import { UpgradeTrigger } from './triggers/UpgradeTrigger';

interface TriggerData {
    id: string;
    data: Record<string, any>;
    box: TriggerBox;
}

export class TriggerManager {
    public static onTriggerStay: Signal = new Signal(); // (triggerId, source, data)
    public static onTriggerEnter: Signal = new Signal(); // (triggerId, source, data)
    public static onTriggerExit: Signal = new Signal(); // (triggerId, source, data)
    public static onTriggerAction: Signal = new Signal(); // (triggerId, source, data)

    private static triggerActions: Map<string, TriggerAction> = new Map();
    private static triggerComponent: Map<string, UpgradeTrigger> = new Map();

    public static registerTrigger(trigger: TriggerBox, action: TriggerAction, component?: UpgradeTrigger): void {
        this.triggerActions.set(trigger.id, action);
        if (component) {
            this.triggerComponent.set(trigger.id, component);
        }

        trigger.onCollideEnter.add((trigger, source, data) => {
            const action = TriggerManager.triggerActions.get(trigger.id);
            action?.onEnter?.(trigger, source);
            TriggerManager.onTriggerEnter.dispatch(trigger, source, data);
        });

        trigger.onCollide.add((trigger, source, data) => {
            const action = TriggerManager.triggerActions.get(trigger.id);
            action?.onStay?.(trigger, source);
            TriggerManager.onTriggerStay.dispatch(trigger, source, data);
        });

        trigger.onCollideExit.add((trigger, source, data) => {
            const action = TriggerManager.triggerActions.get(trigger.id);
            action?.onExit?.(trigger, source);
            TriggerManager.onTriggerExit.dispatch(trigger, source, data);
        });

        trigger.onTriggerAction.add((trigger, source, data) => {
            const action = TriggerManager.triggerActions.get(trigger);
            action?.onAction?.(trigger, source);
            TriggerManager.onTriggerAction.dispatch(trigger, source, data);
        });
    }
    public static updateTriggers(deltaTime: number): void {
        this.triggerActions.forEach((triggerData) => {
            const action = triggerData
            if (action) {
                action.update?.(deltaTime);
            }
        });
    }
    public static unregisterTrigger(id: string): void {
        this.triggerActions.delete(id);
        this.triggerComponent.delete(id);
    }


    public static getData(id: string): Record<string, any> | undefined {
        return this.triggerActions.get(id);
    }
    public static getComponent(id: string): UpgradeTrigger | undefined {
        return this.triggerComponent.get(id);
    }

    public static clear(): void {
        this.triggerActions.clear();
    }
}
