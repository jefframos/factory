import * as PIXI from 'pixi.js';
import { FrameName, FrameRegistry } from './FrameRegistry';

export default class FrameComponent extends PIXI.Container {
    private readonly plane: PIXI.NineSlicePlane;

    private arrow?: PIXI.Sprite;
    private arrowPivot?: { x: number; y: number };

    public constructor(frame: FrameName, width: number, height: number) {
        super();

        const def = FrameRegistry[frame];

        // Undefined textureKey (see FrameDef's own doc) means this frame draws no visible
        // panel at all — PIXI.Texture.EMPTY is a valid 0x0 texture NineSlicePlane accepts
        // fine, it just renders nothing, while still sizing/positioning like any other frame.
        const texture = def.textureKey ? PIXI.Texture.from(def.textureKey) : PIXI.Texture.EMPTY;
        this.plane = new PIXI.NineSlicePlane(
            texture,
            def.padding.left,
            def.padding.top,
            def.padding.right,
            def.padding.bottom
        );
        this.addChild(this.plane);

        if (def.arrowTexture) {
            this.arrow = PIXI.Sprite.from(def.arrowTexture);
            this.arrow.anchor.set(0.5, 0.5); // arrow size never changes
            this.arrowPivot = def.arrowPivot ?? { x: 0.5, y: 1 };
            this.addChild(this.arrow);
        }

        this.setSize(width, height);
    }

    public setSize(width: number, height: number): void {
        this.plane.width = width;
        this.plane.height = height;

        if (this.arrow && this.arrowPivot) {
            this.arrow.position.set(
                width * this.arrowPivot.x,
                height * this.arrowPivot.y
            );
        }
    }

    /** Tints the 9-sliced plane itself — NOT a Container-level property (Container has no visual tint of its own; PIXI.Container.alpha still works untouched via this.alpha, propagating to children including the plane). For a translucent solid-color backdrop rather than the frame texture's own colors — see MovementTutorialOverlay's prompt background for the first caller. */
    public setTint(tint: number): void {
        this.plane.tint = tint;
    }
}