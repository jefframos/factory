import { NineSliceProgressBar } from "@core/ui/NineSliceProgressBar";
import { gsap } from "gsap";
import * as PIXI from "pixi.js";
import MergeAssets from "../MergeAssets";

export class ProgressHUD extends PIXI.Container {
    private progressBar: NineSliceProgressBar;
    private levelText: PIXI.Text;
    private xpText: PIXI.Text;
    private badgeContainer: PIXI.Container;
    private badgeBg: PIXI.Sprite;

    private readonly BAR_WIDTH: number = 280;
    private readonly BAR_HEIGHT: number = 40;

    constructor() {
        super();
        this.pivot.x = this.BAR_WIDTH / 2
        // 1. Progress Bar Setup
        this.progressBar = new NineSliceProgressBar({
            width: this.BAR_WIDTH,
            height: this.BAR_HEIGHT,
            bgTexture: PIXI.Texture.from(MergeAssets.Textures.UI.BarBg),
            barTexture: PIXI.Texture.from(MergeAssets.Textures.UI.BarFill),
            leftWidth: 8,
            topHeight: 8,
            rightWidth: 8,
            bottomHeight: 8,
            barColor: MergeAssets.Textures.UI.FillColor,
            padding: 4
        });
        this.progressBar.position.set(this.BAR_WIDTH / 2, 0);
        this.addChild(this.progressBar);

        // 2. Level Badge Setup
        this.badgeContainer = new PIXI.Container();

        // Use a circular or shield-like badge texture from your assets
        this.badgeBg = PIXI.Sprite.from(MergeAssets.Textures.UI.LevelBadge); // Replace with a badge/circle asset
        this.badgeBg.anchor.set(0.5);
        this.badgeBg.scale.set(0.45); // Adjust based on your asset size

        this.levelText = new PIXI.Text(`1`, {
            ...MergeAssets.MainFont,
            fontSize: 32,
            strokeThickness: 4 // Thicker stroke for badge numbers
        });
        this.levelText.anchor.set(0.5);

        this.badgeContainer.addChild(this.badgeBg, this.levelText);

        // Position the badge at the start of the bar
        this.badgeContainer.position.set(0, 0);
        this.addChild(this.badgeContainer);

        // 3. XP Text (Center of Bar)
        this.xpText = new PIXI.Text(`0 / 0`, {
            ...MergeAssets.MainFont,
            fontSize: 22
        });
        this.xpText.anchor.set(0.5);
        this.xpText.position.set(this.BAR_WIDTH / 2, 0);
        this.addChild(this.xpText);
    }

    public updateValues(level: number, current: number, required: number): void {
        const ratio = Math.min(current / required, 1);
        this.progressBar.update(ratio);

        this.levelText.text = `${level}`;
        this.xpText.text = `${Math.floor(current)} / ${Math.floor(required)}`;
    }

    public playLevelUpEffect(newLevel: number): void {
        this.levelText.text = `${newLevel}`;

        // Animate the entire badge
        gsap.fromTo(this.badgeContainer.scale,
            { x: 0, y: 0 },
            { x: 1, y: 1, duration: 0.6, ease: "back.out(1.7)" }
        );

        // Flash the badge background
        gsap.to(this.badgeBg, {
            tint: 0xFFFFFF,
            duration: 0.1,
            repeat: 3,
            yoyo: true,
            onComplete: () => { this.badgeBg.tint = 0xFFFFFF }
        });
    }
}