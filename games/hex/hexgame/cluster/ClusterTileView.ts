import * as PIXI from "pixi.js";
import { HexUtils } from "../HexTypes";

export class ClusterTileView extends PIXI.Container {
    private graphics: PIXI.Graphics = new PIXI.Graphics();
    private sprite?: PIXI.Sprite;

    constructor() {
        super();
        this.addChild(this.graphics);
    }

    /**
     * @param color The hex color for the background
     * @param texture Optional sprite texture to display instead of a flat color
     */
    public setup(color: number, texture?: PIXI.Texture): void {
        this.graphics.clear();

        const targetWidth = Math.sqrt(3) * HexUtils.HEX_SIZE;
        // The total height of a pointy-top hexagon
        const targetHeight = 2 * HexUtils.HEX_SIZE;

        if (texture) {
            // Remove graphics fill if using a sprite
            if (!this.sprite) {
                this.sprite = new PIXI.Sprite(texture);
                this.sprite.anchor.set(0.5);
                this.addChild(this.sprite);
            } else {
                this.sprite.texture = texture;
            }

            this.sprite.width = targetWidth //+ 2;
            this.sprite.height = targetHeight - 4;
            this.sprite.x = 0//-5
            this.sprite.visible = true;
        } else {
            // Fallback: Draw the hexagon graphics
            if (this.sprite) this.sprite.visible = false;

            this.graphics.lineStyle(2, 0x000000, 0.5);
            this.graphics.beginFill(color);

            const points = [];
            for (let i = 0; i < 6; i++) {
                const angle = (Math.PI / 180) * (60 * i - 30);
                points.push(
                    HexUtils.HEX_SIZE * Math.cos(angle),
                    HexUtils.HEX_SIZE * Math.sin(angle)
                );
            }
            this.graphics.drawPolygon(points);
            this.graphics.endFill();
        }
    }
}