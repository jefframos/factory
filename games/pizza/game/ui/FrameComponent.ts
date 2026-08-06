// FrameComponent.ts
//
// Turns one FrameRegistry entry into an actually-sized 9-sliced panel — the
// easy building block for "give me a background panel" anywhere in the UI:
//
//   const panel = new FrameComponent('Main', 240, 80);
//   container.addChild(panel);
//   panel.setSize(300, 100); // resize later, e.g. content changed
//
// A plain PIXI.Container wrapping one PIXI.NineSlicePlane — not a
// Component (see ../ecs/Component.ts), since this is pure Pixi/UI, not
// something that lives on a World entity. Swapping which frame a piece of
// UI uses is a one-word change (the FrameName passed in); resizing never
// needs new geometry since NineSlicePlane only stretches its middle.

import * as PIXI from 'pixi.js';
import { FrameName, FrameRegistry } from './FrameRegistry';

export default class FrameComponent extends PIXI.Container {
    private readonly plane: PIXI.NineSlicePlane;

    public constructor(frame: FrameName, width: number, height: number) {
        super();

        const def = FrameRegistry[frame];
        const texture = PIXI.Texture.from(def.textureKey);
        this.plane = new PIXI.NineSlicePlane(texture, def.padding.left, def.padding.top, def.padding.right, def.padding.bottom);
        this.addChild(this.plane);

        this.setSize(width, height);
    }

    public setSize(width: number, height: number): void {
        this.plane.width = width;
        this.plane.height = height;
    }
}
