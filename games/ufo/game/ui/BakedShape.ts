// BakedShape.ts
//
// Discs and rounded rects for the UI, smooth: PIXI.Graphics draws without anti-aliasing here, so a shape is drawn once
// on a canvas (BAKE times bigger, with mipmaps) and kept by its size and colours; the same shape again reuses the
// texture. Anything that changes every frame (bars, wipes, masks) stays a Graphics.

import * as PIXI from 'pixi.js';

/** The canvas is this many times the shape's size, so it stays crisp on a hi-dpi screen or scaled up. */
const BAKE = 3;
/** Clear pixels round the shape (screen pixels), so its edge isn't cut by the texture's. */
const PAD = 1;

export interface ShapeLook {
    fill: number;
    fillAlpha?: number;
    /** A line on the shape's edge (half in, half out, like Graphics.lineStyle()). */
    rim?: number;
    rimWidth?: number;
    rimAlpha?: number;
}

const textures = new Map<string, PIXI.Texture>();

const css = (color: number, alpha = 1): string => `rgba(${(color >> 16) & 255},${(color >> 8) & 255},${color & 255},${alpha})`;

function bake(width: number, height: number, radius: number, look: ShapeLook): PIXI.Texture {
    const rimWidth = look.rim === undefined ? 0 : look.rimWidth ?? 2;
    const key = [width, height, radius, look.fill, look.fillAlpha ?? 1, look.rim ?? '', rimWidth, look.rimAlpha ?? 1].join('|');
    const cached = textures.get(key);
    if (cached) return cached;
    const margin = rimWidth / 2 + PAD;
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil((width + margin * 2) * BAKE);
    canvas.height = Math.ceil((height + margin * 2) * BAKE);
    const g = canvas.getContext('2d')!;
    g.scale(BAKE, BAKE);
    g.beginPath();
    g.roundRect(margin, margin, width, height, Math.min(radius, width / 2, height / 2));
    g.fillStyle = css(look.fill, look.fillAlpha);
    g.fill();
    if (rimWidth > 0) {
        g.lineWidth = rimWidth;
        g.strokeStyle = css(look.rim!, look.rimAlpha);
        g.stroke();
    }
    const texture = PIXI.Texture.from(canvas, { mipmap: PIXI.MIPMAP_MODES.ON, scaleMode: PIXI.SCALE_MODES.LINEAR });
    textures.set(key, texture);
    return texture;
}

/** A shape centred on its origin; a holder round the sprite, so it can be scaled and tweened like any other. */
export class BakedShape extends PIXI.Container {
    private readonly sprite = new PIXI.Sprite();

    public constructor(private readonly shapeWidth: number, private readonly shapeHeight: number, private readonly radius: number, look: ShapeLook) {
        super();
        this.sprite.anchor.set(0.5);
        this.sprite.scale.set(1 / BAKE);
        this.addChild(this.sprite);
        this.setLook(look);
    }

    public static disc(radius: number, look: ShapeLook): BakedShape {
        return new BakedShape(radius * 2, radius * 2, radius, look);
    }

    /** Other colours, same shape. */
    public setLook(look: ShapeLook): void {
        this.sprite.texture = bake(this.shapeWidth, this.shapeHeight, this.radius, look);
    }
}
