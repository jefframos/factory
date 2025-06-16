
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

    constructor(
        public container: PIXI.Container,
        public maxSize: number,
        public baseX: number,
        public baseY: number,
        public yOffset: number
    ) { }

    get amount(): number {
        return this.items.length;
    }

    get isFull(): boolean {
        return this.items.length >= this.maxSize;
    }

    add(item: StackableItem): boolean {
        if (this.isFull) return false;

        item.sprite.x = this.baseX;
        item.sprite.y = this.baseY - this.items.length * this.yOffset;
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
    constructor(
        container: PIXI.Container,
        numStacks: number,
        stackSize: number,
        xOffset: number,
        yOffset: number,
        size: number = 100
    ) {
        this.size = size;
        for (let i = 0; i < numStacks; i++) {
            const baseX = i * xOffset;
            const baseY = 0;
            this.stacks.push(new ItemStack(container, stackSize, baseX, baseY, yOffset));
        }

        DebugGraphicsHelper.addCircle(container)
    }

    addItem(item: StackableItem): boolean {
        item.sprite.scale.set(ViewUtils.elementScaler(item.sprite, this.size))
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
