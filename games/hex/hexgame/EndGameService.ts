import { Game } from "@core/Game";
import BaseButton from "@core/ui/BaseButton";
import { NineSliceProgressBar } from "@core/ui/NineSliceProgressBar";
import ViewUtils from "@core/utils/ViewUtils";
import gsap from "gsap";
import { MotionPathPlugin } from "gsap/MotionPathPlugin";
import * as PIXI from "pixi.js";
import HexAssets from "./HexAssets";
import { HexGridView } from "./HexGridView";
import { Choice, DIFFICULTY_MULTIPLIER } from "./HexTypes";
import { CurrencyType, EconomyStorage } from "./data/EconomyStorage";
import { LevelSessionStats } from "./data/GameplayData";
import { EndGameChest } from "./view/EndGameChest";

gsap.registerPlugin(MotionPathPlugin);

export class EndGameService {
    private particleContainer: PIXI.Container;
    private uiContainer: PIXI.Container;
    private dimmer: PIXI.Graphics;

    private progressBar!: NineSliceProgressBar;
    private chest!: EndGameChest;
    private spritePool: PIXI.Sprite[] = [];

    // Persistent UI Elements
    private homeButton!: BaseButton;
    private nextButton!: BaseButton;
    private buttonContainer!: PIXI.Container;
    private stars: PIXI.Sprite[] = [];
    private starShine!: PIXI.Sprite;

    private resolveChoice: ((value: Choice) => void) | null = null;

    constructor(
        private gameRoot: PIXI.Container,
        private gridView: HexGridView
    ) {
        // 1. Setup Stage Layers
        this.dimmer = new PIXI.Graphics();
        this.dimmer.beginFill(0x000000, 0.7);
        this.dimmer.drawRect(-Game.DESIGN_WIDTH, -Game.DESIGN_HEIGHT, Game.DESIGN_WIDTH * 3, Game.DESIGN_HEIGHT * 3);
        this.dimmer.endFill();
        this.dimmer.alpha = 0;
        this.dimmer.interactive = true;
        this.gameRoot.addChild(this.dimmer);

        this.particleContainer = new PIXI.Container();
        this.particleContainer.sortableChildren = true;
        this.gameRoot.addChild(this.particleContainer);

        this.uiContainer = new PIXI.Container();
        this.gameRoot.addChild(this.uiContainer);

        // 2. Initialize Components (Once)
        this.setupProgressElements();
        this.setupStars();
        this.setupButtons();
    }

    private setupProgressElements(): void {
        this.progressBar = new NineSliceProgressBar({
            width: 400,
            height: 40,
            bgTexture: PIXI.Texture.from(HexAssets.Textures.UI.BarBg),
            barTexture: PIXI.Texture.from(HexAssets.Textures.UI.BarFill),
            leftWidth: 10, topHeight: 10, rightWidth: 10, bottomHeight: 10,
            barColor: 0x07b4fc,
            padding: 4
        });
        this.progressBar.position.set(Game.DESIGN_WIDTH / 2, Game.DESIGN_HEIGHT / 2 + 180);
        this.progressBar.visible = false;
        this.uiContainer.addChild(this.progressBar);

        this.chest = new EndGameChest();
        this.chest.position.set(Game.DESIGN_WIDTH / 2, Game.DESIGN_HEIGHT / 2 - 20);
        this.chest.pivot.y = -50;
        this.chest.visible = false;
        this.uiContainer.addChild(this.chest);
    }

    private setupStars(): void {
        const starSpacing = 150;
        const targetScale = 1.2;
        const startX = (Game.DESIGN_WIDTH / 2) - starSpacing;
        const centerY = Game.DESIGN_HEIGHT / 2;

        this.starShine = new PIXI.Sprite(PIXI.Texture.from("Image_Effect_Rotate"));
        this.starShine.anchor.set(0.5);
        this.starShine.visible = false;
        this.uiContainer.addChild(this.starShine);

        for (let i = 0; i < 3; i++) {
            const star = new PIXI.Sprite(PIXI.Texture.from("Star-empty"));
            star.anchor.set(0.5);
            star.scale.set(targetScale);
            star.position.set(startX + (i * starSpacing), centerY);
            star.visible = false;
            this.uiContainer.addChild(star);
            this.stars.push(star);
        }
        this.starShine.position.copyFrom(this.stars[2].position);
    }

    private setupButtons(): void {
        this.buttonContainer = new PIXI.Container();
        this.buttonContainer.visible = false;
        this.uiContainer.addChild(this.buttonContainer);

        this.homeButton = new BaseButton({
            standard: {
                width: 90, height: 90,
                texture: PIXI.Texture.from(HexAssets.Textures.Buttons.Blue),
                iconTexture: PIXI.Texture.from(HexAssets.Textures.Icons.Back),
                iconSize: { width: 60, height: 60 },
                centerIconHorizontally: true, centerIconVertically: true,
            },
            click: { callback: () => this.resolveChoice?.("home") }
        });
        this.homeButton.pivot.set(45, 45);
        this.homeButton.x = -85;

        this.nextButton = new BaseButton({
            standard: {
                width: 110, height: 110,
                texture: PIXI.Texture.from(HexAssets.Textures.Buttons.Gold),
                iconTexture: PIXI.Texture.from(HexAssets.Textures.Icons.ArrowRight),
                iconSize: { width: 70, height: 70 },
                centerIconHorizontally: true, centerIconVertically: true,
            },
            click: { callback: () => this.resolveChoice?.("next") }
        });
        this.nextButton.pivot.set(55, 55);
        this.nextButton.x = 85;

        this.buttonContainer.addChild(this.homeButton, this.nextButton);
        this.buttonContainer.position.set(Game.DESIGN_WIDTH / 2, Game.DESIGN_HEIGHT / 2 + 180);
    }

    public update(dt: number): void {
        if (this.chest?.visible) this.chest.update(dt);
    }

    public async execute(totalTime: number = 2.0, levelStats: LevelSessionStats): Promise<Choice> {
        this.prepareSequence();

        // Start Sequence
        gsap.to(this.dimmer, { alpha: 1, duration: 0.4 });
        gsap.from(this.chest, { y: "+=100", alpha: 0, duration: 0.6, ease: "back.out" });

        await this.animatePiecesRoutine(totalTime);

        // Chest Reward Logic
        const multiplier = DIFFICULTY_MULTIPLIER[levelStats.difficulty] || 1;
        const totalReward = levelStats.stars * 10 * multiplier;
        EconomyStorage.addCurrency(CurrencyType.COINS, totalReward);
        await new Promise<void>(res => this.chest.open('+' + totalReward, res));

        await new Promise(r => setTimeout(r, 500));
        await gsap.to([this.chest, this.progressBar], { alpha: 0, duration: 0.3 });

        this.chest.visible = false;
        this.progressBar.visible = false;

        // Show Stars
        await this.showStarsRoutine(levelStats.stars);

        // Wait for User Choice
        const choice = await this.waitForUserChoice();

        // Final Outro
        await gsap.to([this.dimmer, this.uiContainer], { alpha: 0, duration: 0.4 });
        this.buttonContainer.visible = false;

        return choice;
    }

    private prepareSequence(): void {
        this.uiContainer.alpha = 1;
        this.uiContainer.visible = true;
        this.buttonContainer.visible = false;
        this.starShine.visible = false;
        this.stars.forEach(s => { s.visible = false; s.alpha = 0; });

        this.chest.reset();
        this.chest.visible = true;
        this.progressBar.update(0);
        this.progressBar.visible = true;
        this.progressBar.alpha = 1;
    }

    private async animatePiecesRoutine(totalTime: number): Promise<void> {
        const tiles = this.gridView.getAllTiles();
        if (tiles.length === 0) return;

        const targetGlobal = this.chest.getGlobalPosition();
        const targetLocal = this.particleContainer.toLocal(targetGlobal);
        let collected = 0;

        const animationPromises = tiles.map((tile, index) => {
            const sprite = this.getSprite();
            sprite.texture = tile.sprite.texture;
            sprite.anchor.copyFrom(tile.sprite.anchor);
            const localPos = this.particleContainer.toLocal(tile.getGlobalPosition());
            sprite.position.set(localPos.x, localPos.y);
            sprite.scale.set(ViewUtils.elementScaler(sprite, tile.sprite.width) * this.gridView.scale.x);

            this.particleContainer.addChild(sprite);
            tile.visible = false;

            return new Promise<void>((resolve) => {
                gsap.timeline({
                    delay: (index / tiles.length) * (totalTime * 0.5),
                    onComplete: () => {
                        collected++;
                        this.progressBar.update(collected / tiles.length);
                        gsap.fromTo(this.chest.scale, { x: 1.05, y: 0.95 }, { x: 1, y: 1, duration: 0.1 });
                        this.returnSprite(sprite);
                        resolve();
                    }
                }).to(sprite, {
                    duration: totalTime * 0.6,
                    motionPath: {
                        path: [
                            { x: localPos.x, y: localPos.y },
                            { x: (localPos.x + targetLocal.x) / 2, y: Math.min(localPos.y, targetLocal.y) - 250 },
                            { x: targetLocal.x, y: targetLocal.y }
                        ]
                    },
                    ease: "power2.in"
                }).to(sprite.scale, { x: 0.4, y: 0.4, duration: totalTime * 0.6 }, "<");
            });
        });
        await Promise.all(animationPromises);
    }

    private async showStarsRoutine(starCount: number): Promise<void> {
        const targetScale = 1.2;
        const popMultiplier = 1.5;
        const centerY = Game.DESIGN_HEIGHT / 2;
        const textures = ["ItemIcon_Star_Bronze", "ItemIcon_Star_Silver", "ItemIcon_Star_Gold"];

        for (let i = 0; i < 3; i++) {
            const star = this.stars[i];
            star.texture = PIXI.Texture.from("Star-empty");
            star.alpha = 0;
            star.visible = true;
            star.y = centerY + 40;
            star.scale.set(targetScale);

            gsap.to(star, { alpha: 1, y: centerY, duration: 0.5, delay: i * 0.1, ease: "back.out(1.5)" });
        }

        await new Promise(r => setTimeout(r, 400));

        for (let i = 0; i < starCount; i++) {
            const star = this.stars[i];
            if (i === 2) {
                this.starShine.visible = true;
                this.starShine.alpha = 0;
                this.starShine.scale.set(0);
                gsap.to(this.starShine, { alpha: 0.6, scale: targetScale * 1.8, duration: 0.5 });
                gsap.to(this.starShine, { rotation: Math.PI * 2, duration: 10, repeat: -1, ease: "none" });
            }
            await gsap.to(star.scale, { x: targetScale * popMultiplier, y: targetScale * popMultiplier, duration: 0.15, ease: "power2.out" });
            star.texture = PIXI.Texture.from(textures[i]);
            await gsap.to(star.scale, { x: targetScale, y: targetScale, duration: 0.4, ease: "back.out(2)" });
        }
    }

    private async waitForUserChoice(): Promise<Choice> {
        return new Promise((resolve) => {
            this.resolveChoice = resolve;
            this.buttonContainer.visible = true;
            this.buttonContainer.alpha = 1;

            gsap.killTweensOf([this.homeButton.scale, this.nextButton.scale]);
            this.homeButton.scale.set(0);
            this.nextButton.scale.set(0);

            const tl = gsap.timeline();
            tl.to([this.homeButton.scale, this.nextButton.scale], {
                x: 1, y: 1, duration: 0.5, stagger: 0.1, ease: "back.out(1.7)",
                onComplete: () => {
                    // Start Pulse (0.95 to 1.05)
                    gsap.fromTo(this.nextButton.scale,
                        { x: 0.95, y: 0.95 },
                        { x: 1.05, y: 1.05, duration: 0.8, repeat: -1, yoyo: true, ease: "sine.inOut" }
                    );
                }
            });
        });
    }

    private getSprite(): PIXI.Sprite {
        const sprite = this.spritePool.pop() || new PIXI.Sprite();
        sprite.visible = true;
        sprite.alpha = 1;
        sprite.rotation = 0;
        return sprite;
    }

    private returnSprite(sprite: PIXI.Sprite): void {
        sprite.visible = false;
        sprite.removeFromParent();
        this.spritePool.push(sprite);
    }
}