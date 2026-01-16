import * as PIXI from 'pixi.js';
import { ItemType } from '../../progression/ProgressionManager';
import EntityView from '../../view/EntityView';
import MoveableEntity from '../../view/MoveableEntity';
import { OrderEntry } from './OrderTable';
import { OrderView } from './OrderView';

export enum CustomerState {
    Queue = 'queue',
    Waiting = 'waiting',
    Ready = 'ready',
    Table = 'table',
    WaitingForTable = 'waitingForTable',
    Ordering = 'Ordering',
    Eating = 'Eating',
    OrderFinished = 'orderFinished',
}

export class CustomerEntity extends MoveableEntity {

    public id: number = -1;
    public state: CustomerState = CustomerState.Queue;

    public speed = 100;
    private targetPosition: PIXI.Point = new PIXI.Point();
    private isMovingToTarget = false;
    private wasAtTargetLastFrame = true;
    private debugState: PIXI.Text = new PIXI.Text()

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

        this.addChild(this.debugState);
        this.debugState.anchor.set(0.5, 1);
        this.debugState.y = -50
    }

    public setState(state: CustomerState): void {

        if (this.state === CustomerState.OrderFinished && this.state != state) {

            if (this.orderView) {
                const initialScale = 1;
                const targetScale = 1.5;
                const duration = 500; // in milliseconds

                let elapsed = 0;
                const originalAlpha = this.orderView.alpha;

                const tween = (delta: number) => {
                    elapsed += delta * 16.67; // Approximation for delta in ms
                    const progress = Math.min(elapsed / duration, 1);

                    const scale = initialScale + (targetScale - initialScale) * progress;
                    this.orderView.scale.set(scale, scale);

                    this.orderView.alpha = originalAlpha * (1 - progress);

                    if (progress >= 1) {
                        this.orderView.visible = false;
                        PIXI.Ticker.shared.remove(tween);
                    }
                };

                PIXI.Ticker.shared.add(tween);
            }
        }
        this.state = state;
    }

    public positionTo(x: number, y: number): void {
        this.position.set(x, y);
        this.targetPosition.set(x, y);
    }

    public moveTo(x: number, y: number): void {
        this.targetPosition.set(x, y);
        this.isMovingToTarget = true;
    }
    updateEatingTimer(timeLeft: number) {
        console.log('WAITING FOR TABLE STATE NOT WORKING', timeLeft)
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
                this.setState(CustomerState.Waiting);
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
            this.orderView.visible = true;
        }

        this.debugState.text = this.state
    }

    public showOrder(order: OrderEntry[]) {
        let mergedOrder: OrderEntry[] = order;
        if (order.length > 1) {
            const mergedMap = new Map<ItemType, number>();
            for (const entry of order) {
                if (entry.amount <= 0) continue;
                mergedMap.set(entry.itemType, (mergedMap.get(entry.itemType) || 0) + entry.amount);
            }

            mergedOrder = Array.from(mergedMap.entries()).map(([itemType, amount]) => ({ itemType, amount }));
        }

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
}
