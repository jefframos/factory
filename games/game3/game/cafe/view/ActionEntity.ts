import * as PIXI from 'pixi.js';
import StackList, { StackableItem } from '../manager/triggers/stack/Stackable';
import { ItemType } from '../progression/ProgressionManager';
import MoveableEntity from './MoveableEntity';
export default class ActionEntity extends MoveableEntity {

    public stackList!: StackList

    constructor(tag?: string) {
        super(tag)
    }
    protected characterReady(): void {
        this.stackList = new StackList(this, 1, 5, 0, 10, 50);
        this.stackList.setPosition(30, -50)
    }
    public get canStack() {
        console.warn('this must return if the item can be taken, if fits on the stack')
        return this.stackList.totalAmount
    }
    public takeItem(itemType: ItemType, itemQuantity: number = 1) {

        const sprite = PIXI.Sprite.from('ItemIcon_Money_Bill'); // Replace with your asset
        const item = new StackableItem(sprite, itemType);
        const added = this.stackList.addItem(item);

    }
    public update(delta: number): void {
        super.update(delta);

        if (this.viewContainer) {

            if (this.viewContainer.scale.x > 0) {
                this.stackList.setPosition(-30, -50)
            } else {
                this.stackList.setPosition(30, -50)

            }
        }
    }
}