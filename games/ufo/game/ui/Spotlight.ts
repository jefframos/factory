// Spotlight.ts
//
// A guided step (the main screen's versus-mode tutorial): the whole screen darkened and blocked but a round hole over one
// thing (`target`: a button, followed as it moves), a hand tapping at it, and a line of words over it. A tap in the hole:
// `onTap` (the step's own action); anywhere else does nothing.

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { Game } from 'core/Game';
import { iconSprite, label } from './UiParts';

const LOOK = { dim: 0x060a26, alpha: 0.78, pad: 18, ring: 0xffe066, ringWidth: 6, hand: 120, text: 34, textGap: 60 };

export class Spotlight extends PIXI.Container {
    private readonly dim = new PIXI.Graphics();
    private readonly ring = new PIXI.Graphics();
    private readonly hand = iconSprite('Tutorial_Hand', LOOK.hand);
    private readonly words = label(LOOK.text, 0xffe066);
    /** The hole: its middle and half sizes (round-cornered, round the target's own tap area). */
    private hole = { x: 0, y: 0, hw: 0, hh: 0 };
    private time = 0;

    /** Over `target` (its bounds, as it is each frame), `text` over it; `onTap` a tap in it. */
    public constructor(private readonly target: PIXI.Container, text: string, onTap: () => void) {
        super();
        this.dim.eventMode = 'static';
        this.dim.on('pointertap', (event: PIXI.FederatedPointerEvent) => {
            const at = this.toLocal(event.global);
            if (Math.abs(at.x - this.hole.x) <= this.hole.hw && Math.abs(at.y - this.hole.y) <= this.hole.hh) onTap();
        });
        this.words.text = text;
        this.words.style.wordWrap = true;
        this.words.style.wordWrapWidth = 560;
        this.hand.eventMode = 'none';
        this.addChild(this.dim, this.ring, this.words, this.hand);
        this.update(0);
        this.alpha = 0;
        gsap.to(this, { alpha: 1, duration: 0.3 });
    }

    /** Follows the target; the hand taps, the ring breathes. */
    public update(dt: number): void {
        if (this.target.destroyed) return;
        this.time += dt;
        const screen = Game.overlayScreenData;
        if (!screen) return;
        // Its own tap area when it has one (a button's: not its glow round it), else its bounds.
        let topLeft: PIXI.Point;
        let bottomRight: PIXI.Point;
        const area = this.target.hitArea;
        if (area instanceof PIXI.Rectangle) {
            topLeft = this.toLocal(this.target.toGlobal(new PIXI.Point(area.x, area.y)));
            bottomRight = this.toLocal(this.target.toGlobal(new PIXI.Point(area.x + area.width, area.y + area.height)));
        } else {
            const bounds = this.target.getBounds();
            topLeft = this.toLocal(new PIXI.Point(bounds.x, bounds.y));
            bottomRight = this.toLocal(new PIXI.Point(bounds.x + bounds.width, bounds.y + bounds.height));
        }
        const x = (topLeft.x + bottomRight.x) / 2;
        const y = (topLeft.y + bottomRight.y) / 2;
        const hw = Math.abs(bottomRight.x - topLeft.x) / 2 + LOOK.pad;
        const hh = Math.abs(bottomRight.y - topLeft.y) / 2 + LOOK.pad;
        this.hole = { x, y, hw, hh };
        const corner = Math.min(hw, hh) * 0.6;
        const { topLeft: s, width, height } = screen;
        this.dim.clear().beginFill(LOOK.dim, LOOK.alpha).drawRect(s.x - 10, s.y - 10, width + 20, height + 20).beginHole().drawRoundedRect(x - hw, y - hh, hw * 2, hh * 2, corner).endHole().endFill();
        // Every tap is its own (the hole's too: a tap there would otherwise reach the button under it, and the step
        // would never hear of it): the hole's, onTap.
        this.dim.hitArea = new PIXI.Rectangle(s.x - 10, s.y - 10, width + 20, height + 20);
        const grow = 4 * Math.sin(this.time * 5);
        this.ring.clear().lineStyle(LOOK.ringWidth, LOOK.ring, 0.9).drawRoundedRect(x - hw - grow, y - hh - grow, (hw + grow) * 2, (hh + grow) * 2, corner + grow);
        // The words over it (under it when it's near the top), kept on the screen.
        const above = y - hh - LOOK.textGap > s.y + 80;
        this.words.position.set(Math.max(s.x + 290, Math.min(s.x + width - 290, x)), above ? y - hh - LOOK.textGap : y + hh + LOOK.textGap);
        // The hand tapping on it (its fingertip, top left of the picture, on the target's lower right).
        const tap = Math.abs(Math.sin(this.time * 3.2));
        this.hand.position.set(x + Math.min(hw * 0.45, 120) + LOOK.hand * 0.3 + tap * 12, y + hh * 0.2 + LOOK.hand * 0.3 + tap * 12);
    }

    public override destroy(options?: boolean | PIXI.IDestroyOptions): void {
        gsap.killTweensOf(this);
        super.destroy(options);
    }
}
