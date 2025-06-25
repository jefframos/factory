import StackList from '../manager/triggers/stack/Stackable';
import { ItemType } from '../progression/ProgressionManager';
import MoveableEntity from './MoveableEntity';

export default class ActionEntity extends MoveableEntity {
    public stackList!: StackList;

    private pickupTimer: number = 0;
    private pickupCooldown: number = 1.5; // seconds

    private disposeTimer: number = 0;
    private disposeCooldown: number = 1.5; // seconds

    constructor(tag?: string) {
        super(tag);
    }

    protected characterReady(): void {
        this.stackList = new StackList(this, 1, 5, 0, 10, 50);
        this.stackList.setPosition(30, -50);
    }

    public get canStack(): boolean {
        return this.stackList.hasAvailableSpace();
    }

    public pickupAllowed(): boolean {
        return this.pickupTimer <= 0 && this.canStack;
    }

    public disposeAllowed(): boolean {
        return this.disposeTimer <= 0;
    }

    public disposeFirstItem(): boolean {
        if (!this.stackList.totalAmount) return false;
        const removed = this.stackList.removeFirstItem()
        if (removed) {
            this.disposeTimer = this.disposeCooldown;
        }
        return removed;
    }

    public disposeItem(itemType: ItemType, itemQuantity: number = 1): boolean {
        if (!this.stackList.hasItemOfType(itemType)) return false;

        const removed = this.stackList.removeOneItemOfType(itemType);
        if (removed) {
            this.disposeTimer = this.disposeCooldown;
            return true;
        }

        return false;
    }

    public takeItem(itemType: ItemType, itemQuantity: number = 1): void {
        if (!this.pickupAllowed()) return;

        if (this.stackList.addItemFromType(itemType)) {
            this.pickupTimer = this.pickupCooldown;
        }
    }

    public update(delta: number): void {
        super.update(delta);

        if (this.pickupTimer > 0) {
            this.pickupTimer -= delta;
        }

        if (this.disposeTimer > 0) {
            this.disposeTimer -= delta;
        }

        if (this.viewContainer) {
            const offsetX = this.viewContainer.scale.x > 0 ? -30 : 30;
            this.stackList.setPosition(offsetX, -50);
        }
    }
}
