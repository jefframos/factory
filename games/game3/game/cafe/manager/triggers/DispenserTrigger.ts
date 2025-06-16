import * as PIXI from 'pixi.js';
import { UpgradeTrigger } from './UpgradeTrigger';
import StackList, { StackableItem } from './stack/Stackable';

export default class DispenserTrigger extends UpgradeTrigger {
    protected elapsed = 0;
    protected interval = 2;

    protected _stackList!: StackList;
    public get stackList(): StackList {
        return this._stackList;
    }

    constructor(id: string, levelId: string = 'default') {
        super(id, levelId);
        this._stackList = new StackList(this.areaContainer, 3, 5, 40, 15, 60); // 3 stacks, 5 items max, 40px offset
        this.areaContainer.sortableChildren = true;

    }

    public update(delta: number): void {
    }

    public tryExecuteAction(): void {
        this.triggerBox.onTriggerAction.dispatch(this.id, this);
    }

    public onAction(): void {
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
