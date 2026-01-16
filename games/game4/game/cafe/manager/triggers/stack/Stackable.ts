
import ViewUtils from '@core/utils/ViewUtils';
import * as PIXI from 'pixi.js';
import { ItemType } from '../../../progression/ProgressionManager';
// ---- StackableItem ----
import { gsap } from 'gsap';
import { ItemAssetRegistry } from '../../../assets/ItemAssetRegistry';

export class StackableItem {
    constructor(public sprite: PIXI.Sprite, public itemType: ItemType) { }
    public destroy() {
        this.sprite.destroy()
    }
}

export class ItemStack {
    private items: StackableItem[] = [];
    public container: PIXI.Container;

    constructor(
        public parentContainer: PIXI.Container,
        public maxSize: number,
        public baseX: number,
        public baseY: number,
        public yOffset: number
    ) {
        this.container = new PIXI.Container();
        this.parentContainer.addChild(this.container);
        this.container.x = this.baseX;
        this.container.y = this.baseY;
    }

    get amount(): number {
        return this.items.length;
    }

    get isFull(): boolean {
        return this.items.length >= this.maxSize;
    }

    public setPosition(x: number, y: number): void {
        this.container.position.set(x, y);

        this.container.zIndex = y
    }

    public setMaxSize(newSize: number): void {
        this.maxSize = newSize;
        // Optional: remove excess items if new size is smaller
        while (this.items.length > newSize) {
            const removed = this.items.pop();
            removed?.destroy(); // or handle accordingly
        }
    }

    add(item: StackableItem): boolean {
        if (this.isFull) return false;

        if (item && item.sprite) {
            gsap.killTweensOf(item.sprite);
            gsap.killTweensOf(item.sprite.scale);
        }

        const targetY = -this.items.length * this.yOffset;
        item.sprite.y = targetY - this.yOffset * 2;
        const scale = item.sprite.scale.clone()
        item.sprite.scale.set(0);
        item.sprite.anchor.set(0.5)

        this.container.addChild(item.sprite);
        this.items.push(item);


        // Animate with pop and bounce
        gsap.to(item.sprite.scale, {
            x: scale.x,
            y: scale.y,
            ease: 'bounce.out',
            duration: 0.6
        });
        gsap.to(item.sprite, {
            y: targetY,
            delay: 0.3,
            ease: 'bounce.out',
            duration: 0.6
        });

        item.sprite.zIndex = -targetY + this.baseX * 1000;
        this.container.zIndex = -this.baseY + this.baseX * 1000;

        return true;
    }
    removeFirstItem(): boolean {
        if (this.items.length <= 0) return false
        const index = 0
        const item = this.items[index];
        this.container.removeChild(item.sprite);


        if (item && item.sprite) {
            this.removeTweens(item.sprite);
        }

        item.sprite.destroy();
        this.items.splice(index, 1);

        this.reorderItems();
        return true;
    }
    removeFirstOfType(type: ItemType): boolean {
        const index = this.items.findIndex(i => i.itemType === type);
        if (index === -1) return false;

        const item = this.items[index];
        this.container.removeChild(item.sprite);


        if (item && item.sprite) {
            this.removeTweens(item.sprite);
        }

        item.sprite.destroy();
        this.items.splice(index, 1);

        this.reorderItems();
        return true;
    }

    reorderItems(): void {
        for (let i = 0; i < this.items.length; i++) {
            const item = this.items[i];
            const targetY = -i * this.yOffset;

            if (item && item.sprite) {
                this.removeTweens(item.sprite);
            }
            gsap.to(item.sprite, {
                y: targetY,
                ease: 'bounce.out',
                duration: 0.5
            });

            item.sprite.zIndex = -targetY + this.baseX * 1000;
        }
    }
    removeTweens(item: PIXI.Sprite) {
        gsap.killTweensOf(item);
        gsap.killTweensOf(item.scale);
    }
    clear(): void {
        for (const item of this.items) {
            this.container.removeChild(item.sprite);
            this.removeTweens(item.sprite);
            item.sprite.destroy();
        }
        this.items.length = 0;
    }
}


// ---- StackList ----

export default class StackList {
    private stacks: ItemStack[] = [];
    private size: number;
    private baseX: number = 0;
    private baseY: number = 0;
    private xOffset: number;
    private yOffset: number;

    constructor(
        private container: PIXI.Container,
        numStacks: number,
        stackSize: number,
        xOffset: number,
        yOffset: number,
        size: number = 100
    ) {
        this.size = size;
        this.xOffset = xOffset;
        this.yOffset = yOffset;

        for (let i = 0; i < numStacks; i++) {
            const relX = i * xOffset;
            this.stacks.push(new ItemStack(container, stackSize, relX, 0, yOffset));
        }
    }
    public hasAvailableSpace(): boolean {
        return this.totalAmount < this.stacks.length * this.stacks[0].maxSize;
    }

    /** Set new position for the entire stack group */
    public setPosition(x: number, y: number): void {
        this.baseX = x;
        this.baseY = y;

        for (let i = 0; i < this.stacks.length; i++) {
            const stack = this.stacks[i];
            const relX = i * this.xOffset;
            stack.setPosition(this.baseX + relX, this.baseY);


        }
    }
    public addItemFromType(itemType: ItemType): boolean {

        const asset = ItemAssetRegistry.get(itemType);

        const sprite = PIXI.Sprite.from(asset.spriteId);
        const item = new StackableItem(sprite, itemType);
        const added = this.addItem(item);

        if (!added) {
            sprite.destroy();
        }

        return added
    }


    public addItem(item: StackableItem): boolean {
        item.sprite.scale.set(ViewUtils.elementScaler(item.sprite, this.size));
        for (const stack of this.stacks) {
            if (stack.add(item)) return true;
        }
        return false;
    }

    /** Check if any item of a given type exists in any stack */
    public hasItemOfType(type: ItemType): boolean {
        return this.stacks.some(stack =>
            stack['items']?.some(item => item.itemType === type)
        );
    }

    /** Remove one item of the given type from any stack */
    public removeOneItemOfType(type: ItemType): boolean {
        for (const stack of this.stacks) {
            if (stack.removeFirstOfType(type)) return true;
        }
        return false;
    }

    /** Get the item type of the first item in the first stack */
    public getFirstItemType(): ItemType | null {
        if (this.stacks.length === 0 || this.stacks[0].amount === 0) {
            return null;
        }
        return this.stacks[0]['items'][0]?.itemType || null;
    }
    /** Remove one item of the given type from any stack */
    public removeFirstItem(): boolean {
        for (const stack of this.stacks) {
            if (stack.removeFirstItem()) return true;
        }
        return false;
    }


    public clear(): void {
        for (const stack of this.stacks) {
            stack.clear();
        }
    }

    get totalAmount(): number {
        return this.stacks.reduce((sum, s) => sum + s.amount, 0);
    }

    public getStacks(): ItemStack[] {
        return this.stacks;
    }

    public addStack(stackSize: number): void {
        const relX = this.stacks.length * this.xOffset;
        const relY = 0;
        const stack = new ItemStack(this.container, stackSize, relX, relY, this.yOffset);
        this.stacks.push(stack);
    }

    public removeStacksFromEnd(count: number): void {
        for (let i = 0; i < count; i++) {
            const removed = this.stacks.pop();
            if (removed) removed?.clear(); // Assuming ItemStack has a destroy method
        }
    }

    public resizeStacks(newStackSize: number): void {
        for (const stack of this.stacks) {
            stack.setMaxSize(newStackSize); // Assuming ItemStack supports this
        }
    }
}
