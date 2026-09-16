import * as PIXI from 'pixi.js';
import { FrameName, FrameRegistry } from './FrameRegistry';

export default class FrameComponent extends PIXI.Container {
    private readonly plane: PIXI.NineSlicePlane;
    /** See FrameDef.scaleAdjust's own doc — applied in setSize(). 1 (the default) is a no-op. */
    private readonly scaleAdjust: number;

    private arrow?: PIXI.Sprite;
    private arrowPivot?: { x: number; y: number };
    /** See FrameDef.arrowOffset's own doc — applied on top of arrowPivot in setSize(). {0,0} (the default) is a no-op. */
    private arrowOffset!: { x: number; y: number };

    public constructor(frame: FrameName, width: number, height: number) {
        super();

        const def = FrameRegistry[frame];
        this.scaleAdjust = def.scaleAdjust ?? 1;

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
            // Top-center, not center — arrowPivot's y:1 default places this at the frame's own
            // bottom edge, and a tail/tip asset is meant to hang DOWN from that edge (its own
            // top row cropped flush against wherever the body texture's bottom border ends), not
            // straddle it. A center anchor here would leave half the sprite floating back up
            // into the body instead of pinned at the seam.
            this.arrow.anchor.set(0.5, 0);
            this.arrowPivot = def.arrowPivot ?? { x: 0.5, y: 1 };
            this.arrowOffset = def.arrowOffset ?? { x: 0, y: 0 };
            this.addChild(this.arrow);
        }

        this.setSize(width, height);
    }

    public setSize(width: number, height: number): void {
        // Plane is sized (and its own border widths measured) at `scaleAdjust`x, then scaled
        // back down by the inverse so the FINAL apparent size still matches `width`/`height` —
        // see FrameDef.scaleAdjust's own doc for why. Only the plane is scaled, not `this` —
        // the arrow below is positioned against the real, unadjusted width/height and must stay
        // at its own natural size regardless of this frame's scaleAdjust.
        this.plane.width = width * this.scaleAdjust;
        this.plane.height = height * this.scaleAdjust;
        this.plane.scale.set(1 / this.scaleAdjust);

        if (this.arrow && this.arrowPivot) {
            // Same 1/scaleAdjust shrink as the plane above — the arrow texture is cropped from
            // the same source art at the same native pixel density, so it needs to be "zoomed
            // out" by the same factor to keep looking like one continuous piece of art with the
            // (now visually thinner-bordered) body, instead of rendering oversized next to it.
            // Position still uses the real, unadjusted width/height — only the arrow's own
            // rendered size follows scaleAdjust, not where it's placed.
            this.arrow.scale.set(1 / this.scaleAdjust);
            this.arrow.position.set(
                width * this.arrowPivot.x + this.arrowOffset.x,
                height * this.arrowPivot.y + this.arrowOffset.y
            );
        }
    }

    /** Swaps the 9-sliced plane's own texture in place, keeping this frame's border widths (padding) as originally constructed — for a caller that wants to switch between textures from the SAME asset family (e.g. FrameRegistry's various ResourceBar_Single_Btn_* bubble presets, all baked with the same border) without recreating the frame. A texture with meaningfully different border proportions will look stretched/cropped since the 9-slice widths don't change. */
    public setTexture(textureKey: string): void {
        this.plane.texture = PIXI.Texture.from(textureKey);
    }

    /** Tints the 9-sliced plane itself — NOT a Container-level property (Container has no visual tint of its own; PIXI.Container.alpha still works untouched via this.alpha, propagating to children including the plane). For a translucent solid-color backdrop rather than the frame texture's own colors — see MovementTutorialOverlay's prompt background for the first caller. */
    public setTint(tint: number): void {
        this.plane.tint = tint;
    }
}