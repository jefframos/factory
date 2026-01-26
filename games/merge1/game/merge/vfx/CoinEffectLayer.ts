import Pool from "@core/Pool";
import { Back, gsap } from "gsap";
import * as PIXI from "pixi.js";
import MergeAssets from "../MergeAssets";

export class CoinEffectLayer extends PIXI.Container {

    constructor() {
        super();
    }

    /**
     * BEHAVIOR 1: Pop, fly to UI, and trigger callback
     */
    public popAndFlyToTarget(
        startX: number,
        startY: number,
        targetX: number,
        targetY: number,
        source: string | PIXI.Sprite,
        value: number,
        onComplete: () => void
    ): void {
        const coin = this.setupSprite(source);
        coin.position.set(startX, startY);

        const targetScaleX = coin.scale.x;
        const targetScaleY = coin.scale.y;

        coin.scale.set(0);
        coin.alpha = 1;

        this.popValueLabel(startX, startY, value);

        // --- RANDOMIZED BEZIER MATH ---
        // 1. Randomly choose left (-1) or right (1) arch
        const randomSide = Math.random() > 0.5 ? 1 : -1;

        // 2. Randomize how far it "kicks" out horizontally (between 80 and 200)
        const sideIntensity = 80 + Math.random() * 120;

        // 3. Randomize the height of the arch (between 100 and 250)
        const verticalIntensity = 100 + Math.random() * 150;

        const controlPointX = startX + (sideIntensity * randomSide);
        const controlPointY = startY - verticalIntensity;

        const tl = gsap.timeline();

        // 1. Initial Pop (Bigger and faster)
        tl.to(coin.scale, {
            x: targetScaleX * 1.25,
            y: targetScaleY * 1.25,
            duration: 0.15,
            ease: "back.out(3)"
        });

        // 2. Bezier Flight
        tl.to(coin, {
            duration: 0.8 + Math.random() * 0.2, // Add slight variation to speed
            ease: "power2.inOut",
            onUpdate: function () {
                const t = this.progress();
                const invT = 1 - t;

                // Quadratic Bezier Formula: B(t) = (1-t)²P0 + 2(1-t)tP1 + t²P2
                coin.x = invT * invT * startX + 2 * invT * t * controlPointX + t * t * targetX;
                coin.y = invT * invT * startY + 2 * invT * t * controlPointY + t * t * targetY;
            }
        }, "-=0.05");

        // 3. Shrink and fade as it hits the target
        tl.to(coin.scale, {
            x: targetScaleX * 0.5,
            y: targetScaleY * 0.5,
            duration: 0.3,
            ease: "power1.in"
        }, "-=0.3");

        tl.to(coin, {
            alpha: 0,
            duration: 0.2
        }, "-=0.2");

        tl.call(() => {
            onComplete();
            this.recycleSprite(coin);
        });
    }

    /**
     * BEHAVIOR 2: Just pop and fade away
     */
    public popAndFade(x: number, y: number, value: number, source: string | PIXI.Sprite): void {
        const coin = this.setupSprite(source);
        const targetScaleX = coin.scale.x;
        const targetScaleY = coin.scale.y;

        coin.position.set(x, y);
        coin.scale.set(0);
        coin.alpha = 1;

        this.popValueLabel(x, y, value);

        gsap.to(coin.scale, { x: targetScaleX, y: targetScaleY, duration: 0.3, ease: "back.out" });
        gsap.to(coin, {
            y: y - 60,
            alpha: 0,
            duration: 0.8,
            ease: "power1.out",
            onComplete: () => this.recycleSprite(coin)
        });
    }

    private popValueLabel(x: number, y: number, value: number): void {
        const label = new PIXI.BitmapText(`+${value}`, {
            fontName: MergeAssets.MainFont.fontFamily,
            fontSize: 24
        });
        label.anchor.set(0.5);
        label.position.set(x, y - 20);
        label.alpha = 1;
        this.addChild(label);

        gsap.to(label, { delay: 0.75, duration: 0.25, alpha: 0 })
        gsap.to(label, {
            y: label.y - 60,
            duration: 1.5,
            ease: Back.easeOut,
            onComplete: () => {
                this.removeChild(label);
                label.destroy();
            }
        });
    }

    /**
     * Configures the pooled sprite based on a string ID or an existing Sprite
     */
    private setupSprite(source: string | PIXI.Sprite): PIXI.Sprite {
        const sp = Pool.instance.getElement(PIXI.Sprite);

        if (typeof source === "string") {
            sp.texture = PIXI.Texture.from(source);
            sp.anchor.set(0.5);
            sp.scale.set(1);
        } else {
            // Copy properties from existing sprite
            sp.texture = source.texture;
            sp.anchor.copyFrom(source.anchor);
            sp.scale.copyFrom(source.scale);
        }

        this.addChild(sp);
        return sp;
    }

    private recycleSprite(sp: PIXI.Sprite): void {
        this.removeChild(sp);
        // Important: Reset properties so the next use doesn't carry old data
        sp.alpha = 1;
        sp.scale.set(1);
        Pool.instance.returnElement(sp);
    }
}