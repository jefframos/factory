// MoveHint.ts
//
// "How to fly", as in the mow game: a hand gliding round a figure of eight, its fingertip on the curve, until the player sets
// off, then it fades away.

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { iconSprite } from './UiParts';

/** The picture's width on screen, and how see-through it is. */
const WIDTH = 250;
const ALPHA = 0.8;
const HAND_SIZE = 92;
const LOOP_SECONDS = 2.6;
const FADE_SECONDS = 0.4;
/** The hand's fingertip, as a share of its picture. */
const FINGERTIP = { x: 0.22, y: 0.2 };
/** The middle of the picture's band, as shares of its width and height: where the fingertip follows it. */
const PATH = { x: 0.437, y: 1.08 };

export class MoveHint extends PIXI.Container {
    private readonly track = iconSprite('Infinity', WIDTH);
    private readonly hand = iconSprite('tutorial_hand_3', HAND_SIZE);
    private readonly lap = { t: 0 };
    private loop: gsap.core.Tween | null = null;

    public constructor() {
        super();
        this.eventMode = 'none';
        this.track.alpha = ALPHA;
        this.hand.anchor.set(FINGERTIP.x, FINGERTIP.y);
        this.addChild(this.track, this.hand);
        this.visible = false;
    }

    /** A Bernoulli lemniscate along the picture: t = 0 at its right end. */
    private place(t: number): void {
        const across = 1 + Math.sin(t) * Math.sin(t);
        this.hand.position.set(
            (WIDTH * PATH.x * Math.cos(t)) / across,
            (this.track.height * PATH.y * Math.sin(t) * Math.cos(t)) / across,
        );
    }

    public show(): void {
        if (this.visible) return;
        gsap.killTweensOf(this);
        this.visible = true;
        this.alpha = 1;
        this.lap.t = 0;
        this.place(0);
        this.loop = gsap.to(this.lap, { t: Math.PI * 2, duration: LOOP_SECONDS, ease: 'none', repeat: -1, onUpdate: () => this.place(this.lap.t) });
    }

    /** Fades out, then stops. */
    public hide(): void {
        if (!this.visible) return;
        gsap.to(this, {
            alpha: 0,
            duration: FADE_SECONDS,
            onComplete: () => {
                this.visible = false;
                this.loop?.kill();
                this.loop = null;
            },
        });
    }

    public override destroy(): void {
        this.loop?.kill();
        gsap.killTweensOf(this);
        super.destroy({ children: true });
    }
}
