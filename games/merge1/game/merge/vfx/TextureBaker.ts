import { Game } from "@core/Game";
import Pool from "@core/Pool";
import * as PIXI from "pixi.js";
import { StaticData } from "../data/StaticData";
import { BlockMergeEntity } from "../entity/BlockMergeEntity";

export enum BakeDirection {
    VERTICAL,
    HORIZONTAL
}

export class TextureBaker {
    private static cache: Map<string, PIXI.Texture> = new Map();

    public static getTexture(cacheKey: string): PIXI.Texture | undefined {
        if (this.cache.has(cacheKey)) {
            return this.cache.get(cacheKey)!;
        }
    }
    /**
     * Fetches a cached texture or bakes a new one based on level, colors, and stripe direction.
     */
    public static bakeEntityTextures() {
        for (let index = 1; index <= StaticData.entityCount; index++) {
            const entity = Pool.instance.getElement(BlockMergeEntity)
            entity.initView(index, '', '')
            // entity.spriteContainer.scale.set(1)
            // entity.spriteContainer?.pivot?.set(-entity.width / 2, -entity.height)

            console.log(entity.alpha, entity.visible)

            TextureBaker.bakeContainer('ENTITY_' + index, entity, Game.renderer)
            Pool.instance.returnElement(entity);

        }
    }
    public static getStripedTintedTexture(
        level: number,
        baseKey: string,
        colors: string[],
        renderer: PIXI.Renderer,
        direction: BakeDirection = BakeDirection.VERTICAL
    ): PIXI.Texture {
        const cacheKey = `MergeAsset_Level_${level}_H'}`;
        //const cacheKey = `MergeAsset_Level_${level}_${direction === BakeDirection.VERTICAL ? 'V' : 'H'}`;

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
     * Bakes any PIXI Container into a texture and saves it to the cache.
     * @param id The unique identifier for the cached texture.
     * @param container The PIXI container to bake.
     * @param renderer The PIXI renderer.
     * @returns The generated (or cached) PIXI.Texture.
     */
    public static bakeContainer(id: string, container: PIXI.Container, renderer: PIXI.Renderer): PIXI.Texture {
        // Check if it already exists in cache
        if (this.cache.has(id)) {
            return this.cache.get(id)!;
        }

        // Calculate bounds to ensure we capture the whole container
        const bounds = container.getLocalBounds();

        const renderTexture = PIXI.RenderTexture.create({
            width: bounds.width,
            height: bounds.height
        });

        // Render the container to the texture
        renderer.render(container, { renderTexture });

        // Store in cache
        this.cache.set(id, renderTexture);

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