import { Game } from "@core/Game";
import { gsap } from "gsap"; // Ensure gsap is installed
import * as PIXI from "pixi.js";
import MergeAssets from "../MergeAssets";

import ViewUtils from "@core/utils/ViewUtils";
import { BakeDirection, TextureBaker } from "../vfx/TextureBaker";
import { BaseMergeEntity } from "./BaseMergeEntity";


export class BlockMergeEntity extends BaseMergeEntity {
    protected eyesContainer: PIXI.Container = new PIXI.Container();

    public initView(level: number, spriteId: string, animationId: string): void {
        this.visible = true;
        this.level = level;
        this.levelText.text = `${level}`;

        const totalLevels = 24;
        const minSize = 90;
        const maxSize = 140;
        const sizeRange = maxSize - minSize;

        // --- 1. Calculate Growth based on your "halves" logic ---
        // We normalize level to a progress value (0 to 1)
        const progress = (level - 1) / (totalLevels - 1);

        let targetWidth = minSize;
        let targetHeight = minSize;

        /**
         * Growth Pattern: 
         * 0.0 - 0.25: First half of Height
         * 0.25 - 0.5: Second half of Height
         * 0.5 - 0.75: First half of Width
         * 0.75 - 1.0: Second half of Height (Wait, your prompt says "final half of height")
         */
        const halfRange = (maxSize - minSize) / 2; // 35 pixels


        if (progress <= 0.25) {
            // 0% to 25%: Grow Width from 80 to 115
            const segmentProgress = progress / 0.25;
            targetWidth = minSize + (segmentProgress * halfRange);
            targetHeight = minSize;
        } else if (progress <= 0.50) {
            // 25% to 50%: Keep Width at 115, Grow Height from 80 to 115
            const segmentProgress = (progress - 0.25) / 0.25;
            targetWidth = minSize + halfRange;
            targetHeight = minSize + (segmentProgress * halfRange);
        } else if (progress <= 0.75) {
            // 50% to 75%: Grow Width from 115 to 150, Keep Height at 115
            const segmentProgress = (progress - 0.50) / 0.25;
            targetWidth = (minSize + halfRange) + (segmentProgress * halfRange);
            targetHeight = minSize + halfRange;
        } else {
            // 75% to 100%: Keep Width at 150, Grow Height from 115 to 150
            const segmentProgress = (progress - 0.75) / 0.25;
            targetWidth = maxSize;
            targetHeight = (minSize + halfRange) + (segmentProgress * halfRange);
        }

        // --- 2. Calculate Walk Speed (Mass vs Speed) ---
        // Faster speed (90) at level 1, Lowest speed (50) at level 24
        const maxSpeed = 90;
        const minSpeed = 50;
        this.walkSpeed = maxSpeed - (progress * (maxSpeed - minSpeed));

        // --- 3. Graphics Setup ---
        const levelColors = MergeAssets.Colors[level - 1];
        const bakedTexture = TextureBaker.getStripedTintedTexture(
            level,
            'BubbleFrame01_Bg',
            levelColors,
            Game.renderer,
            BakeDirection.HORIZONTAL
        );

        if (this.sprite instanceof PIXI.Sprite) {
            this.sprite.destroy();
            this.sprite = new PIXI.NineSlicePlane(PIXI.Texture.WHITE, 20, 20, 20, 20);
            this.spriteContainer.addChild(this.sprite);
            this.spriteContainer.addChild(this.eyesContainer);
            this.spriteContainer.addChild(this.levelText);
        }

        // Set Calculated Sizes
        this.sprite.width = targetWidth;
        this.sprite.height = targetHeight;



        if (this.highlight instanceof PIXI.Sprite) {
            this.highlight.destroy();
            this.highlight = new PIXI.NineSlicePlane(PIXI.Texture.from('BubbleFrame01_White'), 20, 20, 20, 20);
            // Highlight is slightly larger than the sprite           
            this.highlight.visible = false;
            this.spriteContainer.addChildAt(this.highlight, 0);
            this.spriteContainer.addChildAt(this.shadowContainer, 0);

        }

        this.highlight.width = targetWidth + 10;
        this.highlight.height = targetHeight + 10;


        this.coinOffset.x = 0//this.highlight.width / 2
        this.coinOffset.y = -this.highlight.height

        this.sprite.texture = bakedTexture;
        this.sprite.tint = 0xFFFFFF;

        this.shadow.scale.set(ViewUtils.elementScaler(this.shadow, targetWidth, targetWidth))
        this.shadow.scale.y /= 2;



        this.shadowContainer.alpha = 0;
        this.shadowContainer.y = 0;

        this.setupGooglyEyes(['eye', 'eye'])

        this.levelText.alpha = 0

        this.eyesContainer.x = targetWidth / 2;
        this.eyesContainer.y = this.sprite.height * 0.3;
    }
    public init(level: number, spriteId: string, animationId: string): void {
        this.initView(level, spriteId, animationId);

        this.sprite.pivot.x = this.sprite.width / 2;
        this.sprite.pivot.y = this.sprite.height;

        this.highlight.pivot.x = this.highlight.width / 2;
        this.highlight.pivot.y = this.highlight.height;
        // Positioning text and highlights relative to new size
        this.highlight.y = (this.highlight.height / 2 - this.sprite.height / 2);
        this.levelText.y = -this.sprite.height / 2 + 25;
        this.eyesContainer.x = 0
        this.eyesContainer.y = -this.sprite.height * 0.7;
        this.levelText.alpha = 1


        // --- 4. Animation ---


        this.spriteContainer.y = -50;
        this.spriteContainer.scale.set(0.6, 1.4);

        if (this.landingTimeline) this.landingTimeline.kill();
        this.isLanding = true;
        this.landingTimeline = gsap.timeline({
            onComplete: () => {
                this.isLanding = false;
                this.enterIdle();
            }
        });

        this.landingTimeline
            .to(this.spriteContainer, { y: 0, duration: 0.5, ease: "bounce.out" }, 0)
            .to(this.shadowContainer, { alpha: 1, duration: 0.5, ease: "bounce.out" }, 0)
            .to(this.spriteContainer.scale, { x: 0.6, y: 1.4, duration: 0.1, ease: "sine.out" }, 0)
            .to(this.spriteContainer.scale, { delay: 0.1, x: 1, y: 1, duration: 0.6, ease: "elastic.out" }, 0);
    }

    protected setupGooglyEyes(textureIds: string[]): void {
        // 1. Clear existing eyes
        this.eyesContainer.removeChildren().forEach(child => child.destroy());

        // 2. Determine eye count (1 or 2)
        const eyeCount = Math.random() > 0.5 ? 1 : 2;

        // 3. Define scaling logic
        // We want the eyes to fit within the sprite width. 
        // If 2 eyes, they should each take up roughly 35-40% of the width.
        const padding = 10;
        const availableWidth = this.sprite.width - padding;

        // Calculate a consistent base size
        // If 1 eye, it can be large. If 2, they must be smaller to fit side-by-side.
        const targetEyeWidth = eyeCount === 1
            ? availableWidth * 0.5  // One big eye
            : availableWidth * 0.4; // Two medium eyes

        // 4. Position and Render
        for (let i = 0; i < eyeCount; i++) {
            const randomTex = textureIds[Math.floor(Math.random() * textureIds.length)];
            const eye = PIXI.Sprite.from(randomTex);
            eye.anchor.set(0.5);

            // --- SCALE ---
            // Scale = (Desired Pixel Size) / (Original Texture Pixel Size)
            const scaleBase = targetEyeWidth / eye.texture.width;
            const randomVariation = 0.8 + Math.random() * 0.4; // 80% to 120% size
            eye.scale.set(scaleBase * randomVariation);

            // --- POSITIONING ---
            let posX = 0;
            if (eyeCount === 2) {
                const spacing = targetEyeWidth * 1.1; // Distance between centers
                // This centers the group: eye 0 is left, eye 1 is right
                posX = (i === 0) ? -spacing / 2 : spacing / 2;
            }

            // Add a tiny bit of "wonky" randomness
            const noiseX = (Math.random() - 0.5) * 5;
            const noiseY = (Math.random() - 0.5) * 10;

            eye.x = posX + noiseX;
            eye.y = noiseY;
            eye.rotation = (Math.random() - 0.5) * 0.4;

            this.eyesContainer.addChild(eye);
        }
    }


    protected updateHop(hop: number) {
        this.eyesContainer.pivot.y = hop * 10;
        super.updateHop(hop)
    }
    protected updateDirectionScale(side: number) {
        this.eyesContainer.scale.x = -side
        //this.eyesContainer.pivot.x = -side * 5
    }

}