import { BevelFilter } from "@pixi/filter-bevel";
import { GlowFilter } from "@pixi/filter-glow";
import * as PIXI from "pixi.js";

export class FXApplier {
    private constructor() {
        // static only
    }

    public static applyFiltersAndFlatten(
        renderer: PIXI.Renderer,
        target: PIXI.Container,
        options?: {
            resolution?: number;
            padding?: number;
            clearColor?: number;
            /**
             * If true, the returned sprite is positioned so that it visually matches target's local bounds origin.
             * Default true.
             */
            matchLocalBoundsPosition?: boolean;
        }
    ): PIXI.Sprite {
        const resolution = options?.resolution ?? renderer.resolution;
        const matchPos = options?.matchLocalBoundsPosition ?? true;

        // 1) Create FX (hardcoded)
        // You can hardcode more filters here (ColorMatrix, Blur, Outline, etc.)
        const filters: PIXI.Filter[] = [

            // new GlowFilter({
            //     color: 0x111111,
            //     distance: 15,
            //     outerStrength: 0,
            //     innerStrength: 1.5,
            //     quality: 0.25,
            //     knockout: false
            // }),
            new GlowFilter({
                color: 0xffffff,
                distance: 20,
                outerStrength: 0,
                innerStrength: 0.85,
                quality: 0.3,
                knockout: false
            }),
            new BevelFilter({
                thickness: 3,
                lightAlpha: 0.5,
                shadowAlpha: 0.7
            })
        ];

        // 2) Apply filters temporarily
        const prevFilters = target.filters;
        target.filters = filters;

        // 3) Compute bounds and allocate RenderTexture
        // Note: bounds can expand with filters; many filters expose `padding`, but it is not universal.
        const bounds = target.getLocalBounds();

        const inferredPadding = FXApplier.inferMaxFilterPadding(filters);
        const padding = options?.padding ?? inferredPadding ?? 0;

        const x = Math.floor(bounds.x - padding);
        const y = Math.floor(bounds.y - padding);
        const w = Math.ceil(bounds.width + padding * 2);
        const h = Math.ceil(bounds.height + padding * 2);

        const rt = PIXI.RenderTexture.create({
            width: Math.max(1, w),
            height: Math.max(1, h),
            resolution
        });

        // 4) Render target into RT with translation so (x,y) maps to (0,0)
        const m = new PIXI.Matrix();
        m.translate(-x, -y);

        renderer.render(target, {
            renderTexture: rt,
            clear: true,
            transform: m
        });

        // 5) Restore previous filters and destroy created filters
        target.filters = prevFilters ?? null;

        for (const f of filters) {
            // pixi-filters / @pixi/filter-* typically implement destroy()
            (f as any).destroy?.();
        }

        // 6) Return a flat sprite
        const flat = new PIXI.Sprite(rt);

        // By default, position it so it matches the local-bounds placement of the source
        // (so if bounds.x/bounds.y were negative, the sprite will be offset correctly).
        if (matchPos) {
            flat.position.set(x, y);
        }

        // Important: caller owns rt. When done, call:
        // flat.texture.destroy(true);
        // flat.destroy({ texture: false, baseTexture: false });
        return flat;
    }

    private static inferMaxFilterPadding(filters: PIXI.Filter[]): number | undefined {
        let max = 0;

        for (const f of filters) {
            const p = (f as any).padding;
            if (typeof p === "number" && Number.isFinite(p)) {
                max = Math.max(max, p);
            }
        }

        return max > 0 ? max : undefined;
    }
}
