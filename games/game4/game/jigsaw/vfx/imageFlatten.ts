import * as PIXI from "pixi.js";

/**
 * Takes any display object (sprite/container), renders it to a new RenderTexture at the requested size,
 * and returns a Sprite using that resized texture.
 */
export function makeResizedSpriteTexture(
    renderer: PIXI.Renderer,
    source: PIXI.DisplayObject,
    width: number,
    height: number
): PIXI.Sprite {
    // Ensure source has a valid local bounds for scaling.
    const bounds = source.getLocalBounds();

    // If the source is a Sprite, it likely has bounds at (0,0,w,h). Containers may not.
    // We scale uniformly per-axis to exactly match target width/height.
    const sx = width > 0 ? width / Math.max(1e-6, bounds.width) : 1;
    const sy = height > 0 ? height / Math.max(1e-6, bounds.height) : 1;

    // Create a container so we can apply scaling and translate to origin cleanly.
    const c = new PIXI.Container();
    c.addChild(source);

    // Move content so its local bounds top-left is at 0,0 (important if bounds.x/y != 0).
    source.position.set(-bounds.x, -bounds.y);
    source.scale.set(sx, sy);

    if (width <= 0) {
        width = bounds.width
    }
    if (height <= 0) {
        height = bounds.height
    }

    // Create an RT with the target size (this is your "new texture").
    const rt = PIXI.RenderTexture.create({
        width,
        height,
        resolution: renderer.resolution,
    });

    // Render into the RT. clear=true to avoid junk pixels.
    renderer.render(c, {
        renderTexture: rt,
        clear: true,
    });

    // Detach the source from our temp container so you can still use it elsewhere if needed.
    c.removeChild(source);

    // New sprite from resized texture
    const out = new PIXI.Sprite(rt);

    // Optional: ensure 1:1 display with the RT (no extra scaling)
    out.width = width;
    out.height = height;

    return out;
}

export type CoverMaskBuilder = (w: number, h: number, radius: number) => PIXI.Graphics;

export function defaultRoundedRectMask(w: number, h: number, radius: number): PIXI.Graphics {
    const g = new PIXI.Graphics();
    g.beginFill(0xffffff, 1);
    g.drawRoundedRect(0, 0, w, h, radius);
    g.endFill();
    return g;
}

export function applyCoverFit(
    sprite: PIXI.Sprite,
    regionW: number,
    regionH: number
): void {
    // Ensure pivot is center
    sprite.anchor.set(0.5, 0.5);

    const tex = sprite.texture;
    const tw = tex.width;
    const th = tex.height;

    if (tw <= 0 || th <= 0) {
        sprite.width = regionW;
        sprite.height = regionH;
        sprite.x = regionW * 0.5;
        sprite.y = regionH * 0.5;
        return;
    }

    // "cover" fit: fill region, crop overflow
    const s = Math.max(regionW / tw, regionH / th);

    sprite.scale.set(s, s);
    sprite.x = regionW * 0.5;
    sprite.y = regionH * 0.5;
}
