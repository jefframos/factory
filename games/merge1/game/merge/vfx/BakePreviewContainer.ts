import { Game } from "@core/Game";
import * as PIXI from "pixi.js";
import MergeAssets from "../../MergeAssets";
import { BakeDirection, TextureBaker } from "../vfx/TextureBaker";

export class BakePreviewContainer extends PIXI.Container {
    constructor() {
        super();
        this.generateGrid();
    }

    private generateGrid(): void {
        const columns = 6;      // Number of sprites per row
        const spacing = 110;    // Space between sprites
        const startX = 50;
        const startY = 50;

        // Iterate through all color sets defined in MergeAssets
        MergeAssets.Colors.forEach((colors, index) => {
            const level = index + 1;

            // 1. Bake the texture (Testing Horizontal/Vertical here)
            const direction = BakeDirection.HORIZONTAL// level % 2 === 0 ? BakeDirection.HORIZONTAL : BakeDirection.VERTICAL;

            const bakedTexture = TextureBaker.getTexture(
                level,
                'BubbleFrame01_Bg',
                colors,
                Game.renderer,
                direction
            );

            // 2. Create the Sprite
            const sprite = new PIXI.Sprite(bakedTexture);
            sprite.anchor.set(0.5);

            // 3. Position in Grid
            const row = Math.floor(index / columns);
            const col = index % columns;
            sprite.x = startX + col * spacing;
            sprite.y = startY + row * spacing;

            // 4. Add a Label for the Level
            const label = new PIXI.Text(level.toString(), {
                fill: 0xffffff,
                fontSize: 14,
                fontWeight: 'bold',
                stroke: 0x000000,
                strokeThickness: 3
            });
            label.anchor.set(0.5);
            label.y = 40; // Position below the sprite
            sprite.addChild(label);

            this.addChild(sprite);
        });

        // Optional: Scale the whole preview to fit the screen
        this.scale.set(0.8);
    }
}