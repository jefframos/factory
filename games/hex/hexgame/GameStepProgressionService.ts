import { Game } from "@core/Game";
import { NineSliceProgressBar } from "@core/ui/NineSliceProgressBar";
import { ColorGradient } from "@core/vfx/ColorGradient";
import gsap from "gsap";
import * as PIXI from "pixi.js";
import HexAssets from "./HexAssets";

export class GameStepProgressionService {
    public bar!: NineSliceProgressBar;
    private container: PIXI.Container;
    private spritePool: PIXI.Sprite[] = [];
    private _currentProgress: number = 0;

    constructor(private parent: PIXI.Container) {
        this.container = new PIXI.Container();
        this.parent.addChild(this.container);
        this.setupBar();
    }

    private setupBar(): void {
        const progressionGradient = new ColorGradient([0x3357FF, 0xFF69B4, 0xFF2D55]);

        this.bar = new NineSliceProgressBar({
            width: 400, // Match EndGame width
            height: 40, // Slightly slimmer for gameplay
            bgTexture: PIXI.Texture.from(HexAssets.Textures.UI.BarBg),
            barTexture: PIXI.Texture.from(HexAssets.Textures.UI.BarFill),
            leftWidth: 10, topHeight: 10, rightWidth: 10, bottomHeight: 10,
            gradient: progressionGradient,
            padding: 4
        });
        // Position top center
        this.bar.position.set(Game.DESIGN_WIDTH / 2, 50);
        this.container.addChild(this.bar);
        this.bar.visible = false;
    }
    public reset(): void {
        gsap.killTweensOf(this.container);
        this.container.alpha = 1;
        this.spritePool.forEach(s => s.removeFromParent());
    }
    public initLevel(totalSteps: number): void {
        const shouldBeVisible = totalSteps > 1;

        if (shouldBeVisible) {
            this.bar.visible = true;
            // If the container was faded out from a previous quit, fade it back in
            if (this.container.alpha < 1) {
                gsap.to(this.container, { alpha: 1, duration: 0.3 });
            }
        } else {
            this.bar.visible = false;
        }

        this._currentProgress = 0;
        // Reset bar value to 0 for the new level
        this.bar.update(0);
    }

    public async animateStepCompletion(tiles: any[], currentStep: number, totalSteps: number): Promise<void> {
        const targetGlobal = this.bar.getGlobalPosition();
        const targetLocal = this.container.toLocal(targetGlobal);

        // 1. FLY ANIMATION (Existing logic)
        const animations = tiles.map((tile, i) => {
            const sprite = this.getSprite();
            sprite.texture = tile.sprite.texture;
            sprite.anchor.copyFrom(tile.sprite.anchor);
            const startPos = this.container.toLocal(tile.getGlobalPosition());
            sprite.position.set(startPos.x, startPos.y);
            sprite.scale.set(tile.sprite.scale.x);
            this.container.addChild(sprite);
            tile.visible = false;

            return new Promise<void>(resolve => {
                gsap.to(sprite, {
                    x: targetLocal.x,
                    y: targetLocal.y,
                    duration: 0.6,
                    delay: (i / tiles.length) * 0.3,
                    ease: "back.in(1.2)",
                    onStart: () => {
                        if (Math.random() < 0.2) {
                            HexAssets.tryToPlaySound(HexAssets.Sounds.UI.FlyAnim);
                        }
                    },
                    onComplete: () => {
                        this.returnSprite(sprite);
                        HexAssets.tryToPlaySound(HexAssets.Sounds.Game.Coin);
                        gsap.fromTo(this.bar.scale, { x: 1.02, y: 1.02 }, { x: 1, y: 1, duration: 0.1 });
                        resolve();
                    }
                });
                gsap.to(sprite.scale, { x: 0.2, y: 0.2, duration: 0.6 }, "<");
            });
        });

        await Promise.all(animations);

        // 2. SMOOTH BAR FILL
        const targetProgress = (currentStep + 1) / totalSteps;

        // Proxy object using our internal tracker as the starting point
        const progressObj = { value: this._currentProgress };

        await gsap.to(progressObj, {
            value: targetProgress,
            duration: 0.5,
            ease: "power2.out",
            onUpdate: () => {
                // Update the visual bar
                this.bar.update(progressObj.value);
                // Update our internal tracker so the next step knows where to start
                this._currentProgress = progressObj.value;
            }
        });
    }

    private getSprite(): PIXI.Sprite {
        return this.spritePool.pop() || new PIXI.Sprite();
    }

    private returnSprite(s: PIXI.Sprite): void {
        s.removeFromParent();
        this.spritePool.push(s);
    }

    public hide(): void {
        gsap.to(this.container, { alpha: 0, duration: 0.3, onComplete: () => { this.bar.visible = false } });
    }
}