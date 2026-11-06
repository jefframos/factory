// TutorialOverlay.ts
//
// The first-time tutorial's look (AntScene runs it): the screen darkens all but a round hole over the tile to tap, the
// pack's hand points at it, bobbing, and a bubble over it says what to do. The dark eats taps on the UI under it; the
// scene only lets the highlighted tile be taken.

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { Game } from 'core/Game';
import { DARK, framePlane, iconSprite, plainLabel } from './UiParts';

/** Design units: the dark, the hole's soft ring, the hand, the bubble over the hole. */
const DIM = { color: 0x10123a, alpha: 0.62, ring: 0xffffff, ringWidth: 5 };
const HAND = { size: 110, x: 18, y: 24, move: 16, seconds: 0.5 };
const BUBBLE = { width: 470, height: 104, above: 30, text: 30, color: 0xfff4e6 };

export class TutorialOverlay extends PIXI.Container {
    private readonly dim = new PIXI.Graphics();
    private readonly hand = iconSprite('tutorial_hand_3', HAND.size);
    private readonly bubble = new PIXI.Container();
    private readonly words = plainLabel(BUBBLE.text, DARK);
    private bob?: gsap.core.Tween;
    /** Where the hand was put (it bobs from there): it starts over only when the tile it points at has moved. */
    private readonly handAt = new PIXI.Point(NaN, NaN);
    /** A tap anywhere on the dark (when set): pointing out a button, any tap carries on. */
    public onTap: (() => void) | null = null;

    public constructor() {
        super();
        this.dim.eventMode = 'static';
        this.dim.on('pointerdown', (event: PIXI.FederatedPointerEvent) => event.stopPropagation());
        this.dim.on('pointertap', (event: PIXI.FederatedPointerEvent) => {
            event.stopPropagation();
            this.onTap?.();
        });
        // The fingertip's where the hand is placed.
        this.hand.anchor.set(0.22, 0.2);
        const back = framePlane('BasicFrame_Round20', BUBBLE.width, BUBBLE.height);
        back.tint = BUBBLE.color;
        back.position.set(-BUBBLE.width / 2, -BUBBLE.height / 2);
        this.words.style.align = 'center';
        this.bubble.addChild(back, this.words);
        this.eventMode = 'none';
        this.visible = false;
        this.addChild(this.dim, this.bubble, this.hand);
    }

    /** Shows the hole at (`x`, `y`) (this container's units), `radius` round, the hand on it and `text` over it. */
    public show(x: number, y: number, radius: number, text: string): void {
        const screen = Game.overlayScreenData;
        if (!screen) return;
        const first = !this.visible;
        this.visible = true;
        this.eventMode = 'static';
        const margin = 400;
        this.dim.clear()
            .beginFill(DIM.color, DIM.alpha)
            .drawRect(screen.topLeft.x - margin, screen.topLeft.y - margin, screen.width + margin * 2, screen.height + margin * 2)
            .beginHole().drawCircle(x, y, radius).endHole()
            .endFill()
            .lineStyle(DIM.ringWidth, DIM.ring, 0.9).drawCircle(x, y, radius);
        this.words.text = text;
        const bubbleY = y - radius - BUBBLE.above - BUBBLE.height / 2;
        this.bubble.position.set(Math.max(screen.topLeft.x + BUBBLE.width / 2 + 10, Math.min(screen.topLeft.x + screen.width - BUBBLE.width / 2 - 10, x)), bubbleY);
        const handX = x + HAND.x;
        const handY = y + HAND.y;
        if (first || !this.bob || Math.hypot(this.handAt.x - handX, this.handAt.y - handY) > 2) {
            this.bob?.kill();
            this.handAt.set(handX, handY);
            this.hand.position.set(handX, handY);
            this.bob = gsap.to(this.hand, { x: handX + HAND.move, y: handY + HAND.move, duration: HAND.seconds, yoyo: true, repeat: -1, ease: 'sine.inOut' });
        }
        if (first) gsap.fromTo(this, { alpha: 0 }, { alpha: 1, duration: 0.25 });
    }

    public hide(): void {
        this.visible = false;
        this.eventMode = 'none';
        this.bob?.kill();
        this.bob = undefined;
    }

    public override destroy(): void {
        this.bob?.kill();
        gsap.killTweensOf(this);
        super.destroy({ children: true });
    }
}
