import { ConfettiBurst } from "@core/vfx/ConfettiBurst";
import { gsap } from "gsap";
import * as PIXI from "pixi.js";
import HexAssets from "../HexAssets";

export class EndGameChest extends PIXI.Container {
    private shine: PIXI.Sprite;
    private frontChest: PIXI.Sprite;
    private backChest: PIXI.Sprite;
    private lidOpen: PIXI.Sprite;
    private lidClose: PIXI.Sprite;
    private confetti: ConfettiBurst;
    private rewardLabel: PIXI.Text;

    public isOpening: boolean = false;

    constructor() {
        super();

        this.shine = PIXI.Sprite.from('Image_Effect_Rotate');
        this.shine.anchor.set(0.5);
        this.shine.alpha = 0.5;
        this.shine.blendMode = PIXI.BLEND_MODES.ADD;
        this.addChild(this.shine);

        this.backChest = PIXI.Sprite.from('chest-inner');
        this.frontChest = PIXI.Sprite.from('chest-front');
        this.lidOpen = PIXI.Sprite.from('chest-lid-open');
        this.lidClose = PIXI.Sprite.from('chest-lid');

        this.backChest.anchor.set(0.5);
        this.frontChest.anchor.set(0.5, 0.1);
        this.lidOpen.anchor.set(0.5, 1);
        this.lidClose.anchor.set(0.5, 0.8);

        this.rewardLabel = new PIXI.Text("", { ...HexAssets.MainFontTitle });
        this.rewardLabel.anchor.set(0.5);

        this.confetti = new ConfettiBurst(PIXI.Texture.WHITE, 40);

        this.addChild(this.backChest);
        this.backChest.addChild(this.confetti);
        this.backChest.addChild(this.frontChest);
        this.backChest.addChild(this.lidOpen);
        this.backChest.addChild(this.lidClose);
        this.addChild(this.rewardLabel);

        this.reset();
    }

    public open(rewardValue: string, onComplete: () => void): void {
        if (this.isOpening) return;
        this.isOpening = true;

        // Kill any surviving reset animations
        gsap.killTweensOf([this.backChest, this.backChest.scale, this.lidOpen, this.rewardLabel]);

        this.shine.visible = false;

        const tl = gsap.timeline();

        // 1. Jiggle
        tl.to(this.backChest, { x: -3, duration: 0.05, repeat: 4, yoyo: true })
            .to(this.backChest.scale, { x: 1.1, y: 0.8, duration: 0.1 })
            .add(() => {
                this.confetti.burst();
                this.lidClose.visible = false;
                this.lidOpen.visible = true;
                this.lidOpen.alpha = 1; // Ensure alpha is up
                this.showReward(rewardValue);
            })
            // 2. Flip lid
            .to(this.lidOpen, { y: -2, x: 8, rotation: 0, duration: 0.1 })
            // 3. Elastic settle
            .to(this.backChest.scale, {
                x: 1, y: 1,
                duration: 0.55,
                ease: "elastic.out",
                onComplete
            });
    }

    private showReward(value: string): void {
        gsap.killTweensOf(this.rewardLabel);

        this.rewardLabel.text = value;
        this.rewardLabel.y = -20;
        this.rewardLabel.alpha = 0;
        this.rewardLabel.visible = true;

        gsap.to(this.rewardLabel, {
            y: -150,
            alpha: 1,
            duration: 1.2,
            ease: "back.out(2)"
        });
    }

    public update(dt: number): void {
        if (this.shine.visible) {
            this.shine.rotation += dt * 0.75;
        }
        this.confetti.update(dt * 60);
    }

    /**
     * STRENGTHENED RESET
     * This must clear every property modified by the 'open' timeline
     */
    // Inside EndGameChest class
    public reset(): void {
        // 1. Kill all potential active tweens
        gsap.killTweensOf([this, this.backChest, this.backChest.scale, this.lidOpen, this.lidClose, this.rewardLabel, this.shine]);

        this.isOpening = false;
        this.alpha = 1;
        this.visible = true;

        // 2. Force Lid States
        this.lidClose.visible = true;
        this.lidClose.alpha = 1;
        this.lidOpen.visible = false;
        this.lidOpen.alpha = 0;
        this.lidOpen.rotation = 0;
        this.lidOpen.position.set(0, 0);

        // 3. Force Body States
        this.backChest.alpha = 1;
        this.backChest.position.set(0, 0);
        this.backChest.scale.set(1);
        this.frontChest.alpha = 1;

        // 4. Force UI States
        this.rewardLabel.visible = false;
        this.rewardLabel.alpha = 0;
        this.rewardLabel.scale.set(1);
        this.shine.visible = true;
        this.shine.alpha = 0.5;
        this.shine.scale.set(1);
    }
}