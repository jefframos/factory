import * as PIXI from 'pixi.js';
import DispenserTrigger from './DispenserTrigger';
import { StackableItem } from './stack/Stackable';

export default class TimeDispenserTrigger extends DispenserTrigger {


    public update(delta: number): void {
        if (!this.isActive) return;
        this.elapsed += delta;
        while (this.elapsed >= this.interval) {
            this.elapsed -= this.interval;
            this.tryExecuteAction();
        }
    }


    public onAction(): void {
        if (!this.isActive) return;
        const sprite = PIXI.Sprite.from('ItemIcon_Money_Bill'); // Replace with your asset
        const item = new StackableItem(sprite);
        const added = this._stackList.addItem(item);
        if (!added) {
            sprite.destroy(); // optional: destroy unused
            console.warn('All stacks full, item discarded');
        }
    }

    public onEnter(): void {
        console.log(`Player entered: ${this.id}`, this._stackList.totalAmount);
        //this.stackList.clear();
    }
}
