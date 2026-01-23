import * as PIXI from "pixi.js";

export enum BakeDirection {
    VERTICAL,
    HORIZONTAL
}

export class TextureBaker {
    private static cache: Map<string, PIXI.Texture> = new Map();

    /**
     * Fetches a cached texture or bakes a new one based on level, colors, and stripe direction.
     */
    public static getTexture(
        level: number,
        baseKey: string,
        colors: string[],
        renderer: PIXI.Renderer,
        direction: BakeDirection = BakeDirection.VERTICAL
    ): PIXI.Texture {
        const cacheKey = `MergeAsset_Level_${level}_${direction === BakeDirection.VERTICAL ? 'V' : 'H'}`;

        // 1. Check Cache
        if (this.cache.has(cacheKey)) {
            return this.cache.get(cacheKey)!;
        }

        const baseTexture = PIXI.Texture.from(baseKey);
        const { width, height } = baseTexture;
        const container = new PIXI.Container();

        if (colors.length === 1) {
            // SINGLE COLOR TINT
            const sprite = new PIXI.Sprite(baseTexture);
            sprite.tint = PIXI.utils.string2hex(colors[0]);
            container.addChild(sprite);
        } else {
            // STRIPED TINTING
            const count = colors.length;

            colors.forEach((color, i) => {
                const slice = new PIXI.Sprite(baseTexture);
                slice.tint = PIXI.utils.string2hex(color);

                const mask = new PIXI.Graphics();
                mask.beginFill(0xffffff);

                if (direction === BakeDirection.VERTICAL) {
                    const sliceWidth = width / count;
                    mask.drawRect(i * sliceWidth, 0, sliceWidth, height);
                } else {
                    const sliceHeight = height / count;
                    mask.drawRect(0, i * sliceHeight, width, sliceHeight);
                }

                mask.endFill();
                slice.addChild(mask);
                slice.mask = mask;
                container.addChild(slice);
            });
        }

        // 4. Bake to RenderTexture
        const renderTexture = PIXI.RenderTexture.create({ width, height });
        renderer.render(container, { renderTexture });

        // Cleanup: Slices and masks aren't needed once the photo is taken
        container.destroy({ children: true });

        this.cache.set(cacheKey, renderTexture);
        return renderTexture;
    }

    /**
     * Useful for clearing memory if you change themes or world maps
     */
    public static clearCache(): void {
        this.cache.forEach(tex => tex.destroy(true));
        this.cache.clear();
    }
}