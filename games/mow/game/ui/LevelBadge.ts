// LevelBadge.ts
//
// The farm test's player level on the HUD, the most important bar on screen (top centre, big): the 2D library's level
// slider (library3d/2d, Layer Lab: Slider_Level02 — a blue shield badge with the level on it, a dark rounded track and
// a blue fill, "into / need" written over it), copied into the UI atlas (raw-assets/images/ui{tps}). Nine-sliced at
// half scale, so it stays sharp at any size. A level up pops the badge and flashes the bar.

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { UiKit } from './UiKit';

/** The bar (screen px, the badge overlapping its left end), the badge's size, the fill's inset inside the track. */
const BAR = { width: 300, height: 36, inset: 6 };
const BADGE = 78;
/** Nine-slices: drawn at this share of their source size (the source is 2x: sharp on high-DPI screens). */
const SLICE_SCALE = 0.5;
const FRAMES = { badge: 'Slider_Level02_Icon_Badge_Blue', track: 'Slider_Level02_Bg_Single', fill: 'Slider_Level02_Fill01_Blue' };
const RIM = 0x1d140e;

/** A nine-slice of `frame` (corners `l, t, r, b` in source px) `width` x `height` on screen, its left middle at the origin. */
function sliced(frame: string, corners: [number, number, number, number], width: number, height: number): PIXI.NineSlicePlane {
    const plane = new PIXI.NineSlicePlane(PIXI.Texture.from(frame), ...corners);
    plane.width = width / SLICE_SCALE;
    plane.height = height / SLICE_SCALE;
    plane.scale.set(SLICE_SCALE);
    plane.y = -height / 2;
    return plane;
}

export class LevelBadge extends PIXI.Container {
    private readonly badge = new PIXI.Container();
    private readonly number: PIXI.Text;
    private readonly fill: PIXI.NineSlicePlane;
    private readonly amount: PIXI.Text;
    private readonly track: PIXI.Container;
    private shown = -1;
    private share = -1;

    public constructor() {
        super();
        const style = (size: number) => new PIXI.TextStyle({
            fontFamily: UiKit.fontFamily('primary'), fontSize: size, fill: 0xffffff, stroke: RIM, strokeThickness: 6, lineJoin: 'round',
        });
        // The track runs right from under the badge's middle.
        this.track = new PIXI.Container();
        this.track.addChild(sliced(FRAMES.track, [12, 20, 12, 20], BAR.width, BAR.height));
        const innerHeight = BAR.height - BAR.inset * 2;
        this.fill = sliced(FRAMES.fill, [1, 10, 4, 10], BAR.width - BAR.inset * 2, innerHeight);
        this.fill.position.set(BAR.inset, -innerHeight / 2);
        this.track.addChild(this.fill);
        this.amount = new PIXI.Text('', style(22));
        this.amount.anchor.set(0.5);
        this.amount.position.set(BAR.width / 2 + BADGE * 0.2, 1);
        this.track.addChild(this.amount);
        this.addChild(this.track);

        const shield = PIXI.Sprite.from(FRAMES.badge);
        shield.anchor.set(0.5);
        shield.width = BADGE;
        shield.height = BADGE * (107 / 102);
        this.number = new PIXI.Text('1', style(38));
        this.number.anchor.set(0.5);
        this.number.y = 1;
        this.badge.addChild(shield, this.number);
        this.addChild(this.badge);
    }

    /** Its full width (the badge's left edge to the bar's right end), for centring it. */
    public static get width(): number {
        return BADGE / 2 + BAR.width;
    }

    /** The bar's part clear of the badge (from the badge's right edge to the bar's end) and the bar's bottom, unscaled from its origin. */
    public static get barSpan(): { from: number; to: number; bottom: number } {
        return { from: BADGE / 2, to: BAR.width, bottom: BAR.height / 2 };
    }

    /** The level and the XP into it (`into` of `need`). */
    public set(level: number, into: number, need: number): void {
        const share = Math.max(0, Math.min(1, into / Math.max(1, need)));
        if (level !== this.shown) {
            const up = this.shown > 0 && level > this.shown;
            this.shown = level;
            this.number.text = String(level);
            if (up) {
                gsap.killTweensOf(this.badge.scale);
                this.badge.scale.set(1.5);
                gsap.to(this.badge.scale, { x: 1, y: 1, duration: 0.6, ease: 'elastic.out(1, 0.5)' });
                gsap.fromTo(this.track, { alpha: 0.4 }, { alpha: 1, duration: 0.5 });
            }
        }
        this.amount.text = `${Math.floor(into)}/${Math.ceil(need)}`;
        if (Math.abs(share - this.share) < 0.001) return;
        this.share = share;
        // The fill from the track's left, at least its rounded ends' width (hidden while empty).
        const full = BAR.width - BAR.inset * 2;
        this.fill.visible = share > 0;
        this.fill.width = Math.max(10, full * share) / SLICE_SCALE;
    }

    public override destroy(): void {
        gsap.killTweensOf(this.badge.scale);
        gsap.killTweensOf(this.track);
        super.destroy({ children: true });
    }
}
