// Overlay.ts
//
// A window over the main screen (the arena's: a card's details, a card's upgrade, a chest opening, the trophy road, the
// profile): the screen darkened (it takes every tap under it), and `panel` in the middle, scaled down to fit a small
// screen. `onClose` when it's closed (close()); a subclass lays its panel out round (0, 0), PANEL_SIZE big.

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { Game } from 'core/Game';
import { framePlane, iconSprite, killTweensDeep, label, tappable } from './UiParts';
import { Pattern, PatternLook } from './Pattern';

/** The close button's size, and how far in from the corner its middle sits. */
const CLOSE = { size: 64, inset: 8 };
/** A box's inside: how far in from its frame's edge, its corners, how much lighter its top is, the diamonds' strength. */
const BOX = { inset: 8, corner: 20, lighter: 0.18, strength: 0.06 };

/** `colour` towards white by `t`. */
function lighten(colour: number, t: number): number {
    const mix = (shift: number) => Math.round(((colour >> shift) & 255) + (255 - ((colour >> shift) & 255)) * t);
    return (mix(16) << 16) | (mix(8) << 8) | mix(0);
}

export class Overlay extends PIXI.Container {
    protected readonly dim = new PIXI.Graphics();
    protected readonly panel = new PIXI.Container();
    private closed = false;
    /** A full-screen moment's backdrop (backdrop()), and the boxes' own patterns (back()): each moved every frame. */
    private screenPattern: Pattern | null = null;
    private readonly patterns: Pattern[] = [];

    /** `size`: the panel's (for fitting it to the screen); `dimAlpha`: how dark behind; `tapOut`: a tap off the panel closes it. */
    public constructor(protected readonly size: { width: number; height: number }, protected onClose: () => void = () => undefined,
        private readonly dimAlpha = 0.78, tapOut = true) {
        super();
        this.dim.eventMode = 'static';
        if (tapOut) this.dim.on('pointertap', () => this.close());
        this.panel.eventMode = 'static';
        this.addChild(this.dim, this.panel);
    }

    /** A full-screen moment: the moving pattern behind it all (over the dim), in `look`. */
    protected backdrop(look: PatternLook): void {
        this.screenPattern = new Pattern(look);
        this.screenPattern.eventMode = 'none';
        this.addChildAt(this.screenPattern, 1);
    }

    /** A framed back, `width` x `height`, centred, in `tint`, its inside the moving pattern (lighter at its top); a title
     *  on it (`title`, at its top). */
    protected back(width: number, height: number, tint: number, title = ''): PIXI.Container {
        const holder = new PIXI.Container();
        const frame = framePlane('BorderFrame_Round24', width, height, 1);
        frame.tint = tint;
        frame.position.set(-width / 2, -height / 2);
        const inset = BOX.inset;
        const pattern = new Pattern({ top: lighten(tint, BOX.lighter), bottom: tint, strength: BOX.strength, glows: 2, tile: 80 });
        pattern.place(-width / 2 + inset, -height / 2 + inset, width - inset * 2, height - inset * 2);
        const mask = new PIXI.Graphics().beginFill(0xffffff).drawRoundedRect(-width / 2 + inset, -height / 2 + inset, width - inset * 2, height - inset * 2, BOX.corner).endFill();
        pattern.mask = mask;
        this.patterns.push(pattern);
        holder.addChild(frame, pattern, mask);
        if (title) {
            const words = label(38);
            words.text = title;
            words.y = -height / 2 + 44;
            holder.addChild(words);
        }
        return holder;
    }

    /** The pack's red round close button (as the Mow game's popups), on the top-right corner of a `width` x `height`
     *  back centred at (0, 0): it closes it. */
    protected closeButton(width: number, height: number): PIXI.Container {
        const button = new PIXI.Container();
        button.addChild(iconSprite('Button_Round06_Red', CLOSE.size), iconSprite('Icon_Close02', CLOSE.size * 0.5));
        button.position.set(width / 2 - CLOSE.inset, -height / 2 + CLOSE.inset);
        tappable(button, () => this.close());
        return button;
    }

    public layout(): void {
        const screen = Game.overlayScreenData;
        if (!screen) return;
        const { topLeft, center, width, height } = screen;
        this.dim.clear().beginFill(0x0b1030, this.dimAlpha).drawRect(topLeft.x, topLeft.y, width, height).endFill();
        this.screenPattern?.place(topLeft.x, topLeft.y, width, height);
        this.panel.position.copyFrom(center);
        this.panel.scale.set(Math.min(1, (width - 24) / this.size.width, (height - 24) / this.size.height));
    }

    /** Pops in. */
    public show(): void {
        this.layout();
        const scale = this.panel.scale.x;
        gsap.fromTo(this.panel.scale, { x: scale * 0.7, y: scale * 0.7 }, { x: scale, y: scale, duration: 0.3, ease: 'back.out(2.2)' });
    }

    /** Its patterns moving, then a subclass's own animation (animate()). */
    public update(dt: number): void {
        this.screenPattern?.update(dt);
        // (A box redrawn — the profile's, after a new avatar — leaves its old pattern behind: dropped.)
        for (let i = this.patterns.length - 1; i >= 0; i--) {
            if (this.patterns[i].destroyed) this.patterns.splice(i, 1);
            else this.patterns[i].update(dt);
        }
        this.animate(dt);
    }

    protected animate(_dt: number): void {
        // A subclass's animation.
    }

    public close(): void {
        if (this.closed) return;
        this.closed = true;
        this.onClose();
        this.destroy({ children: true });
    }

    public override destroy(options?: boolean | PIXI.IDestroyOptions): void {
        killTweensDeep(this);
        super.destroy(options);
    }
}
