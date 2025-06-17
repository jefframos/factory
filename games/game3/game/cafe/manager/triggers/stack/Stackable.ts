
import { DebugGraphicsHelper } from '@core/utils/DebugGraphicsHelper';
import ViewUtils from '@core/utils/ViewUtils';
import * as PIXI from 'pixi.js';
// ---- StackableItem ----
export class StackableItem {
    constructor(public sprite: PIXI.Sprite) { }
}


// ---- ItemStack ----
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
        this.container = new PIXI.Container()
        this.parentContainer.addChild(this.container)
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
        // Option 1: set a dedicated container's position (best way)
        this.container.position.set(x, y);

    }
    add(item: StackableItem): boolean {
        if (this.isFull) return false;
        this.container.zIndex = -this.baseY + this.baseX * 1000

        item.sprite.y = - this.items.length * this.yOffset;
        item.sprite.zIndex = -item.sprite.y + this.baseX * 1000
        this.container.addChild(item.sprite);
        this.items.push(item);
        return true;
    }

    clear(): void {
        for (const item of this.items) {
            this.container.removeChild(item.sprite);
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
            const relY = 0;
            this.stacks.push(new ItemStack(container, stackSize, relX, relY, yOffset));
        }

        DebugGraphicsHelper.addCircle(container);
    }

    /** Set new position for the entire stack group */
    public setPosition(x: number, y: number): void {
        this.baseX = x;
        this.baseY = y;

        for (let i = 0; i < this.stacks.length; i++) {
            const stack = this.stacks[i];
            const relX = i * this.xOffset;
            stack.setPosition(this.baseX + relX, this.baseY); // assumes `ItemStack` has this
        }
    }

    addItem(item: StackableItem): boolean {
        item.sprite.scale.set(ViewUtils.elementScaler(item.sprite, this.size));
        for (const stack of this.stacks) {
            if (stack.add(item)) return true;
        }
        return false;
    }

    clear(): void {
        for (const stack of this.stacks) {
            stack.clear();
        }
    }

    get totalAmount(): number {
        return this.stacks.reduce((sum, s) => sum + s.amount, 0);
    }
}
