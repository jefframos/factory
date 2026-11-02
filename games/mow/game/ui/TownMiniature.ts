// TownMiniature.ts
//
// The town map's pictures: miniatures of the town baked from the 3D world by the editor's Map shots tab
// (TownSnapshotScene: images/non-preload/map/<zone>.webp, 512 across, and <zone>-small.webp, the corner's size: a
// big picture shrunk on the fly turns jagged, so each size is its own, shrunk smoothly at bake time).
//   - TownMiniature: the whole town, a small icon top-right under the trophy, whole, with the town's % (and a star)
//     under it. celebrate(): a section restored: it flies to the middle of the screen, big, with rays and the town's
//     name on a ribbon, under a dark veil (a rippling edge with a glow) that drains from the bottom up to the town's
//     new share (a bright line riding its edge, a shimmer, the % counting up), then a sweep of light, a soft flash and
//     stars popping out of the %; and it flies home,
//     whole again. preview() (a tap on it): the same flight, the veil draining from empty up to the town's share, no
//     fanfare; it stays up, with a close button, until close().
// The section pictures (<section id>.webp) are baked too, for later; nothing shows them yet.
// Missing pictures (not baked yet) leave `ready` false: the HUD falls back to the drawn map (TownMap).

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { UiKit } from './UiKit';
import { UiAnim, UiTween } from './UiAnim';
import { MowAudio } from '../audio/MowAudio';

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
/** preview(): its flight out and the fill (it stays up until close()), and the flight home. */
const PREVIEW = { out: 0.35, fill: 1.2, back: 0.35 };
/** The % under the picture: how far it rides up over the picture's bottom edge, its pill's size and its font size. */
const BADGE_OVERLAP = 8;
const BADGE_WIDTH = 72;
/** The % pill's padding either side of its text (it grows with the text past BADGE_WIDTH). */
const BADGE_PAD = 8;
const BADGE_HEIGHT = 28;
const BADGE_STAR = 32;
const BADGE_FONT = 20;
/** The name's ribbon over the blown-up picture: its sprite's scale and the widest its name gets (screen pixels). */
const RIBBON_SCALE = 0.5;
const RIBBON_TEXT_WIDTH = 380;
/** The close button's place on the blown-up picture (its top-right corner, pulled in this much, screen pixels). */
const CLOSE_INSET = 12;
/** Blown up (celebrate(), preview()), the % grows this much, not as much as the picture (it'd be huge and soft). */
const BADGE_BLOWN_UP = 2;
/** The line on the veil's edge: its width (share of the picture's height) and colour. */
const EDGE_LINE = 0.008;
const EDGE_COLOR = 0xfff3b0;
/** sweep()'s band of light: its width (share of the picture's) and slant (radians). */
const SWEEP_WIDTH = 0.22;
const SWEEP_SLANT = 0.35;
/** The stars popping out of the % once filled: how many, and how far they fly (screen pixels). */
const BADGE_STARS = 5;
const BADGE_STAR_FLIGHT = 70;

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
 * A miniature under its veil: the bright picture, the dark one over it (masked to above the fill line), a glow band
 * just under the line and a bright line on it (kept to the town's shape). `share` 0..1 is how far up from the bottom
 * it's bright. sweep(): a band of light across it.
 */
class VeiledPicture extends PIXI.Container {
    public share = 0;
    private readonly veilMask = new PIXI.Graphics();
    private readonly glowMask = new PIXI.Graphics();
    private readonly glow: PIXI.Sprite;
    private readonly sprites: PIXI.Sprite[];
    /** Light drawn over the picture (the edge's line, sweep()), masked to its silhouette so it never shows on nothing. */
    private readonly light = new PIXI.Container();
    private readonly edgeLine = new PIXI.Graphics();
    private time = Math.random() * 10;

    public constructor(public texture: PIXI.Texture, public readonly pictureWidth: number) {
        super();
        const bright = new PIXI.Sprite(texture);
        const dark = new PIXI.Sprite(texture);
        this.glow = new PIXI.Sprite(texture);
        const silhouette = new PIXI.Sprite(texture);
        this.sprites = [bright, dark, this.glow, silhouette];
        for (const sprite of this.sprites) sprite.anchor.set(0.5);
        this.setTexture(texture);
        dark.tint = VEIL_TINT;
        dark.mask = this.veilMask;
        this.glow.blendMode = PIXI.BLEND_MODES.ADD;
        this.glow.alpha = GLOW_ALPHA;
        this.glow.mask = this.glowMask;
        this.light.mask = silhouette;
        this.light.addChild(this.edgeLine);
        this.addChild(bright, dark, this.glow, this.veilMask, this.glowMask, silhouette, this.light);
        this.draw(0);
    }

    /** A slanted band of light sweeping across the picture, left to right, over `duration` seconds. */
    public sweep(duration = 0.6): void {
        const w = this.pictureWidth;
        const h = this.pictureHeight;
        const band = new PIXI.Graphics();
        const width = w * SWEEP_WIDTH;
        // Soft edges: a few stacked strips, brighter in the middle.
        for (let i = 0; i < 4; i++) {
            const k = 1 - i / 4;
            band.beginFill(0xffffff, 0.16).drawRect((-width / 2) * k, -h, width * k, h * 2).endFill();
        }
        band.rotation = SWEEP_SLANT;
        band.blendMode = PIXI.BLEND_MODES.ADD;
        band.x = -w * 0.8;
        this.light.addChild(band);
        gsap.to(band, { x: w * 0.8, duration, ease: 'sine.inOut', onComplete: () => band.destroy() });
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
        const line = this.edgeLine.clear();
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
        // The line on the edge: a soft wide stroke, then a thin bright one.
        for (const [width, alpha] of [[h * EDGE_LINE * 3, 0.25], [h * EDGE_LINE, 0.95]] as const) {
            line.lineStyle(Math.max(1, width), EDGE_COLOR, alpha).moveTo(edge[0], edge[1]);
            for (let i = 2; i < edge.length; i += 2) line.lineTo(edge[i], edge[i + 1]);
        }
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
    private readonly badgePill = new PIXI.Graphics();
    private readonly badgeStar = PIXI.Sprite.from('ItemIcon_Star_Gold');
    private readonly badgeText = UiKit.text('hud', 'toast', { text: '' }, { fontSize: BADGE_FONT, strokeThickness: 5 });
    private target = 0;
    private percentShown = -1;
    /** The % in the corner, easing to `target` (the picture there is always whole; only the reveal shows the veil). */
    private shown = 0;
    /** The corner's picture and the big one (shown while it's blown up in celebrate()). */
    private small?: PIXI.Texture;
    private big?: PIXI.Texture;
    /** While it's blown up, the veil and the % wait for its own fill (not the eased one). */
    private held = false;
    private readonly tick = () => this.update(gsap.ticker.deltaRatio() / 60);

    /** `title`: the name on the ribbon over the blown-up picture (asked each time: the language can change). */
    public constructor(private readonly pictureWidth: number, private readonly title: () => string) {
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
        this.picture.share = 1;
        this.shown = this.target;
        // The % centred under the picture, a star at its left end (the pill sized to the text: sizeBadge()).
        this.badgeStar.anchor.set(0.5);
        this.badgeStar.scale.set(BADGE_STAR / Math.max(this.badgeStar.texture.width, this.badgeStar.texture.height, 1));
        this.badgeStar.rotation = -0.2;
        this.badgeText.anchor.set(0.5);
        this.badge.addChild(this.badgePill, this.badgeText, this.badgeStar);
        this.sizeBadge();
        this.badge.position.set(0, this.picture.pictureHeight / 2 + BADGE_HEIGHT / 2 - BADGE_OVERLAP);
        this.addChild(this.picture, this.badge);
        this.visible = true;
        gsap.ticker.add(this.tick);
    }

    /** Up in the middle (celebrate(), or preview() until it's closed): the HUD's layout leaves it be. */
    public get celebrating(): boolean {
        return this.held;
    }

    /** preview()'s big view is up, waiting for close(). */
    public get open(): boolean {
        return this.goHome !== undefined;
    }

    /** Height of the picture (0 until it's loaded), for the HUD's layout. */
    public get pictureHeight(): number {
        return this.picture?.pictureHeight ?? 0;
    }

    /** How far the % reaches below the picture, for the HUD's layout. */
    public get badgeHeight(): number {
        return BADGE_HEIGHT - BADGE_OVERLAP;
    }

    /** The whole town's restored share (0..1), every frame; the veil eases to it. */
    public setShare(share: number): void {
        this.target = Math.max(0, Math.min(1, share));
    }

    /** The corner's % stays where it is (not easing to a new share) until celebrate() fills it up. */
    public holdShare(): void {
        this.shareHeld = true;
    }

    private shareHeld = false;

    /**
     * A section restored: flies from its corner to `centre` (in its parent) at `scale`, with rays; the veil drains to
     * the town's new share (a bright line on its edge, the % counting up); a sweep of light, a flash, stars out of the %;
     * then back to `home()`.
     * `onDone` as it lands. Takes REVEAL_SEC.
     */
    public celebrate(centre: PIXI.IPointData, scale: number, home: () => PIXI.IPointData, onDone: () => void): void {
        if (this.goHome) this.goHome(true);
        this.shareHeld = false;
        this.reveal(centre, scale, home, onDone);
    }

    /**
     * A closer look (a tap on it): the same flight to `centre` at `scale`, the veil filling from empty up to the town's
     * share (a bright line on its edge, the % counting up), and it stays up, `closeButton` (the HUD's, tappable) on its
     * corner, until close(). Not while it's already up.
     */
    public preview(centre: PIXI.IPointData, scale: number, home: () => PIXI.IPointData, closeButton: PIXI.Container): void {
        // Not while a celebration's waiting either (it'd catch the % up before the fill).
        if (this.held || this.shareHeld) return;
        this.reveal(centre, scale, home, () => {}, closeButton);
    }

    /** preview()'s view back to its corner. */
    public close(): void {
        this.goHome?.(false);
    }

    /** Takes it home (`now`: at once, no flight); set while it's up. */
    private goHome?: (now: boolean) => void;

    /** celebrate() (no `closeButton`: the flash and stars once filled, then home) and preview(). */
    private reveal(centre: PIXI.IPointData, scale: number, home: () => PIXI.IPointData, onDone: () => void, closeButton?: PIXI.Container): void {
        const picture = this.picture;
        if (!picture) return;
        const festive = !closeButton;
        const beats = festive ? REVEAL : PREVIEW;
        UiAnim.kill(this);
        // Over everything else in the HUD while it's up.
        const parent = this.parent;
        const index = parent?.getChildIndex(this) ?? 0;
        parent?.addChild(this);
        this.held = true;
        // Blown up: the big picture (the corner's own would turn soft), under its veil: from the share it had (a
        // celebration: the fill goes on from there) or from empty (a preview: how far the town has come).
        if (this.big) picture.setTexture(this.big);
        picture.share = festive ? this.shown : 0;
        const width = this.pictureWidth;
        const height = picture.pictureHeight;
        // The name on a ribbon over it, its size on screen kept whatever the picture's scale.
        const ribbon = new PIXI.Container();
        const ribbonArt = UiKit.sprite('upgrades', 'ribbon', RIBBON_SCALE);
        const name = UiKit.text('upgrades', 'title', {}, { fontSize: 34 });
        name.anchor.set(0.5);
        name.text = this.title();
        UiKit.fit(name, RIBBON_TEXT_WIDTH);
        name.y = -4;
        ribbon.addChild(ribbonArt, name);
        ribbon.y = -height / 2 - (ribbonArt.height * 0.35) / scale;
        ribbon.scale.set(0.6 / scale);
        ribbon.alpha = 0;
        this.addChild(ribbon);
        // The close button on the picture's top-right corner, its size on screen kept too.
        if (closeButton) {
            closeButton.scale.set(1 / scale);
            closeButton.position.set(width / 2 - CLOSE_INSET / scale, -height / 2 + CLOSE_INSET / scale);
            closeButton.alpha = 0;
            this.addChild(closeButton);
        }
        const shine = UiAnim.rays(this, width * 0.75, 0xfff0a0, 0.6, 8);
        this.setChildIndex(shine.rays, 0);
        shine.rays.alpha = 0;
        // The % grows less than the picture (fitBadge(), each frame while it's up).
        this.blownUp = scale;

        const finish = () => {
            shine.tweens.forEach((tween) => tween.kill());
            if (!shine.rays.destroyed) shine.rays.destroy({ children: true });
            if (!ribbon.destroyed) ribbon.destroy({ children: true });
            closeButton?.removeFromParent();
            if (this.destroyed) return;
            this.held = false;
            // Home: whole again (the % alone tells the progress there).
            picture.share = 1;
            this.shown = this.target;
            this.scale.set(1);
            this.fitBadge();
            if (this.small) picture.setTexture(this.small);
            const to = home();
            this.position.set(to.x, to.y);
            if (parent && !parent.destroyed) parent.addChildAt(this, Math.min(index, parent.children.length - 1));
            UiAnim.punch(this, 0.15);
            onDone();
        };
        this.goHome = (now) => {
            this.goHome = undefined;
            out.kill();
            if (now) {
                finish();
                return;
            }
            MowAudio.play('whoosh');
            gsap.timeline({ onComplete: finish })
                .to([shine.rays, ribbon, ...(closeButton ? [closeButton] : [])], { alpha: 0, duration: 0.15 }, 0)
                .to(this, { x: () => home().x, y: () => home().y, duration: beats.back, ease: 'power2.in' }, 0)
                .to(this.scale, { x: 1, y: 1, duration: beats.back, ease: 'power2.in' }, 0);
        };

        const flashAt = beats.out + beats.fill;
        MowAudio.play('whoosh');
        const out = gsap.timeline()
            .to(this, { x: centre.x, y: centre.y, duration: beats.out, ease: 'power2.out' }, 0)
            .to(this.scale, { x: scale, y: scale, duration: beats.out, ease: 'back.out(1.6)' }, 0)
            .to(shine.rays, { alpha: 1, duration: 0.3 }, beats.out * 0.5)
            .to(ribbon, { alpha: 1, duration: 0.2 }, beats.out * 0.6)
            .to(ribbon.scale, { x: 1 / scale, y: 1 / scale, duration: 0.35, ease: 'back.out(2)' }, beats.out * 0.6)
            // The fill: a shimmer as the bright line climbs.
            .call(() => MowAudio.play('buyShine'), undefined, beats.out)
            .to(picture, { share: () => this.target, duration: beats.fill, ease: 'sine.inOut' }, beats.out)
            .call(() => {
                if (this.destroyed) return;
                // Filled: a band of light across it and the % popping, stars flying out of it.
                picture.sweep();
                this.punchBadge(festive ? 0.6 : 0.4);
                if (!festive) {
                    MowAudio.play('sparkle');
                    return;
                }
                MowAudio.play('buyStar');
                MowAudio.play('sparkle');
                // A soft flash: the picture once more, added on top and fading.
                const flash = new PIXI.Sprite(picture.texture);
                flash.anchor.set(0.5);
                flash.scale.set(width / picture.texture.width);
                flash.blendMode = PIXI.BLEND_MODES.ADD;
                flash.alpha = 0.6;
                this.addChild(flash);
                gsap.to(flash, { alpha: 0, duration: 0.45, onComplete: () => flash.destroy() });
                this.popStars();
            }, undefined, flashAt);
        if (closeButton) out.to(closeButton, { alpha: 1, duration: 0.2 }, beats.out);
        // A celebration goes home by itself after its hold; a preview waits for close().
        if (festive) out.call(() => this.goHome?.(false), undefined, flashAt + REVEAL.hold);
    }

    /** The scale it's blown up to (reveal()), for fitBadge(). */
    private blownUp = 1;

    /**
     * The % at its size for how far it's blown up: its own size in the corner, BADGE_BLOWN_UP times that (on screen)
     * fully blown up, smoothly between (scaled down inside this one), and on the picture's bottom edge.
     */
    private fitBadge(): void {
        const now = this.scale.x;
        const through = this.blownUp > 1 ? Math.max(0, Math.min(1, (now - 1) / (this.blownUp - 1))) : 0;
        const onScreen = 1 + (Math.min(BADGE_BLOWN_UP, this.blownUp) - 1) * through;
        if (!this.badgePunch?.isActive()) this.badge.scale.set(onScreen / now);
        this.badge.y = this.pictureHeight / 2 + (BADGE_HEIGHT / 2 - BADGE_OVERLAP) * (onScreen / now);
    }

    /** The % popping (its scale left to the pop meanwhile, not fitBadge()). */
    private punchBadge(amount: number): void {
        [this.badgePunch] = UiAnim.punch(this.badge, amount);
    }

    private badgePunch?: UiTween;

    /** Stars flying up and out of the % (in the parent: the screen's size, whatever this one's scale). */
    private popStars(): void {
        const parent = this.parent;
        if (!parent) return;
        const from = parent.toLocal(this.badge.getGlobalPosition());
        for (let i = 0; i < BADGE_STARS; i++) {
            const star = PIXI.Sprite.from('ItemIcon_Star_Gold');
            star.anchor.set(0.5);
            star.scale.set(BADGE_STAR / Math.max(star.texture.width, star.texture.height, 1));
            star.position.copyFrom(from);
            star.eventMode = 'none';
            parent.addChild(star);
            // Fanned out above the pill, each its own way.
            const angle = -Math.PI / 2 + ((i / (BADGE_STARS - 1)) - 0.5) * 2.2;
            const distance = BADGE_STAR_FLIGHT * (0.8 + Math.random() * 0.4);
            const scale = star.scale.x;
            star.scale.set(0);
            gsap.timeline({ onComplete: () => star.destroy() })
                .to(star.scale, { x: scale, y: scale, duration: 0.25, ease: 'back.out(3)' }, 0)
                .to(star, { x: from.x + Math.cos(angle) * distance, y: from.y + Math.sin(angle) * distance, rotation: (Math.random() - 0.5) * 2, duration: 0.6, ease: 'power2.out' }, 0)
                .to(star, { alpha: 0, duration: 0.3 }, 0.45);
        }
    }

    private update(delta: number): void {
        const picture = this.picture;
        if (this.destroyed || !picture) return;
        // In the corner the picture stays whole and the % eases to the town's; blown up, the % follows the veil.
        if (!this.held && !this.shareHeld) {
            this.shown += (this.target - this.shown) * Math.min(1, delta * EASE_RATE);
            if (Math.abs(this.target - this.shown) < 0.001) this.shown = this.target;
        }
        if (this.held) this.fitBadge();
        picture.draw(delta);
        const percent = Math.floor((this.held ? picture.share : this.shown) * 100 + 0.001);
        if (percent !== this.percentShown) {
            this.percentShown = percent;
            this.badgeText.text = `${percent}%`;
            this.sizeBadge();
        }
    }

    /**
     * The % pill round its text: at least BADGE_WIDTH, wider for a longer % ("100%"), the star on its left end and the
     * text in the room right of it.
     */
    private sizeBadge(): void {
        const starRoom = BADGE_STAR * 0.45;
        const width = Math.max(BADGE_WIDTH, starRoom + this.badgeText.width + BADGE_PAD * 2);
        const left = -width / 2;
        this.badgePill.clear().lineStyle(3, 0xffffff, 0.95).beginFill(0x2a2350, 0.92)
            .drawRoundedRect(left, -BADGE_HEIGHT / 2, width, BADGE_HEIGHT, BADGE_HEIGHT / 2).endFill();
        this.badgeStar.position.set(left + 4, -2);
        this.badgeText.x = (left + starRoom + width / 2) / 2;
    }

    public override destroy(): void {
        gsap.ticker.remove(this.tick);
        UiAnim.kill(this);
        super.destroy({ children: true });
    }
}
