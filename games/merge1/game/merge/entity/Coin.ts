import { gsap } from "gsap";
import * as PIXI from "pixi.js";

export class Coin extends PIXI.Container {
    public value: number = 0;
    public isCollected: boolean = false;

    public coinSprite!: PIXI.Sprite;

    constructor() {
        super(); // Ensure texture key is correct
        this.coinSprite = PIXI.Sprite.from('ResourceBar_Single_Icon_Coin - Copy')
        this.coinSprite.anchor.set(0.5);
        this.coinSprite.scale.set(0.5);
        this.addChild(this.coinSprite)
    }

    public init(x: number, y: number, value: number): void {
        this.position.set(x, y);
        this.value = value;
        this.isCollected = false;
        this.scale.set(0);
        this.alpha = 1;
        this.visible = true;

        gsap.to(this.scale, { x: 1, y: 1, duration: 0.4, ease: "back.out(2)" });
        gsap.to(this, { y: y - 10, duration: 1, repeat: -1, yoyo: true, ease: "sine.inOut" });
    }

    /**
     * Handles the collection animation
     */
    public collect(onComplete: () => void): void {
        gsap.killTweensOf(this);
        gsap.killTweensOf(this.scale);

        gsap.to(this, {
            y: this.y - 100,
            alpha: 0,
            duration: 0.4,
            ease: "power2.in",
            onComplete: onComplete
        });
        gsap.to(this.scale, { x: 0.5, y: 0.5, duration: 0.4 });
    }

    public reset(): void {
        gsap.killTweensOf(this);
        gsap.killTweensOf(this.scale);
        this.visible = false;
        if (this.parent) this.parent.removeChild(this);
    }
}