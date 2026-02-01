import { Game } from "@core/Game";
import Pool from "@core/Pool";
import ViewUtils from "@core/utils/ViewUtils";
import * as PIXI from "pixi.js";
import { StaticData } from "../data/StaticData";
import { BlockMergeEntity } from "../entity/BlockMergeEntity";

export enum BakeDirection {
    VERTICAL,
    HORIZONTAL
}

export class TextureBaker {
    public static cache: Map<string, PIXI.Texture> = new Map();

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
            entity.complete()
            entity.update(0, new PIXI.Rectangle())
            const c = new PIXI.Container();
            c.addChild(entity)
            // entity.x = 30
            entity.y = -entity.getBounds().y

            TextureBaker.bakeContainer('ENTITY_' + index, c, Game.renderer)
            Pool.instance.returnElement(entity);

        }
    }
    public static getStripedTintedTexture(
        level: number,
        baseKey: string,
        colors: string[],
        renderer: PIXI.Renderer,
        direction: BakeDirection = BakeDirection.VERTICAL,
        overlay?: string
    ): PIXI.Texture {
        const cacheKey = `MergeAsset_Level_${level}_H`;
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


        if (overlay) {
            const sprite = PIXI.Sprite.from(overlay);
            container.addChild(sprite);
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
  * Bakes an entity frame using ALREADY cached entity textures.
  */
    public static bakeFramedEntity(
        level: number,
        frameTextureKey: string,
        renderer: PIXI.Renderer,
        portraitKey?: string,

    ): PIXI.Texture {
        const cacheKey = `Entity_${level}_Frame`;

        // 1. Check if the frame itself is already baked
        if (this.cache.has(cacheKey)) {
            return this.cache.get(cacheKey)!;
        }

        // 2. Fetch the ALREADY baked entity texture
        // Using your specific key format from getStripedTintedTexture
        const entityCacheKey = `ENTITY_${level}`;
        const entityTexture = this.cache.get(entityCacheKey);

        if (!entityTexture) {
            console.error(`TextureBaker: Could not find base entity texture for key ${entityCacheKey}`);
            console.warn(this.cache)
            return PIXI.Texture.WHITE; // Fallback
        }

        const frameTexture = PIXI.Texture.from(frameTextureKey);
        const { width, height } = frameTexture;
        const container = new PIXI.Container();

        // 3. Layer 1: Background (White texture tinted light blue)
        const bg = PIXI.Sprite.from(portraitKey ? portraitKey : PIXI.Texture.WHITE);
        const pd = 15
        bg.width = width - pd;
        bg.height = height - pd;
        bg.x = pd / 2
        bg.y = pd / 2
        bg.tint = portraitKey ? 0xFFFFFF : 0x3498db; // Example Blue Tint
        container.addChild(bg);

        const pad = 35
        // 4. Layer 2: The Entity (using existing texture)
        const entitySprite = new PIXI.Sprite(entityTexture);
        entitySprite.anchor.set(0.5, 1);
        entitySprite.x = width / 2;
        entitySprite.y = height - pad;

        entitySprite.scale.set(ViewUtils.elementScaler(entitySprite, entitySprite.width - pad, entitySprite.height - pad));
        container.addChild(entitySprite);

        // 5. Layer 3: The Frame (Top layer)
        const frameSprite = new PIXI.Sprite(frameTexture);
        container.addChild(frameSprite);

        // 6. Bake to RenderTexture
        const renderTexture = PIXI.RenderTexture.create({ width, height });
        renderer.render(container, { renderTexture });


        entitySprite.tint = 0;
        const renderTexture2 = PIXI.RenderTexture.create({ width, height });
        renderer.render(container, { renderTexture: renderTexture2 });

        // 7. Cleanup container
        container.destroy({ children: true });

        // Store the new frame texture in cache
        this.cache.set(cacheKey + '_LOCKED', renderTexture2);
        this.cache.set(cacheKey, renderTexture);
        return renderTexture;
    }

    /**
     * Call this during your initialization sequence to bake all frames
     */
    public static bakeAllFrames(frameKeys: string[], renderer: PIXI.Renderer) {
        for (let i = 1; i <= StaticData.entityCount; i++) {
            // Pick a frame from your list (cycling or by level)
            const frameKey = frameKeys[(i - 1) % frameKeys.length];
            this.bakeFramedEntity(i, frameKey, renderer);
        }
    }
    /**
     * Useful for clearing memory if you change themes or world maps
     */
    public static clearCache(): void {
        this.cache.forEach(tex => tex.destroy(true));
        this.cache.clear();
    }
}