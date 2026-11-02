// TownMiniature.ts
//
// The town map's pictures: miniatures of the town baked from the 3D world by the editor's Map shots tab
// (TownSnapshotScene: images/non-preload/map/<zone>.webp, 512 across, and <zone>-small.webp, the corner's size: a
// big picture shrunk on the fly turns jagged, so each size is its own, shrunk smoothly at bake time).
//   - TownMiniature: the whole town, top-right under the trophy, under a dark veil that drains from the bottom up as
//     the town is restored (a rippling edge with a glow), and a badge with the town's %. Tapping it opens the map.
//     celebrate(): a section restored: it flies to the middle of the screen, big, with rays; the veil drains to the
//     town's new share (sparks riding its edge, the % counting up), then a flash, a burst and confetti; and it flies
//     home.
// The section pictures (<section id>.webp) are baked too, for later; nothing shows them yet.
// Missing pictures (not baked yet) leave `ready` false: the HUD falls back to the drawn map (TownMap).

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { UiKit } from './UiKit';
import { UiAnim } from './UiAnim';

const MAP_BASE = './mow/images/non-preload/map/';
/** The veil: the bright picture tinted this (a dusky violet, the "not restored yet" look). */
const VEIL_TINT = 0x6458b8;
/** The glow riding the veil's edge: how tall a band of the picture lights up, and how bright. */
const GLOW_BAND = 0.06;
const GLOW_ALPHA = 0.55;
/** The edge's ripple: height (share of the picture's height) and speed. */
const RIPPLE = 0.012;
const RIPPLE_SPEED = 4;
/** How fast the corner's fill eases to the real share (per second). */
const EASE_RATE = 4;
/** celebrate(): seconds for each beat (out, the veil draining, held up after the flash, back); its length is REVEAL_SEC. */
const REVEAL = { out: 0.4, fill: 1.1, hold: 0.7, back: 0.4 };
export const REVEAL_SEC = REVEAL.out + REVEAL.fill + REVEAL.hold + REVEAL.back;
/** Sparks thrown off the veil's edge while it drains (seconds apart). */
const EDGE_SPARK_SEC = 0.12;

/** A baked miniature's texture (`town` or a section id), or null when it isn't there. */
export async function loadMiniature(name: string): Promise<PIXI.Texture | null> {
    try {
        const texture = await PIXI.Assets.load<PIXI.Texture>(`${MAP_BASE}${name}.webp`);
        return texture?.valid ? texture : null;
    } catch {
        return null;
    }
}

/**
 * A miniature under its veil: the bright picture, the dark one over it (masked to above the fill line), and a glow
 * band just under the line. `share` 0..1 is how far up from the bottom it's bright.
 */
class VeiledPicture extends PIXI.Container {
    public share = 0;
    private readonly veilMask = new PIXI.Graphics();
    private readonly glowMask = new PIXI.Graphics();
    private readonly glow: PIXI.Sprite;
    private readonly sprites: PIXI.Sprite[];
    private time = Math.random() * 10;

    public constructor(public texture: PIXI.Texture, public readonly pictureWidth: number) {
        super();
        const bright = new PIXI.Sprite(texture);
        const dark = new PIXI.Sprite(texture);
        this.glow = new PIXI.Sprite(texture);
        this.sprites = [bright, dark, this.glow];
        for (const sprite of this.sprites) sprite.anchor.set(0.5);
        this.setTexture(texture);
        dark.tint = VEIL_TINT;
        dark.mask = this.veilMask;
        this.glow.blendMode = PIXI.BLEND_MODES.ADD;
        this.glow.alpha = GLOW_ALPHA;
        this.glow.mask = this.glowMask;
        this.addChild(bright, dark, this.glow, this.veilMask, this.glowMask);
        this.draw(0);
    }

    /** Another size of the same picture (the big one while it's blown up), at the same width. */
    public setTexture(texture: PIXI.Texture): void {
        this.texture = texture;
        const scale = this.pictureWidth / texture.width;
        for (const sprite of this.sprites) {
            sprite.texture = texture;
            sprite.scale.set(scale);
        }
    }

    public get pictureHeight(): number {
        return this.glow.height;
    }

    /** Where the veil's edge is (local y). */
    public get edgeY(): number {
        return this.pictureHeight / 2 - this.pictureHeight * Math.max(0, Math.min(1, this.share));
    }

    /** Redraws the veil at `share` (call each frame; `delta` moves the ripple). */
    public draw(delta: number): void {
        this.time += delta;
        const w = this.pictureWidth;
        const h = this.pictureHeight;
        const left = -w / 2;
        const top = -h / 2;
        const bottom = h / 2;
        const share = Math.max(0, Math.min(1, this.share));
        const veil = this.veilMask.clear();
        const glow = this.glowMask.clear();
        this.glow.visible = share > 0.001 && share < 0.999;
        if (share >= 0.999) return;
        const level = bottom - h * share;
        const steps = 24;
        const amp = share <= 0.001 ? 0 : h * RIPPLE;
        const edge: number[] = [];
        for (let s = 0; s <= steps; s++) {
            const x = left + (w * s) / steps;
            edge.push(x, Math.max(top, Math.min(bottom, level + Math.sin(s * 0.9 + this.time * RIPPLE_SPEED) * amp)));
        }
        // The dark part: the top down to the edge.
        veil.beginFill(0xffffff).drawPolygon([left, top, w / 2, top, ...reversePairs(edge)]).endFill();
        if (!this.glow.visible) return;
        // The glow: a band just under the edge.
        const band = h * GLOW_BAND;
        const under: number[] = [];
        for (let i = 0; i < edge.length; i += 2) under.push(edge[i], Math.min(bottom, edge[i + 1] + band));
        glow.beginFill(0xffffff).drawPolygon([...edge, ...reversePairs(under)]).endFill();
    }
}

/** [x0, y0, x1, y1, …] backwards, pair by pair (a polygon's return edge). */
function reversePairs(points: number[]): number[] {
    const out: number[] = [];
    for (let i = points.length - 2; i >= 0; i -= 2) out.push(points[i], points[i + 1]);
    return out;
}

/** The whole town's miniature in the corner, with its % badge. Origin: the picture's centre. */
export class TownMiniature extends PIXI.Container {
    /** Resolves true once the picture is in (false: not baked; the HUD shows the drawn map instead). */
    public readonly ready: Promise<boolean>;
    private picture?: VeiledPicture;
    private readonly badge = new PIXI.Container();
    private readonly badgeText = UiKit.text('hud', 'toast', { text: '' }, { fontSize: 24, strokeThickness: 5 });
    private target = 0;
    private percentShown = -1;
    /** The corner's picture and the big one (shown while it's blown up in celebrate()). */
    private small?: PIXI.Texture;
    private big?: PIXI.Texture;
    /** While it celebrates, the veil and the % wait for its own fill (not the eased one). */
    private held = false;
    private readonly tick = () => this.update(gsap.ticker.deltaRatio() / 60);

    public constructor(private readonly pictureWidth: number) {
        super();
        this.visible = false;
        // The corner's own size (the big one if there's no small one yet); the big one for celebrate().
        this.ready = Promise.all([loadMiniature('town-small'), loadMiniature('town')]).then(([small, big]) => {
            const texture = small ?? big;
            if (!texture || this.destroyed) return false;
            this.small = texture;
            this.big = big ?? texture;
            this.build(texture);
            return true;
        });
    }

    private build(texture: PIXI.Texture): void {
        this.picture = new VeiledPicture(texture, this.pictureWidth);
        this.picture.share = this.target;
        const pill = new PIXI.Graphics().lineStyle(3, 0xffffff, 0.95).beginFill(0x2a2350, 0.92).drawRoundedRect(-36, -18, 72, 36, 18).endFill();
        this.badgeText.anchor.set(0.5);
        this.badge.addChild(pill, this.badgeText);
        this.badge.position.set(this.pictureWidth / 2 - 30, this.picture.pictureHeight / 2 - 8);
        this.addChild(this.picture, this.badge);
        this.visible = true;
        gsap.ticker.add(this.tick);
    }

    /** Up in the middle (celebrate()): the HUD's layout leaves it be. */
    public get celebrating(): boolean {
        return this.held;
    }

    /** Height of the picture (0 until it's loaded), for the HUD's layout. */
    public get pictureHeight(): number {
        return this.picture?.pictureHeight ?? 0;
    }

    /** The whole town's restored share (0..1), every frame; the veil eases to it. */
    public setShare(share: number): void {
        this.target = Math.max(0, Math.min(1, share));
    }

    /**
     * A section restored: flies from its corner to `centre` (in its parent) at `scale`, with rays; the veil drains to
     * the town's new share (sparks off its edge, the % counting up); a flash, a burst, confetti; then back to `home()`.
     * `onDone` as it lands. Takes REVEAL_SEC.
     */
    public celebrate(centre: PIXI.IPointData, scale: number, home: () => PIXI.IPointData, onDone: () => void): void {
        const picture = this.picture;
        if (!picture) return;
        UiAnim.kill(this);
        // Over everything else in the HUD while it's up.
        const parent = this.parent;
        const index = parent?.getChildIndex(this) ?? 0;
        parent?.addChild(this);
        this.held = true;
        // Blown up: the big picture (the corner's own would turn soft).
        if (this.big) picture.setTexture(this.big);
        const shine = UiAnim.rays(this, this.pictureWidth * 0.75, 0xfff0a0, 0.6, 8);
        this.setChildIndex(shine.rays, 0);
        shine.rays.alpha = 0;
        const width = this.pictureWidth;
        const height = picture.pictureHeight;
        let sparkTime = 0;
        const sparks = () => {
            sparkTime += gsap.ticker.deltaRatio() / 60;
            if (sparkTime < EDGE_SPARK_SEC || this.destroyed) return;
            sparkTime = 0;
            UiAnim.sparkBurst(this, (Math.random() - 0.5) * width * 0.8, picture.edgeY, 0xfff0a0, 14);
        };
        const finish = () => {
            gsap.ticker.remove(sparks);
            shine.tweens.forEach((tween) => tween.kill());
            if (!shine.rays.destroyed) shine.rays.destroy({ children: true });
            if (this.destroyed) return;
            this.held = false;
            this.scale.set(1);
            if (this.small) picture.setTexture(this.small);
            const to = home();
            this.position.set(to.x, to.y);
            if (parent && !parent.destroyed) parent.addChildAt(this, Math.min(index, parent.children.length - 1));
            UiAnim.punch(this, 0.15);
            onDone();
        };
        const flashAt = REVEAL.out + REVEAL.fill;
        const backAt = flashAt + REVEAL.hold;
        gsap.timeline({ onComplete: finish })
            .to(this, { x: centre.x, y: centre.y, duration: REVEAL.out, ease: 'power2.out' }, 0)
            .to(this.scale, { x: scale, y: scale, duration: REVEAL.out, ease: 'back.out(1.6)' }, 0)
            .to(shine.rays, { alpha: 1, duration: 0.3 }, REVEAL.out * 0.5)
            .call(() => {
                gsap.ticker.add(sparks);
            }, undefined, REVEAL.out)
            .to(picture, { share: () => this.target, duration: REVEAL.fill, ease: 'sine.inOut' }, REVEAL.out)
            .call(() => {
                gsap.ticker.remove(sparks);
                if (this.destroyed) return;
                // The flash: the picture once more, added on top and fading.
                const flash = new PIXI.Sprite(picture.texture);
                flash.anchor.set(0.5);
                flash.scale.set(width / picture.texture.width);
                flash.blendMode = PIXI.BLEND_MODES.ADD;
                this.addChild(flash);
                gsap.to(flash, { alpha: 0, duration: 0.5, onComplete: () => flash.destroy() });
                UiAnim.sparkBurst(this, 0, 0, 0xfff0a0, width * 0.5);
                UiAnim.confetti(this, 0, -height * 0.2, 60, 0.5);
                UiAnim.punch(this.badge, 0.6);
            }, undefined, flashAt)
            .to(shine.rays, { alpha: 0, duration: 0.25 }, backAt)
            .to(this, { x: () => home().x, y: () => home().y, duration: REVEAL.back, ease: 'power2.in' }, backAt)
            .to(this.scale, { x: 1, y: 1, duration: REVEAL.back, ease: 'power2.in' }, backAt);
    }

    private update(delta: number): void {
        const picture = this.picture;
        if (this.destroyed || !picture) return;
        if (!this.held) {
            picture.share += (this.target - picture.share) * Math.min(1, delta * EASE_RATE);
            if (Math.abs(this.target - picture.share) < 0.001) picture.share = this.target;
        }
        picture.draw(delta);
        const percent = Math.floor(picture.share * 100 + 0.001);
        if (percent !== this.percentShown) {
            this.percentShown = percent;
            this.badgeText.text = `${percent}%`;
        }
    }

    public override destroy(): void {
        gsap.ticker.remove(this.tick);
        UiAnim.kill(this);
        super.destroy({ children: true });
    }
}
