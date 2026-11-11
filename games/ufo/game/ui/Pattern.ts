// Pattern.ts
//
// The game's backdrops: UFO's own, a starfield (Mob's are a grid of diamonds; these say space). A gradient (`top` to
// `bottom`); over it a staggered grid of soft round dots drifting sideways; over that a sparser layer of four-pointed stars,
// slower (so they seem further off) and twinkling; and a few big faint glows floating across. The panels (the shops, the
// ranking, the avatars), the windows (matchmaking, the trophy road, a new arena) use it.
//
// `Pattern` fills a rect (place()). It moves on its own, every frame, till it's destroyed.

import * as PIXI from 'pixi.js';

export interface PatternLook {
    /** The gradient's colours, top and bottom. */
    top: number;
    bottom: number;
    /** The dot grid's spacing (px from one dot to the next), how strong it is, how fast it drifts (px a second). */
    tile?: number;
    strength?: number;
    speed?: number;
    /** The faint glows over it (0: none), and their colour. */
    glows?: number;
    glow?: number;
}

const DEFAULTS = { tile: 80, strength: 0.09, speed: 12, glows: 3, glow: 0xffffff };
/** The stars' layer: how much brighter than the dots, how much slower, how it twinkles (between, and how fast). */
const STARS = { strength: 2.2, slower: 0.45, twinkleLow: 0.45, speed: 1.6 };

/** One tile of the dots: a soft dot in the middle and a quarter of one at each corner (a staggered grid). Drawn once. */
let dotsTexture: PIXI.Texture | null = null;
function dots(): PIXI.Texture {
    if (dotsTexture) return dotsTexture;
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const c = canvas.getContext('2d')!;
    const dot = (x: number, y: number, r: number) => {
        const soft = c.createRadialGradient(x, y, 0, x, y, r);
        soft.addColorStop(0, 'rgba(255,255,255,1)');
        soft.addColorStop(0.55, 'rgba(255,255,255,0.7)');
        soft.addColorStop(1, 'rgba(255,255,255,0)');
        c.fillStyle = soft;
        c.beginPath();
        c.arc(x, y, r, 0, Math.PI * 2);
        c.fill();
    };
    dot(size / 2, size / 2, 13);
    for (const x of [0, size]) for (const y of [0, size]) dot(x, y, 9);
    dotsTexture = PIXI.Texture.from(canvas);
    dotsTexture.baseTexture.wrapMode = PIXI.WRAP_MODES.REPEAT;
    return dotsTexture;
}

/** One tile of the stars: two four-pointed sparkles, off the dots' grid. Drawn once. */
let starsTexture: PIXI.Texture | null = null;
function stars(): PIXI.Texture {
    if (starsTexture) return starsTexture;
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const c = canvas.getContext('2d')!;
    const sparkle = (x: number, y: number, r: number) => {
        c.fillStyle = 'rgba(255,255,255,1)';
        c.beginPath();
        // Four long points, pinched in between.
        for (let k = 0; k < 8; k++) {
            const angle = (k / 8) * Math.PI * 2 - Math.PI / 2;
            const reach = k % 2 === 0 ? r : r * 0.22;
            const px = x + Math.cos(angle) * reach;
            const py = y + Math.sin(angle) * reach;
            if (k === 0) c.moveTo(px, py);
            else c.lineTo(px, py);
        }
        c.closePath();
        c.fill();
    };
    sparkle(64, 176, 16);
    sparkle(190, 60, 11);
    sparkle(210, 214, 7);
    starsTexture = PIXI.Texture.from(canvas);
    starsTexture.baseTexture.wrapMode = PIXI.WRAP_MODES.REPEAT;
    return starsTexture;
}

/** A vertical white-to-clear ramp (tinted: the gradient's second colour over the first). */
let rampTexture: PIXI.Texture | null = null;
function ramp(): PIXI.Texture {
    if (rampTexture) return rampTexture;
    const canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 256;
    const c = canvas.getContext('2d')!;
    const fade = c.createLinearGradient(0, 0, 0, 256);
    fade.addColorStop(0, 'rgba(255,255,255,0)');
    fade.addColorStop(1, 'rgba(255,255,255,1)');
    c.fillStyle = fade;
    c.fillRect(0, 0, 4, 256);
    rampTexture = PIXI.Texture.from(canvas);
    return rampTexture;
}

/** A soft round glow. */
let glowTexture: PIXI.Texture | null = null;
function glow(): PIXI.Texture {
    if (glowTexture) return glowTexture;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const c = canvas.getContext('2d')!;
    const soft = c.createRadialGradient(64, 64, 0, 64, 64, 64);
    soft.addColorStop(0, 'rgba(255,255,255,1)');
    soft.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = soft;
    c.fillRect(0, 0, 128, 128);
    glowTexture = PIXI.Texture.from(canvas);
    return glowTexture;
}

export class Pattern extends PIXI.Container {
    private readonly base = new PIXI.Sprite(PIXI.Texture.WHITE);
    private readonly fade = new PIXI.Sprite(ramp());
    private readonly grid = new PIXI.TilingSprite(dots(), 1, 1);
    private readonly sparkles = new PIXI.TilingSprite(stars(), 1, 1);
    private readonly glows: { sprite: PIXI.Sprite; phase: number; speed: number }[] = [];
    private readonly look: Required<PatternLook>;
    private rect = new PIXI.Rectangle(0, 0, 1, 1);
    private time = Math.random() * 100;

    public constructor(look: PatternLook) {
        super();
        this.look = { ...DEFAULTS, ...look } as Required<PatternLook>;
        this.base.tint = this.look.top;
        this.fade.tint = this.look.bottom;
        this.grid.alpha = this.look.strength;
        this.grid.tileScale.set(this.look.tile / 128);
        this.sparkles.tileScale.set((this.look.tile * 2.4) / 256);
        this.addChild(this.base, this.fade, this.grid, this.sparkles);
        for (let i = 0; i < this.look.glows; i++) {
            const sprite = new PIXI.Sprite(glow());
            sprite.anchor.set(0.5);
            sprite.tint = this.look.glow;
            sprite.alpha = 0.1;
            sprite.blendMode = PIXI.BLEND_MODES.ADD;
            this.glows.push({ sprite, phase: i * 2.1 + Math.random(), speed: 0.05 + Math.random() * 0.05 });
            this.addChild(sprite);
        }
        this.eventMode = 'none';
        PIXI.Ticker.shared.add(this.tick);
    }

    /** Fills `x, y, width, height` (its parent's units). */
    public place(x: number, y: number, width: number, height: number): void {
        this.rect = new PIXI.Rectangle(x, y, width, height);
        for (const sprite of [this.base, this.fade]) {
            sprite.position.set(x, y);
            sprite.width = width;
            sprite.height = height;
        }
        for (const layer of [this.grid, this.sparkles]) {
            layer.position.set(x, y);
            layer.width = width;
            layer.height = height;
        }
        this.step(0);
    }

    /** (It moves on its own: kept for those that still call it.) */
    public update(_dt: number): void {
        // Nothing: tick() moves it.
    }

    private readonly tick = (): void => this.step(PIXI.Ticker.shared.deltaMS / 1000);

    /** The dots drift sideways; the stars slower, twinkling; the glows float round. */
    private step(dt: number): void {
        if (this.destroyed) return;
        this.time += Math.min(dt, 0.1);
        const drift = this.time * this.look.speed;
        this.grid.tilePosition.set(drift, drift * 0.25);
        this.sparkles.tilePosition.set(drift * STARS.slower, drift * 0.1);
        const twinkle = STARS.twinkleLow + (1 - STARS.twinkleLow) * (0.5 + 0.5 * Math.sin(this.time * STARS.speed));
        this.sparkles.alpha = Math.min(1, this.look.strength * STARS.strength) * twinkle;
        const { x, y, width, height } = this.rect;
        const size = Math.max(width, height) * 0.9;
        this.glows.forEach((entry, i) => {
            const t = this.time * entry.speed + entry.phase;
            entry.sprite.width = entry.sprite.height = size * (0.7 + 0.2 * Math.sin(t * 1.3 + i));
            entry.sprite.position.set(x + width * (0.5 + 0.45 * Math.sin(t)), y + height * (0.5 + 0.45 * Math.cos(t * 0.8 + i)));
        });
    }

    public override destroy(options?: boolean | PIXI.IDestroyOptions): void {
        PIXI.Ticker.shared.remove(this.tick);
        super.destroy(options);
    }
}

/** The panels' blue (the shops, the ranking, the avatars, the windows). */
export const PANEL_LOOK: PatternLook = { top: 0x1d4fb8, bottom: 0x0f2a6e, strength: 0.08 };
/** The full-screen moments (a new arena): brighter. */
export const MOMENT_LOOK: PatternLook = { top: 0x3d7dff, bottom: 0x1f3fb0, strength: 0.1, tile: 96 };
/** A dark window's inside (matchmaking). */
export const WINDOW_LOOK: PatternLook = { top: 0x2a2f66, bottom: 0x151838, strength: 0.07, glows: 2 };
