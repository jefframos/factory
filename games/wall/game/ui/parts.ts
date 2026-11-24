// parts.ts
//
// What the HUD is made of: outlined text, nine-slice frames, sprites fitted in a size.

import * as PIXI from 'pixi.js';

const FONT = 'Baloo2-ExtraBold';

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
