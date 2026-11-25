// FlyCoin.ts
//
// Cash flying into the HUD's money: one icon, in an arc.

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { UiKit } from './UiKit';
import type { UiTween } from './UiAnim';

const COIN_SIZE = 52;
export const COIN_STAGGER = 0.035;
const FLIGHT_SEC = 0.45;
/** Coins rise this far above the straight line on their way (screen +Y is down, so it's negative). */
const ARC_HEIGHT = -110;

/**
 * One cash icon added to `layer` at `from` (layer space), flying along an arc into `target()` (re-aimed every frame,
 * in case the HUD moves); `onArrive` runs once it lands. (A find's pay, an achievement's.)
 */
export function flyCoin(layer: PIXI.Container, from: PIXI.Point, target: () => PIXI.Point, delay: number, onArrive: () => void): UiTween {
    const coin = PIXI.Sprite.from(UiKit.imageName('hud', 'moneyIcon'));
    coin.anchor.set(0.5);
    coin.scale.set(COIN_SIZE / Math.max(coin.texture.width, coin.texture.height, 1));
    coin.visible = false;
    layer.addChild(coin);
    const startScale = coin.scale.x;
    const progress = { t: 0 };
    return gsap.to(progress, {
        t: 1,
        duration: FLIGHT_SEC,
        delay,
        ease: 'power2.in',
        onUpdate: () => {
            const to = target();
            // Quadratic bezier through a raised midpoint.
            const midX = (from.x + to.x) / 2;
            const midY = (from.y + to.y) / 2 + ARC_HEIGHT;
            const t = progress.t;
            const u = 1 - t;
            coin.visible = true;
            coin.position.set(u * u * from.x + 2 * u * t * midX + t * t * to.x, u * u * from.y + 2 * u * t * midY + t * t * to.y);
            coin.scale.set(startScale * (1 - t * 0.35));
            coin.rotation = Math.sin(t * Math.PI * 2) * 0.3;
        },
        onComplete: () => {
            coin.destroy();
            // Run the landing just after gsap's update loop, not inside it: landing refreshes the HUD, which kills
            // the old buttons' tweens, and killing tweens mid-loop drops the other coins out of gsap's list (they
            // froze mid-air, never finishing).
            queueMicrotask(onArrive);
        },
    });
}

/** How many coins a payout of `amount` flies in as (each carrying a share). */
export function coinCount(amount: number): number {
    return Math.min(10, Math.max(5, Math.round(amount / 50)));
}
