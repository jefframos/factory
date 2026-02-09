import * as PIXI from "pixi.js";
import { ClusterData, getColorEntryById, getColorValueById, HexUtils } from "../HexTypes";
import { ClusterTileView } from "./ClusterTileView"; // Import the new class

export class ClusterView extends PIXI.Container {
    public data!: ClusterData;
    private tiles: ClusterTileView[] = [];
    public visualCenter: PIXI.Point = new PIXI.Point();
    public homePosition: PIXI.Point = new PIXI.Point();

    public setup(data: ClusterData): void {
        this.data = data;
        const hexColor = typeof data.color === 'string' ? getColorValueById(data.color) : data.color;


        // Ensure we have enough TileView instances (Object Pooling Lite)
        while (this.tiles.length < data.coords.length) {
            const tile = new ClusterTileView();
            this.addChild(tile);
            this.tiles.push(tile);
        }

        // Hide unused tiles if data size decreased
        this.tiles.forEach((tile, index) => {
            if (index >= data.coords.length) {
                tile.visible = false;
                return;
            }

            const coord = data.coords[index];
            const pos = HexUtils.offsetToPixel(coord.q, coord.r);

            tile.visible = true;
            tile.position.set(pos.x, pos.y);
            const colorData = getColorEntryById(data.color)
            tile.setup(hexColor, colorData?.texture ? PIXI.Texture.from(colorData.texture) : undefined);
            tile.zIndex = 100 + pos.y; // Pass the texture here if available
            //tile.setup(hexColor, PIXI.Texture.from(getColorEntryById(data.color))); // Pass the texture here if available
        });

        this.sortChildren();
        // Calculate visual center based on the bounds of all tiles
        const bounds = this.getLocalBounds();
        this.visualCenter.set(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    }

    public reset(): void {
        this.tiles.forEach(t => t.visible = false);
        this.position.set(0);
    }
}