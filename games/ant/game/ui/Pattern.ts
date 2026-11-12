// Pattern.ts
//
// The game's backdrops, as Mob's (games/mob/game/ui/Pattern.ts) in Ant's cozy colours: a gradient (`top` to `bottom`),
// over it a diamond grid (the floor's checker, softly shaded) drifting slowly, and a few big faint glows floating
// across. The shops and the popups use it.
//
// `Pattern` fills a rect (place()); it moves on its own every frame till it's destroyed. Its textures are drawn once
// (on canvases) and shared.

import * as PIXI from 'pixi.js';

export interface PatternLook {
    /** The gradient's colours, top and bottom. */
    top: number;
    bottom: number;
    /** The diamonds' size (px across one), how strong their shading is, and how fast they drift (px a second). */
    tile?: number;
    strength?: number;
    speed?: number;
    /** The faint glows over it (0: none), and their colour. */
    glows?: number;
    glow?: number;
}

const DEFAULTS = { tile: 92, strength: 0.09, speed: 10, glows: 3, glow: 0xffffff };

/** One diamond cell (a square, turned 45° when tiled): a soft light corner fading off, a faint edge. Drawn once. */
let cellTexture: PIXI.Texture | null = null;
function cell(): PIXI.Texture {
    if (cellTexture) return cellTexture;
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const c = canvas.getContext('2d')!;
    // A 2 x 2 checker of squares, each with its own soft shading (two kinds: the grid reads as diamonds).
    const half = size / 2;
    for (let row = 0; row < 2; row++) {
        for (let col = 0; col < 2; col++) {
            const x = col * half;
            const y = row * half;
            const light = (row + col) % 2 === 0;
            const shade = c.createLinearGradient(x, y, x + half, y + half);
            shade.addColorStop(0, `rgba(255,255,255,${light ? 1 : 0.55})`);
            shade.addColorStop(1, `rgba(255,255,255,${light ? 0.25 : 0})`);
            c.fillStyle = shade;
            c.fillRect(x, y, half, half);
            c.strokeStyle = 'rgba(255,255,255,0.5)';
            c.lineWidth = 2;
            c.strokeRect(x + 1, y + 1, half - 2, half - 2);
        }
    }
    cellTexture = PIXI.Texture.from(canvas);
    cellTexture.baseTexture.wrapMode = PIXI.WRAP_MODES.REPEAT;
    return cellTexture;
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
    private readonly grid = new PIXI.TilingSprite(cell(), 1, 1);
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
        this.grid.tileTransform.rotation = Math.PI / 4;
        this.grid.tileScale.set((this.look.tile * 2) / 128 / Math.SQRT2);
        this.addChild(this.base, this.fade, this.grid);
        PIXI.Ticker.shared.add(this.tick);
        for (let i = 0; i < this.look.glows; i++) {
            const sprite = new PIXI.Sprite(glow());
            sprite.anchor.set(0.5);
            sprite.tint = this.look.glow;
            sprite.alpha = 0.1;
            sprite.blendMode = PIXI.BLEND_MODES.ADD;
            this.glows.push({ sprite, phase: i * 2.1 + Math.random(), speed: 0.05 + Math.random() * 0.05 });
            this.addChild(sprite);
        }
    }

    private readonly tick = (): void => this.update(Math.min(0.1, PIXI.Ticker.shared.deltaMS / 1000));

    public override destroy(options?: boolean | PIXI.IDestroyOptions): void {
        PIXI.Ticker.shared.remove(this.tick);
        super.destroy(options);
    }

    /** Fills `x, y, width, height` (its parent's units). */
    public place(x: number, y: number, width: number, height: number): void {
        this.rect = new PIXI.Rectangle(x, y, width, height);
        for (const sprite of [this.base, this.fade]) {
            sprite.position.set(x, y);
            sprite.width = width;
            sprite.height = height;
        }
        this.grid.position.set(x, y);
        this.grid.width = width;
        this.grid.height = height;
        this.update(0);
    }

    /** The diamonds drift; the glows float round. */
    public update(dt: number): void {
        // (A box redrawn: its old pattern's gone.)
        if (this.destroyed) return;
        this.time += dt;
        const drift = this.time * this.look.speed;
        this.grid.tilePosition.set(drift, drift * 0.5);
        const { x, y, width, height } = this.rect;
        const size = Math.max(width, height) * 0.9;
        this.glows.forEach((entry, i) => {
            const t = this.time * entry.speed + entry.phase;
            entry.sprite.width = entry.sprite.height = size * (0.7 + 0.2 * Math.sin(t * 1.3 + i));
            entry.sprite.position.set(x + width * (0.5 + 0.45 * Math.sin(t)), y + height * (0.5 + 0.45 * Math.cos(t * 0.8 + i)));
        });
    }
}

/** The shops' backs: cream to peach, the floor's checker faint over it. */
export const PANEL_LOOK: PatternLook = { top: 0xf8e9d2, bottom: 0xeccba0, strength: 0.12, tile: 96, glows: 2, glow: 0xfff6e6 };
/** The level-complete moment's screen: gold to orange, bright, big diamonds. */
export const CELEBRATE_LOOK: PatternLook = { top: 0xffd77e, bottom: 0xf39a52, strength: 0.16, tile: 120, glows: 3, glow: 0xfff3c0, speed: 16 };
/** A popup's inside: a little warmer. */
export const POPUP_LOOK: PatternLook = { top: 0xfbecd6, bottom: 0xf0c99a, strength: 0.13, tile: 80, glows: 2, glow: 0xfff6e6 };
