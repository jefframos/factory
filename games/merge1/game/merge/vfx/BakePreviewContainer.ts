import { Game } from "@core/Game";
import * as PIXI from "pixi.js";
import { StaticData } from "../data/StaticData";
import { BlockMergeEntity } from "../entity/BlockMergeEntity";
import { BakeDirection, TextureBaker } from "../vfx/TextureBaker";

export class BakePreviewContainer extends PIXI.Container {
    constructor() {
        super();
        //this.generateGrid();
    }

    public generatePieces(): void {

        const columns = 6;      // Number of sprites per row
        const spacing = 100;    // Space between sprites
        const startX = 50;
        const startY = 200;

        for (let index = 0; index < StaticData.entityCount; index++) {
            const baseM = new BlockMergeEntity();
            baseM.init(index + 1, '', '')
            baseM.complete()
            const row = Math.floor(index / columns);
            const col = index % columns;
            baseM.x = startX + col * spacing;
            baseM.y = startY + row * spacing;
            baseM.scale.set(0.5)

            this.addChild(baseM);


        }
    }

    public generateFramesGrid(frameKeys: string[], portraits: string[]): void {
        const columns = 6;      // Number of frames per row
        const spacing = 150;    // Increased spacing for frames
        const startX = 75;
        const startY = 75;

        for (let index = 1; index <= StaticData.entityCount; index++) {
            const level = index;

            // 1. Get the frame key (cycle through list if fewer frames than levels)
            const frameKey = frameKeys[(index - 1) % frameKeys.length];
            const portraitKey = portraits[(index - 1) % portraits.length];

            // 2. Bake the texture using our new method
            const bakedFrameTexture = TextureBaker.bakeFramedEntity(
                level,
                frameKey,
                Game.renderer,
                portraitKey
            );

            const lockTex = TextureBaker.getTexture(`Entity_${level}_Frame_LOCKED`)
            //console.log(lockTex)
            // 3. Create and position the Sprite
            //const sprite = new PIXI.Sprite(bakedFrameTexture);
            const sprite = new PIXI.Sprite(lockTex);
            sprite.anchor.set(0.5);

            const row = Math.floor((index - 1) / columns);
            const col = (index - 1) % columns;

            sprite.x = startX + col * spacing;
            sprite.y = startY + row * spacing;
            sprite.scale.set(0.8); // Adjust scale if they are too big for the screen

            // // 4. Label for Level/Frame info
            // const label = new PIXI.Text(`Lvl ${level}`, {
            //     fill: 0xffffff,
            //     fontSize: 16,
            //     fontWeight: 'bold',
            //     stroke: 0x000000,
            //     strokeThickness: 4
            // });
            // label.anchor.set(0.5);
            // label.y = (sprite.height / 2) + 20;
            // sprite.addChild(label);

            this.addChild(sprite);
        }
    }

    public generateGrid(): void {
        const columns = 6;      // Number of sprites per row
        const spacing = 110;    // Space between sprites
        const startX = 50;
        const startY = 50;

        for (let index = 1; index <= StaticData.entityCount; index++) {
            const level = index

            const data = StaticData.getAnimalData(level)
            // 1. Bake the texture (Testing Horizontal/Vertical here)
            const direction = BakeDirection.HORIZONTAL// level % 2 === 0 ? BakeDirection.HORIZONTAL : BakeDirection.VERTICAL;

            const bakedTexture = TextureBaker.getStripedTintedTexture(
                level,
                'BubbleFrame01_Bg',
                data.colors,
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
        }


        // Optional: Scale the whole preview to fit the screen
        //this.scale.set(0.8);
    }
}