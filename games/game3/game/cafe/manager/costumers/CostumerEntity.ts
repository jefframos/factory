import * as PIXI from 'pixi.js';
import { ItemType } from '../../progression/ProgressionManager';
import EntityView from '../../view/EntityView';
import MoveableEntity from '../../view/MoveableEntity';
import { OrderEntry } from './OrderTable';
import { OrderView } from './OrderView';

export class CustomerEntity extends MoveableEntity {
    public id: number = -1;
    public state: 'queue' | 'waiting' | 'ready' = 'queue';

    public speed = 100; // pixels per second
    private targetPosition: PIXI.Point = new PIXI.Point();

    private isMovingToTarget = false;
    private wasAtTargetLastFrame = true;

    public onStartMoving?: () => void;
    public onReachTarget?: () => void;

    private orderView?: OrderView;
    private currentOrderKey = '';

    public get isAtTarget(): boolean {
        const dx = this.targetPosition.x - this.x;
        const dy = this.targetPosition.y - this.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        return dist <= 0.5;
    }

    constructor() {
        super();

        this.position.x += (Math.random() - 0.5) * 10;
        this.speed *= (Math.random() * 0.01 + 0.99);
    }

    public positionTo(x: number, y: number): void {
        this.position.set(x, y);
        this.targetPosition.set(x, y);
    }

    public moveTo(x: number, y: number): void {
        this.targetPosition.set(x, y);
        this.isMovingToTarget = true;
    }

    public update(delta: number): void {
        const dx = this.targetPosition.x - this.x;
        const dy = this.targetPosition.y - this.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        let direction = new PIXI.Point(0, 0);

        if (dist > 0.5) {
            const vx = (dx / dist) * this.speed * delta;
            const vy = (dy / dist) * this.speed * delta;

            this.x += vx;
            this.y += vy;

            direction.set(dx / dist, dy / dist);

            if (!this.isMovingToTarget) {
                this.isMovingToTarget = true;
                this.onStartMoving?.();
            }

            this.wasAtTargetLastFrame = false;
        } else {
            if (!this.wasAtTargetLastFrame) {
                this.x = this.targetPosition.x;
                this.y = this.targetPosition.y;
                this.wasAtTargetLastFrame = true;
                this.isMovingToTarget = false;
                this.setWaiting();
                this.onReachTarget?.();
            }
        }

        this.setInput(direction, dist);
        this.zIndex = this.y;

        if (this.viewContainer) {
            this.viewContainer.scale.x += (this.targetScale.x - this.viewContainer.scale.x) * Math.min(this.flipLerpSpeed * delta, 1);
            this.viewContainer.scale.y = this.targetScale.y;

            if (this.viewContainer instanceof EntityView) {
                this.viewContainer.update(delta);
                const isIdle = this.magnitude < 0.01;
                this.viewContainer.setIdleState(isIdle);
            }
        }

        if (this.orderView) {
            const parentScaleX = this.viewContainer?.scale.x || 1;
            const parentScaleY = this.viewContainer?.scale.y || 1;

            this.orderView.scale.set(
                (1 / parentScaleX),
                (1 / parentScaleY)
            );
            this.orderView.visible = true

        }
    }

    public showOrder(order: OrderEntry[]) {
        // Merge items by itemType
        let mergedOrder: OrderEntry[] = order;
        if (order.length > 1) {

            const mergedMap = new Map<ItemType, number>();
            for (const entry of order) {
                if (entry.amount <= 0) continue;
                mergedMap.set(entry.itemType, (mergedMap.get(entry.itemType) || 0) + entry.amount);
            }

            mergedOrder = Array.from(mergedMap.entries()).map(([itemType, amount]) => ({
                itemType,
                amount
            }));
        }

        // Avoid rebuild if nothing changed
        const orderKey = mergedOrder.map(e => `${e.itemType}:${e.amount}`).sort().join(',');
        if (orderKey === this.currentOrderKey) return;
        this.currentOrderKey = orderKey;

        if (!this.orderView) {
            this.orderView = new OrderView(() => {
                this.viewContainer?.removeChild(this.orderView!);
                this.currentOrderKey = '';
            });
            this.viewContainer?.addChild(this.orderView);
            this.orderView.x = 0;
            this.orderView.y = -80;
            this.orderView.visible = false;
        }

        this.orderView.updateOrder(mergedOrder);
    }
    public setWaiting(): void {
        this.state = 'waiting';
    }

    public setQueue(): void {
        this.state = 'queue';
        if (this.orderView) {
            this.orderView.visible = false
        }

    }

    public setReady(): void {
        this.state = 'ready';
        if (this.orderView) {
            this.orderView.visible = false
        }

    }
}
