import { ItemType } from '../../progression/ProgressionManager';
import { UpgradeTrigger } from './UpgradeTrigger';
import StackList from './stack/Stackable';

export default class DispenserTrigger extends UpgradeTrigger {
    public itemType: ItemType = ItemType.MONEY
    protected elapsed = 0;
    protected _interval = 2;

    protected _stackList!: StackList;
    public get stackList(): StackList {
        return this._stackList;
    }
    public set interval(value: number) {
        this._interval = value;
    }


    constructor(id: string, radius: number = 30, levelId: string = 'default') {
        super(id, radius, levelId);
        this.areaContainer.sortableChildren = true;

    }
    public setStackPosition(x: number, y: number) {
        this._stackList.setPosition(x, y);
    }
    public setUpStackList(numStacks: number, stackSize: number, xOffset: number, yOffset: number, size?: number) {
        this._stackList = new StackList(this.areaContainer, numStacks, stackSize, xOffset, yOffset, size); // 3 stacks, 5 items max, 40px offset

    }
    public resizeStackList(numStacks: number, stackSize: number): void {
        const currentStacks = this._stackList.getStacks();
        const currentNumStacks = currentStacks.length;

        if (numStacks > currentNumStacks) {
            const stacksToAdd = numStacks - currentNumStacks;
            for (let i = 0; i < stacksToAdd; i++) {
                this._stackList.addStack(stackSize);
            }
        } else if (numStacks < currentNumStacks) {
            this._stackList.removeStacksFromEnd(currentNumStacks - numStacks);
        }

        this._stackList.resizeStacks(stackSize);
    }

    public update(delta: number): void {
    }

    public tryExecuteAction(): void {
        this.triggerBox.onTriggerAction.dispatch(this.id, this);
    }

    public onAction(): void {
        if (!this.isActive || !this._stackList.hasAvailableSpace()) return;

        this._stackList.addItemFromType(this.itemType)
        // const sprite = PIXI.Sprite.from('ItemIcon_Money_Bill'); // Replace with your asset
        // const item = new StackableItem(sprite, this.itemType);
        // const added = this._stackList.addItem(item);
        // if (!added) {
        //     sprite.destroy(); // optional: destroy unused
        //     console.warn('All stacks full, item discarded');
        // }
    }

    public onEnter(): void {
        console.log(`Player entered: ${this.id}`, this._stackList.totalAmount);
    }
}
