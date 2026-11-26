// HoldButton.ts
//
// Hold to punch, by the thumb: a big button low on the right. Held down, the hands punch on their own (WallScene, HOLD
// punches a second plus IRON GRIP's), where AUTO would; let go anywhere, they stop. Pressed, it sinks and glows, its punches a second over it. There from
// wall HOLD.wall on. Held, it hurries on between walls too (HOLD.rush): ▶▶ in its corner.

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { frame, sprite, text } from './parts';

export const HOLD_BUTTON = { size: 128, icon: 82 };

export class HoldButton extends PIXI.Container {
    /** It's held down now (or latched on, with AUTO HOLD). */
    public pressed = false;
    /** AUTO HOLD's had: a tap keeps it on, the next lets it go. */
    public latching = false;
    private latched = false;
    private readonly lock = sprite('Icon_Lock03', 34);
    private readonly body = new PIXI.Container();
    private readonly glow = sprite('ItemFrame_BgGlow', HOLD_BUTTON.size + 30);
    /** Its label: HOLD, and its punches a second while it's held. */
    private readonly words = text('HOLD', 26, 0xffffff, 0x5c0f16, 7);
    private pointer: number | null = null;
    private clock = 0;

    public constructor() {
        super();
        const { size } = HOLD_BUTTON;
        this.glow.tint = 0xffb04a;
        this.glow.alpha = 0;
        const back = frame('ItemFrame03_Single_Red', [53, 53, 54, 56], size, size, 0.9);
        const fist = sprite('Wall_fists', HOLD_BUTTON.icon);
        fist.y = -10;
        this.words.y = size / 2 - 24;
        // Fast forward, a round badge on its corner (as the rewind's): held, it also hurries on between walls.
        const forward = new PIXI.Container();
        const disc = sprite('BorderFrame_Circle78', 46);
        disc.tint = 0x2a1050;
        forward.addChild(disc);
        for (const x of [-6, 6]) {
            const arrow = sprite('Icon_Arrow_Next1', 20);
            arrow.x = x;
            forward.addChild(arrow);
        }
        forward.position.set(-size / 2 + 6, -size / 2 + 6);
        this.lock.position.set(size / 2 - 12, -size / 2 + 12);
        this.lock.visible = false;
        this.body.addChild(this.glow, back, fist, this.words, forward, this.lock);
        this.addChild(this.body);
        this.eventMode = 'static';
        this.cursor = 'pointer';
        this.hitArea = new PIXI.Circle(0, 0, size * 0.62);
        this.on('pointerdown', (event: PIXI.FederatedPointerEvent) => {
            // (Not a punch on the wall too.)
            event.stopPropagation();
            this.press(event.pointerId);
        });
        window.addEventListener('pointerup', this.onUp, true);
        window.addEventListener('pointercancel', this.onUp, true);
        window.addEventListener('blur', this.release);
    }

    private press(id: number): void {
        // (AUTO HOLD: latched on, a tap lets it go.)
        if (this.latched) {
            this.latched = false;
            this.lock.visible = false;
            this.pointer = null;
            this.release();
            return;
        }
        if (this.pressed) return;
        this.pressed = true;
        this.pointer = id;
        gsap.killTweensOf(this.body.scale);
        gsap.to(this.body.scale, { x: 0.9, y: 0.9, duration: 0.08 });
    }

    private readonly onUp = (event: PointerEvent): void => {
        if (this.pointer === null || event.pointerId !== this.pointer) return;
        // (AUTO HOLD: let go of, it stays on.)
        if (this.latching && this.pressed) {
            this.latched = true;
            this.lock.visible = true;
            this.pointer = null;
            return;
        }
        this.release();
    };

    private readonly release = (): void => {
        if (!this.pressed || this.latched) return;
        this.pressed = false;
        this.pointer = null;
        gsap.killTweensOf(this.body.scale);
        gsap.to(this.body.scale, { x: 1, y: 1, duration: 0.25, ease: 'back.out(3)' });
    };

    /** Shown for the first time: a jump, so it's seen. */
    public bump(): void {
        gsap.killTweensOf(this.scale);
        this.scale.set(1.35);
        gsap.to(this.scale, { x: 1, y: 1, duration: 0.7, ease: 'elastic.out(1, 0.35)' });
    }

    /** `perSecond`: its punches a second (shown over it while it's held). */
    public update(delta: number, perSecond: number): void {
        this.clock += delta;
        if (!this.visible && this.pressed) this.release();
        this.glow.alpha = this.pressed ? 0.75 + 0.25 * Math.sin(this.clock * 12) : 0;
        // (Held: its label says how fast it's going.)
        const label = this.pressed ? `${perSecond}/s` : 'HOLD';
        if (this.words.text !== label) this.words.text = label;
    }

    public override destroy(options?: boolean | PIXI.IDestroyOptions): void {
        window.removeEventListener('pointerup', this.onUp, true);
        window.removeEventListener('pointercancel', this.onUp, true);
        window.removeEventListener('blur', this.release);
        super.destroy(options);
    }
}
