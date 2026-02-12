import Pool from "@core/Pool";
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

        // Fetch from pool instead of 'new'
        while (this.tiles.length < data.coords.length) {
            const tile = Pool.instance.getElement(ClusterTileView);
            this.addChild(tile);
            this.tiles.push(tile);
        }

        this.tiles.forEach((tile, index) => {
            if (index >= data.coords.length) {
                tile.visible = false;
                return;
            }

            const coord = data.coords[index];
            const pos = HexUtils.offsetToPixel(coord.q, coord.r);

            tile.visible = true;
            tile.position.set(pos.x, pos.y);
            tile.scale.set(1);
            tile.alpha = 1;

            const colorData = getColorEntryById(data.color);
            tile.setup(hexColor, colorData?.texture ? PIXI.Texture.from(colorData.texture) : undefined);
        });

        this.sortChildren();
        // Calculate visual center based on the bounds of all tiles
        const bounds = this.getLocalBounds();
        this.visualCenter.set(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    }

    // Inside ClusterView.ts
    public reset(): void {
        // Return all internal tiles to the pool
        this.tiles.forEach(tile => {
            tile.reset();
            Pool.instance.returnElement(tile);
        });
        this.tiles = []; // Clear the array so setup() creates/fetches fresh ones
        this.position.set(0);
        this.visible = false;
    }
}