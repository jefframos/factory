// MoveHint.ts
//
// "How to move", after clog's DragPathHint: a faint dashed figure-eight (Bernoulli lemniscate) with the handHud
// pointing hand gliding along it, fingertip on the curve — drag anywhere to walk. Shown on a brand-new game until the
// miner has walked a few steps (DigScene), then it fades away.

import * as PIXI from 'pixi.js';
import gsap from 'gsap';

const LOOP_SEC = 3;
const PATH_WIDTH = 100;
const PATH_HEIGHT = 80;
const HAND_SIZE = 64;
/** handHud's fingertip, as a fraction of the icon's width/height (same art and values as clog). */
const FINGERTIP = { x: 0.22, y: 0.16 };

export class MoveHint extends PIXI.Container {
    private readonly hand = PIXI.Sprite.from('handHud');
    /** The hand's lap, on gsap's clock (so it freezes with a platform pause, like every other UI tween). */
    private loop?: gsap.core.Tween;

    public constructor() {
        super();
        this.eventMode = 'none';
        const track = new PIXI.Graphics();
        // Dashed: every other short segment of the curve.
        const steps = 96;
        for (let i = 0; i < steps; i += 2) {
            const a = this.curve(this.at(i, steps));
            const b = this.curve(this.at(i + 1, steps));
            track.lineStyle(3, 0xffffff, 0.45).moveTo(a.x, a.y).lineTo(b.x, b.y);
        }
        this.hand.width = this.hand.height = HAND_SIZE;
        this.addChild(track, this.hand);
        this.visible = false;
    }

    private at(i: number, steps: number): number {
        return (i / steps) * Math.PI * 2;
    }

    /** Bernoulli lemniscate, t = 0 at the centre moving right. */
    private curve(t: number): { x: number; y: number } {
        const denom = 1 + Math.sin(t) * Math.sin(t);
        return { x: (PATH_WIDTH * Math.cos(t)) / denom, y: (PATH_HEIGHT * Math.sin(t) * Math.cos(t)) / denom };
    }

    private place(t: number): void {
        const { x, y } = this.curve(t);
        this.hand.position.set(x - HAND_SIZE * FINGERTIP.x, y - HAND_SIZE * FINGERTIP.y);
    }

    public show(): void {
        if (this.visible) return;
        this.visible = true;
        this.alpha = 1;
        const lap = { t: 0 };
        this.loop = gsap.to(lap, { t: Math.PI * 2, duration: LOOP_SEC, ease: 'none', repeat: -1, onUpdate: () => this.place(lap.t) });
    }

    /** Fades out, then stops. */
    public hide(): void {
        if (!this.visible) return;
        gsap.to(this, {
            alpha: 0,
            duration: 0.4,
            onComplete: () => {
                this.visible = false;
                this.loop?.kill();
            },
        });
    }

    public override destroy(): void {
        this.loop?.kill();
        gsap.killTweensOf(this);
        super.destroy({ children: true });
    }
}
