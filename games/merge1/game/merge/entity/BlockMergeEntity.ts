import { Game } from "@core/Game";
import ViewUtils from "@core/utils/ViewUtils";
import { gsap } from "gsap";
import * as PIXI from "pixi.js";
import { StaticData } from "../data/StaticData";
import MergeAssets from "../MergeAssets";
import { BakeDirection, TextureBaker } from "../vfx/TextureBaker";
import { BaseMergeEntity } from "./BaseMergeEntity";

export class BlockMergeEntity extends BaseMergeEntity {
    // Face Hierarchy
    protected faceContainer: PIXI.Container = new PIXI.Container();
    protected earsContainer: PIXI.Container = new PIXI.Container();
    protected eyesContainer: PIXI.Container = new PIXI.Container();
    protected mouthContainer: PIXI.Container = new PIXI.Container();

    /**
     * initView: Prepares the visual for a snapshot (Shop/UI).
     * Pivots are usually 0,0 here so the bounds are predictable for texture generation.
     */
    public initView(level: number, spriteId: string, animationId: string): void {
        this.visible = true;
        this.level = level;
        this.levelText.text = `${level}`;

        const totalLevels = StaticData.entityCount;
        const minSize = 100;
        const maxSize = 120;

        const progress = (level - 1) / (totalLevels - 1);
        let targetWidth = minSize;
        let targetHeight = minSize;
        const halfRange = (maxSize - minSize) / 2;

        if (progress <= 0.25) {
            const segmentProgress = progress / 0.25;
            targetWidth = minSize + (segmentProgress * halfRange);
            targetHeight = minSize;
        } else if (progress <= 0.50) {
            const segmentProgress = (progress - 0.25) / 0.25;
            targetWidth = minSize + halfRange;
            targetHeight = minSize + (segmentProgress * halfRange);
        } else if (progress <= 0.75) {
            const segmentProgress = (progress - 0.50) / 0.25;
            targetWidth = (minSize + halfRange) + (segmentProgress * halfRange);
            targetHeight = minSize + halfRange;
        } else {
            const segmentProgress = (progress - 0.75) / 0.25;
            targetWidth = maxSize;
            targetHeight = (minSize + halfRange) + (segmentProgress * halfRange);
        }

        const maxSpeed = 90;
        const minSpeed = 50;
        this.walkSpeed = maxSpeed - (progress * (maxSpeed - minSpeed));

        const entityData = StaticData.getAnimalData(level)// MergeAssets.CatColors[level - 1];
        const bakedTexture = TextureBaker.getStripedTintedTexture(
            level,
            MergeAssets.Textures.Extras.CatBody,//CatBodies[level % MergeAssets.Textures.Extras.CatBodies.length],
            entityData.colors,
            Game.renderer,
            BakeDirection.HORIZONTAL,
            //MergeAssets.Textures.Extras.CatLines
        );

        // Reset Containers
        if (this.sprite instanceof PIXI.Sprite) {
            this.sprite.destroy();
            this.sprite = new PIXI.NineSlicePlane(PIXI.Texture.WHITE, 40, 70, 30, 35);

            this.spriteContainer.removeChildren(); // Clear to ensure clean snapshot
            this.spriteContainer.addChild(this.earsContainer);
            this.spriteContainer.addChild(this.sprite);

            this.faceContainer.removeChildren();
            this.faceContainer.addChild(this.eyesContainer);
            this.faceContainer.addChild(this.mouthContainer);
            this.spriteContainer.addChild(this.faceContainer);

            this.spriteContainer.addChild(this.levelText);
        }

        this.sprite.width = targetWidth;
        this.sprite.height = targetHeight;
        this.sprite.texture = bakedTexture;
        this.sprite.tint = 0xFFFFFF;

        // Neutral Pivots for Snapshot
        this.sprite.scale.set(1);
        this.sprite.pivot.set(0, 0);
        this.sprite.position.set(0, 0);

        // --- Feature Setup ---
        // Ears: Positioned at top of sprite
        this.addFeature(this.earsContainer, ['ear-left', 'ear-right'], {
            count: 2,
            widthFactor: 0.8,
            yOffset: 0,
            spacing: 0.95,
            randomize: true,
            tint: PIXI.utils.string2hex(entityData.colors[0])
        });
        this.earsContainer.x = targetWidth / 2;
        this.earsContainer.y = 0;
        this.earsContainer.visible = false
        // Eyes & Mouth
        this.addFeature(this.eyesContainer, ['cat-eye', 'cat-eye'], {
            count: 2,
            widthFactor: 0.7,
            yOffset: 2,
            spacing: 1.2,
            randomize: true
        });

        this.addFeature(this.mouthContainer, ['cat-mouth-1'], {
            count: 1,
            widthFactor: 0.22 + Math.random() * 0.1,
            yOffset: targetHeight * 0.25,
            spacing: 0,
            randomize: false
        });

        this.faceContainer.x = targetWidth / 2;
        this.faceContainer.y = targetHeight * 0.35;

        // Level Text
        this.levelText.x = targetWidth / 2;
        this.levelText.y = targetHeight * 0.7;
        this.levelText.alpha = 1;

        // Highlight & Shadow (Hide shadow for shop snapshot usually)
        // if (this.highlight instanceof PIXI.Sprite) {
        //     this.highlight.destroy();
        //     this.highlight = new PIXI.NineSlicePlane(PIXI.Texture.from('BubbleFrame01_White'), 20, 20, 20, 20);
        //     this.highlight.visible = false;
        //     this.spriteContainer.addChildAt(this.highlight, 0);
        //     this.spriteContainer.addChildAt(this.shadowContainer, 0);
        // }

        // this.highlight.width = targetWidth + 10;
        // this.highlight.height = targetHeight + 10;
        // this.highlight.pivot.set(0, 0);
        // this.highlight.position.set(-5, -5);

        this.shadowContainer.visible = false;
        this.levelText.visible = false
    }

    /**
     * init: Adjusts pivots and positions for gameplay (physics/animations).
     */
    public init(level: number, spriteId: string, animationId: string): void {
        this.initView(level, spriteId, animationId);

        this.shadowContainer.visible = true
        this.earsContainer.visible = true
        this.shadow.scale.set(ViewUtils.elementScaler(this.shadow, this.sprite.width))
        this.shadow.scale.y /= 2
        // Switch to Gameplay Pivots (Bottom-Center)
        const w = this.sprite.width;
        const h = this.sprite.height;

        this.sprite.pivot.set(w / 2, h);
        this.sprite.position.set(0, 0);
        this.sprite.scale.set(1);

        this.highlight.pivot.set((w + 10) / 2, h + 5);
        this.highlight.position.set(0, 0);

        // Re-align features to the new pivot
        this.earsContainer.x = 0;
        this.earsContainer.y = -h;

        this.faceContainer.x = 0;
        this.faceContainer.y = -h * 0.65;

        this.levelText.x = 0;
        this.levelText.y = -h * 0.3;

        this.coinOffset.set(0, -h - 20);

        // Entry Animation
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
            .to(this.spriteContainer.scale, { x: 1, y: 1, duration: 0.7, ease: "elastic.out" }, 0.1);
    }

    protected updateHop(hop: number) {
        this.faceContainer.pivot.y = hop * 12;
        this.earsContainer.pivot.y = hop * 5; // Ears bounce slightly too!
        super.updateHop(hop);
    }

    protected updateDirectionScale(side: number) {
        this.faceContainer.scale.x = -side;
        this.earsContainer.scale.x = -side;
    }
}