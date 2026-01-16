import * as PIXI from 'pixi.js';
import { ItemAssetRegistry } from '../../assets/ItemAssetRegistry';
import { ItemType } from '../../progression/ProgressionManager';
import { OrderEntry } from './OrderTable';

export class OrderView extends PIXI.Container {
    private background: PIXI.NineSlicePlane;
    private itemRows: Map<string, PIXI.Container> = new Map();
    private onCompleted?: () => void;
    private contentContainer: PIXI.Container;

    constructor(onCompleted?: () => void) {
        super();
        this.onCompleted = onCompleted;

        //const texture = PIXI.Texture.from('bubble');
        const texture = PIXI.Texture.from('Button01_s_White_Bg');
        //this.background = new PIXI.NineSlicePlane(texture, 16, 40, 16, 100);
        this.background = new PIXI.NineSlicePlane(texture, 30, 30, 30, 30);
        this.background.width = 80;
        this.background.height = 60;

        // Container to hold background + rows
        this.contentContainer = new PIXI.Container();
        this.contentContainer.addChild(this.background);
        this.addChild(this.contentContainer);

        // Center on bottom
        this.contentContainer.pivot.set(this.background.width / 2, this.background.height);
    }

    public updateOrder(entries: OrderEntry[]) {
        let anyVisible = false;

        for (const entry of entries) {
            const key = entry.itemType;

            if (entry.amount <= 0) {
                const existing = this.itemRows.get(key);
                if (existing) {
                    this.contentContainer.removeChild(existing);
                    this.itemRows.delete(key);
                }
                continue;
            }

            anyVisible = true;

            let row = this.itemRows.get(key);
            if (!row) {
                row = this.createRow(entry.itemType);
                this.itemRows.set(key, row);
                this.contentContainer.addChild(row);
            }

            this.updateRow(row, entry.amount);
        }

        this.layoutRows();

        if (!anyVisible) {
            this.visible = false;
            this.onCompleted?.();
        } else {
            this.visible = true;
        }
    }

    private createRow(type: ItemType): PIXI.Container {
        const container = new PIXI.Container();

        const assetView = ItemAssetRegistry.get(type);
        const icon = new PIXI.Sprite(PIXI.Texture.from(assetView.spriteId));
        icon.width = icon.height = 24;
        container.addChild(icon);

        const label = new PIXI.Text('x0', { fontSize: 24, fill: 0 });
        label.name = 'label';
        container.addChild(label);

        return container;
    }

    private updateRow(row: PIXI.Container, amount: number) {
        const label = row.getChildByName('label') as PIXI.Text;
        if (label && label.text !== `x${amount}`) {
            label.text = `x${amount}`;
        }
    }

    private layoutRows() {
        const topPadding = 10;
        const rowSpacing = 30;
        const bottomPadding = 10;
        let y = topPadding;
        let maxWidth = 0;

        for (const row of this.itemRows.values()) {
            const label = row.getChildByName('label') as PIXI.Text;
            label.x = 30;

            row.x = 0;
            row.y = y;
            y += rowSpacing;

            const rowWidth = label.x + label.width;
            if (rowWidth > maxWidth) maxWidth = rowWidth;
        }

        // Calculate total content height + padding
        const totalHeight = y + bottomPadding;
        this.background.height = totalHeight;
        this.background.width = Math.max(120, maxWidth + 20); // Optional: adjust width too

        // Update pivot for centering
        this.contentContainer.pivot.set(this.background.width / 2, this.background.height);

        // Center each row horizontally
        for (const row of this.itemRows.values()) {
            row.x = (this.background.width - row.width) / 2;
        }
    }

}
