// entity/RewardContainerEntity.ts
import { gsap } from "gsap";
import * as PIXI from "pixi.js";
import MergeAssets from "../MergeAssets";
import { BaseMergeEntity, EntityState } from "./BaseMergeEntity";
import { ConfettiBurst } from "./ConfettiBurst";

export class RewardContainerEntity extends BaseMergeEntity {
    private shine: PIXI.Sprite;
    private isOpening: boolean = false;
    private frontChest: PIXI.Sprite = PIXI.Sprite.from(PIXI.Texture.WHITE)
    private backChest: PIXI.Sprite = PIXI.Sprite.from(PIXI.Texture.WHITE)
    private lidOpen: PIXI.Sprite = PIXI.Sprite.from(PIXI.Texture.WHITE)
    private lidClose: PIXI.Sprite = PIXI.Sprite.from(PIXI.Texture.WHITE)

    private confetti: ConfettiBurst;

    constructor() {
        super();

        // 1. Setup Rotating Shine (placed behind the sprite)
        this.shine = PIXI.Sprite.from(MergeAssets.Textures.UI.Shine); // Ensure you have a shine texture
        this.shine.anchor.set(0.5);
        this.shine.alpha = 0.5;
        this.shine.blendMode = PIXI.BLEND_MODES.ADD;
        this.shine.scale.set(0.8);

        // Add shine to the view, but below the spriteContainer
        this.view.addChildAt(this.shine, 0);

        this.confetti = new ConfettiBurst(PIXI.Texture.WHITE, 40);

        this.spriteContainer.addChild(this.backChest)
        this.backChest.addChild(this.confetti)
        this.backChest.addChild(this.frontChest)
        this.backChest.addChild(this.lidOpen)
        this.backChest.addChild(this.lidClose)

        // Hide level text for containers
        this.levelText.visible = false;

        // Chests usually don't "breath" like animals
        this.breathIntensity = 0;
    }

    public initContainer(spriteId: string): void {
        // Call base init with dummy values for level/anim
        super.init(1, PIXI.Texture.EMPTY, "");
        this.isOpening = false;
        this.shine.visible = true;

        this.frontChest.texture = PIXI.Texture.from('chest-front')
        this.backChest.texture = PIXI.Texture.from('chest-inner')
        this.lidOpen.texture = PIXI.Texture.from('chest-lid-open')
        this.lidClose.texture = PIXI.Texture.from('chest-lid')

        this.backChest.anchor.set(0.5)
        this.frontChest.anchor.set(0.5, 0.1)
        this.lidOpen.anchor.set(0.5, 1)
        this.lidOpen.alpha = 0;
        this.lidClose.anchor.set(0.5, 0.8)
        //this.lidClose.y = -15

        this.backChest.y = -this.frontChest.height * 0.9

        if (this.highlight.parent) {
            this.highlight.parent.removeChild(this.highlight)
        }

    }

    public open(onComplete: () => void): void {
        if (this.isOpening) return;
        this.isOpening = true;
        this.shine.visible = false;
        this.state = EntityState.GRABBED;

        MergeAssets.tryToPlaySound(MergeAssets.Sounds.Game.Yay);

        const tl = gsap.timeline({ onComplete });

        // 1. Jiggle and Shrink (Anticipation)
        tl.to(this.spriteContainer, { x: -3, duration: 0.05, repeat: 4, yoyo: true })
            .to(this.spriteContainer.scale, { x: 1.1, y: 0.8, duration: 0.1 })

            // 2. Explode
            .add(() => {
                this.confetti.burst();
                MergeAssets.tryToPlaySound(MergeAssets.Sounds.Game.Drop);
            })
            .to(this.lidOpen, {
                onStart: () => {
                    this.lidClose.visible = false
                    this.lidOpen.visible = true
                    this.lidOpen.alpha = 1
                },
                y: -150,
                x: 40,
                rotation: 1.2,

                duration: 0.5,
                ease: "power2.out"
            }, "-=0.05")

            // 3. Disappear
            .to(this.spriteContainer, {
                y: -20,
                alpha: 0,
                duration: 0.4,
                ease: "power2.in"
            }, "+=0.5"); // Short delay so player sees the open chest
    }

    public update(delta: number, bounds: PIXI.Rectangle): void {
        super.update(delta, bounds);

        if (this.shine.visible) {
            this.shine.rotation += delta * 0.75; // Rotate shine
            this.shine.y = this.backChest.y - (this.sprite.height / 2);
        }

        this.confetti.update(delta * 50)
    }

    public reset(): void {
        super.reset();
        this.isOpening = false;
        this.spriteContainer.alpha = 1;
        this.shine.visible = true;
        this.confetti.visible = false;
    }
}