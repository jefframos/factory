import { gsap } from 'gsap';
import * as PIXI from 'pixi.js';
import Assets from '../Assets';

export class CoinEffect extends PIXI.Container {
    private pool: PIXI.Sprite[] = [];
    private texture: PIXI.Texture;

    constructor() {
        super();
        this.texture = PIXI.Texture.from(Assets.Textures.Icons.Coin);
    }

    public flyCoinFromTo(from: PIXI.IPointData, to: PIXI.IPointData, duration: number, onComplete?: () => void): void {
        const coin = this.getLeftoverCoin();

        // Reset properties for the reused sprite
        coin.position.copyFrom(from);
        coin.alpha = 1;
        coin.visible = true;
        coin.scale.set(0); // Start small for a "pop" effect

        // Randomize a control point for the Bezier curve (creates the arc)
        // We offset the midpoint horizontally and push it "up" (negative Y)
        const midX = (from.x + to.x) / 2 + (Math.random() - 0.5) * 400;
        const midY = Math.min(from.y, to.y) - (Math.random() * 150 + 50);

        gsap.to(coin, {
            duration: duration,
            ease: "power1.out",
            onUpdate: function () {
                const t = this.progress(); // 0 to 1
                const invT = 1 - t;

                // Quadratic Bezier Formula: (1-t)^2*P0 + 2(1-t)t*P1 + t^2*P2
                coin.x = invT * invT * from.x + 2 * invT * t * midX + t * t * to.x;
                coin.y = invT * invT * from.y + 2 * invT * t * midY + t * t * to.y;

                // Visual Polish:
                // 1. Pop scale in quickly at the start
                if (t < 0.2) {
                    coin.scale.set(t * 5 * 0.5);
                } else {
                    coin.scale.set(0.5);
                }

                // 2. Rotate while flying
                coin.rotation += 0.1;

                // 3. Fade out right before hitting the target
                if (t > 0.9) {
                    coin.alpha = (1 - t) * 10;
                }
            },
            onComplete: () => {
                coin.visible = false;
                this.pool.push(coin); // Return to pool
                if (onComplete) onComplete();
            }
        });
    }

    private getLeftoverCoin(): PIXI.Sprite {
        if (this.pool.length > 0) {
            return this.pool.pop()!;
        }
        const coin = new PIXI.Sprite(this.texture);
        coin.anchor.set(0.5);
        coin.scale.set(0.5); // Adjust scale as needed
        this.addChild(coin);
        return coin;
    }
}