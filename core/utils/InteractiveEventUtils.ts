import * as PIXI from 'pixi.js';

export default class InteractiveEventUtils {
    private static eventListeners: WeakMap<PIXI.DisplayObject, Map<string, (...args: any) => void>> = new WeakMap();

    static addEvent(target: PIXI.DisplayObject, event: string, callback: (...args: any) => void) {
        // Ensure the target has an entry in the event listeners map
        if (!this.eventListeners.has(target)) {
            this.eventListeners.set(target, new Map());
        }

        // Add the event listener
        const eventMap = this.eventListeners.get(target)!;
        eventMap.set(event, callback);
        target.on(event, callback);

        // Override the target's destroy method to remove events
        const originalDestroy = target.destroy;
        target.destroy = (...args: any[]) => {
            this.removeEvents(target);
            originalDestroy.apply(target, args);
        };
    }

    static removeEvents(target: PIXI.DisplayObject) {
        if (this.eventListeners.has(target)) {
            const eventMap = this.eventListeners.get(target)!;
            for (const [event, callback] of eventMap.entries()) {
                target.off(event, callback);
            }
            this.eventListeners.delete(target);
        }
    }

    static addPointerOver(target: PIXI.DisplayObject, callback: (event: PIXI.FederatedPointerEvent) => void) {
        target.interactive = true;
        this.addEvent(target, 'pointerover', callback);
    }

    static addPointerOut(target: PIXI.DisplayObject, callback: (event: PIXI.FederatedPointerEvent) => void) {
        target.interactive = true;
        this.addEvent(target, 'pointerout', callback);
    }

    static addPointerMove(target: PIXI.DisplayObject, callback: (event: PIXI.FederatedPointerEvent) => void) {
        target.interactive = true;
        this.addEvent(target, 'pointermove', callback);
    }

    static addClickTap(target: PIXI.DisplayObject, callback: (event: PIXI.FederatedPointerEvent) => void) {
        target.interactive = true;
        this.addEvent(target, 'pointertap', callback);
        //this.addEvent(target, 'click', callback);
    }

    static addPointerDown(target: PIXI.DisplayObject, callback: (event: PIXI.FederatedPointerEvent) => void) {
        target.interactive = true;
        this.addEvent(target, 'pointerdown', callback);
    }

    static addPointerUp(target: PIXI.DisplayObject, callback: (event: PIXI.FederatedPointerEvent) => void) {
        target.interactive = true;
        this.addEvent(target, 'pointerup', callback);
    }

    static addPointerUpOutside(target: PIXI.DisplayObject, callback: (event: PIXI.FederatedPointerEvent) => void) {
        target.interactive = true;
        this.addEvent(target, 'pointerupoutside', callback);
    }

    static addWheel(target: PIXI.DisplayObject, callback: (event: PIXI.FederatedPointerEvent | PIXI.FederatedWheelEvent) => void) {
        target.interactive = true;

        target.on('wheel', (event: PIXI.FederatedWheelEvent) => {
            event.preventDefault();
            callback(event);
        }, { passive: false });
    }
}