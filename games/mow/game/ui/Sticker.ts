// Sticker.ts
//
// A picture as a sticker: itself on a thick white outline, a soft shadow under it, nothing behind it (the HUD's buttons).
// Drawn once into one texture, so showing it costs a sprite.

import * as PIXI from 'pixi.js';
import { Game } from 'core/Game';

const COPIES = 24;
/** Drawn this many times its size, to stay crisp. */
const SHARP = 3;
const SHADOW = { color: 'rgba(10, 8, 14, 0.38)', down: 5 };

/** `picture` drawn `width` x `height`, outlined by `stroke`, its shadow `shadow` under it: a canvas with room round it. */
export function stickerCanvas(picture: CanvasImageSource, width: number, height: number, stroke: number, shadow: number): HTMLCanvasElement {
    const pad = Math.ceil(stroke + shadow + 2);
    const shape = document.createElement('canvas');
    shape.width = Math.ceil(width) + pad * 2;
    shape.height = Math.ceil(height) + pad * 2;
    const outline = shape.getContext('2d')!;
    for (let i = 0; i < COPIES; i++) {
        const a = (i / COPIES) * Math.PI * 2;
        outline.drawImage(picture, pad + Math.cos(a) * stroke, pad + Math.sin(a) * stroke, width, height);
    }
    outline.globalCompositeOperation = 'source-in';
    outline.fillStyle = '#ffffff';
    outline.fillRect(0, 0, shape.width, shape.height);
    const canvas = document.createElement('canvas');
    canvas.width = shape.width;
    canvas.height = shape.height;
    const context = canvas.getContext('2d')!;
    context.shadowColor = SHADOW.color;
    context.shadowOffsetY = shadow;
    context.drawImage(shape, 0, 0);
    context.shadowColor = 'transparent';
    context.drawImage(picture, pad, pad, width, height);
    return canvas;
}

const textures = new Map<string, PIXI.Texture>();

/** An atlas icon as a sticker, `size` across (its outline on top of that). */
export function iconSticker(frame: string, size: number, stroke = 6): PIXI.Sprite {
    const key = `${frame}|${size}|${stroke}`;
    let texture = textures.get(key);
    if (!texture) {
        const icon = PIXI.Sprite.from(frame);
        // (Without the atlas's trimmed edges: its size is the picture's own.)
        const picture = Game.renderer.extract.canvas(icon) as HTMLCanvasElement;
        const scale = (size * SHARP) / Math.max(picture.width, picture.height, 1);
        const canvas = stickerCanvas(picture, picture.width * scale, picture.height * scale, stroke * SHARP, SHADOW.down * SHARP);
        icon.destroy();
        texture = PIXI.Texture.from(canvas);
        textures.set(key, texture);
    }
    const sprite = new PIXI.Sprite(texture);
    sprite.anchor.set(0.5);
    sprite.scale.set(1 / SHARP);
    return sprite;
}
