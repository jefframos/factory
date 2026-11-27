// parts.ts
//
// What the HUD is made of: outlined text, nine-slice frames, sprites fitted in a size.

import * as PIXI from 'pixi.js';

const FONT = 'Baloo2-ExtraBold';
/** For numbers that have to read small (the phone's own, bold). */
const PLAIN = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';

export function text(value: string, size: number, fill: number, stroke = 0x17120e, thick = Math.max(4, size / 5)): PIXI.Text {
    const made = new PIXI.Text(value, new PIXI.TextStyle({ fontFamily: FONT, fontSize: size, fill, stroke, strokeThickness: thick, lineJoin: 'round' }));
    made.anchor.set(0.5);
    return made;
}

export function frame(name: string, borders: [number, number, number, number], width: number, height: number, scale = 1): PIXI.NineSlicePlane {
    const plane = new PIXI.NineSlicePlane(PIXI.Texture.from(name), ...borders);
    plane.scale.set(scale);
    plane.width = width / scale;
    plane.height = height / scale;
    plane.position.set(-width / 2, -height / 2);
    return plane;
}

export function sprite(name: string, size: number): PIXI.Sprite {
    const made = PIXI.Sprite.from(name);
    made.anchor.set(0.5);
    made.scale.set(size / Math.max(made.texture.width, made.texture.height, 1));
    return made;
}

/** Small figures in the device's own bold face, a thin outline: they read where the rounded face would blur. */
export function plainText(value: string, size: number, fill: number, stroke = 0x100e18, thick = 3): PIXI.Text {
    const made = new PIXI.Text(value, new PIXI.TextStyle({ fontFamily: PLAIN, fontWeight: '800', fontSize: size, fill, stroke, strokeThickness: thick, lineJoin: 'round' }));
    made.anchor.set(0.5);
    return made;
}

/** A label that's only as wide as `width`. */
export function fit(label: PIXI.Text, width: number): void {
    label.scale.set(1);
    label.scale.set(Math.min(1, width / Math.max(1, label.width)));
}

/** Sets it only when it's another (drawing text is dear), kept within `width`. */
export function write(label: PIXI.Text, value: string, width?: number): void {
    if (label.text === value) return;
    label.text = value;
    if (width) fit(label, width);
}

/** A red flag for a top edge. */
export function flag(words: PIXI.Text, width: number): PIXI.Container {
    const made = new PIXI.Container();
    made.addChild(frame('Label_Tail_Single_Red', [14, 20, 17, 18], width, 34, 0.68));
    words.y = -2;
    made.addChild(words);
    return made;
}

/** Rings drawn once (a 2D canvas is always smooth, where the WebGL canvas has no antialiasing), by look. */
const rings = new Map<string, PIXI.Texture>();
/** How much sharper than drawn a ring's texture is. */
const RING_RES = 2;

/**
 * A smooth ring, centred (a container at scale 1): `radius` to the middle of its line, `width` across, `color`; `edge`: a darker line under it (wider,
 * see-through), as PIXI.Graphics' would be, without the jagged edges.
 */
export function ringSprite(radius: number, width: number, color: number, edge?: { width: number; color: number; alpha?: number }): PIXI.Container {
    const key = `${radius}|${width}|${color}|${edge ? `${edge.width}|${edge.color}|${edge.alpha ?? 1}` : ''}`;
    let texture = rings.get(key);
    if (!texture) {
        const reach = radius + Math.max(width, edge?.width ?? 0) / 2 + 2;
        const side = Math.ceil(reach * 2 * RING_RES);
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = side;
        const context = canvas.getContext('2d')!;
        const line = (w: number, c: number, alpha: number) => {
            context.beginPath();
            context.arc(side / 2, side / 2, radius * RING_RES, 0, Math.PI * 2);
            context.lineWidth = w * RING_RES;
            context.strokeStyle = `#${c.toString(16).padStart(6, '0')}`;
            context.globalAlpha = alpha;
            context.stroke();
        };
        if (edge) line(edge.width, edge.color, edge.alpha ?? 1);
        line(width, color, 1);
        texture = PIXI.Texture.from(canvas);
        rings.set(key, texture);
    }
    const picture = new PIXI.Sprite(texture);
    picture.anchor.set(0.5);
    picture.scale.set(1 / RING_RES);
    // (In a container at scale 1, so it can be scaled and faded like any.)
    const made = new PIXI.Container();
    made.addChild(picture);
    return made;
}

/** A colour halfway (by `share`) to white. */
const lighter = (color: number, share: number): number => {
    const mix = (shift: number) => Math.round(((color >> shift) & 0xff) + (255 - ((color >> shift) & 0xff)) * share) << shift;
    return mix(16) | mix(8) | mix(0);
};

/**
 * A round button's face, to make it look special (the power-ups, HOLD): the pack's circle button (Button_Circle122, its black
 * edge and bevel) in a colour, a soft light inside, and the pack's shine across its top.
 */
export class RoundFace extends PIXI.Container {
    private readonly base: PIXI.Sprite;
    private readonly light: PIXI.Sprite;

    public constructor(size: number, color: number) {
        super();
        this.base = sprite('Button_Circle122', size);
        this.light = sprite('ItemFrame_BgGlow', size * 0.82);
        this.light.alpha = 0.55;
        const shine = sprite('BorderFrame_Circle75_Light', size * 0.6);
        shine.alpha = 0.4;
        shine.y = -size * 0.2;
        this.addChild(this.base, this.light, shine);
        this.setColor(color);
    }

    public setColor(color: number): void {
        this.base.tint = color;
        this.light.tint = lighter(color, 0.55);
    }
}
