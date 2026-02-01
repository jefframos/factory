import { Game } from "@core/Game";
import { Assets, Container, Sprite, Texture, TilingSprite } from "pixi.js";

export interface PatternConfig {
    patternPath?: string;
    background: number | string;
    patternAlpha?: number;
    tileSpeedX?: number;
    tileSpeedY?: number;
}

export default class PatternBackground extends Container {
    private backgroundSprite: Sprite;
    public tiledTexture?: TilingSprite;
    private config: Required<PatternConfig>;

    constructor(config: PatternConfig) {
        super();

        this.config = {
            patternAlpha: 0.05,
            tileSpeedX: 10,
            tileSpeedY: 10,
            ...config
        };

        const isColor = typeof this.config.background === 'number';
        this.backgroundSprite = new Sprite(isColor ? Texture.WHITE : Texture.EMPTY);

        if (isColor) {
            this.backgroundSprite.tint = this.config.background as number;
        }

        this.backgroundSprite.anchor.set(0.5);
        this.addChild(this.backgroundSprite);
    }

    public async init() {
        const promises: Promise<void>[] = [];

        // 1. Background Logic
        if (typeof this.config.background === 'string') {
            const bgKey = this.config.background;
            if (Assets.cache.has(bgKey)) {
                this.backgroundSprite.texture = Assets.get(bgKey);
            } else {
                promises.push(Assets.load<Texture>(bgKey).then(tex => {
                    this.backgroundSprite.texture = tex;
                }));
            }
        }

        // 2. Pattern Logic
        if (!this.config.patternPath) {
            return
        }
        const patKey = this.config.patternPath;
        if (Assets.cache.has(patKey)) {
            this.createTilingSprite(Assets.get(patKey));
        } else {
            promises.push(Assets.load<Texture>(patKey).then(tex => {
                this.createTilingSprite(tex);
            }));
        }

        if (promises.length > 0) {
            await Promise.all(promises);
        }
    }

    /** Helper to keep code DRY and ensure correct layering */
    private createTilingSprite(tex: Texture) {
        // Prevent double creation if init is called twice
        if (this.tiledTexture) return;

        this.tiledTexture = new TilingSprite(
            tex,
            Game.gameScreenData?.width ?? 800,
            Game.gameScreenData?.height ?? 600
        );
        this.tiledTexture.anchor.set(0.5);

        // If it was cached, maybe skip the fade-in? 
        // Here we keep it 0 for consistency with your update logic.
        this.tiledTexture.alpha = 0;

        this.addChildAt(this.tiledTexture, 1);
    }

    public update(delta: number) {
        const screenWidth = Game.gameScreenData?.width ?? 800;
        const screenHeight = Game.gameScreenData?.height ?? 600;

        const parentScale = this.scale || { x: 1, y: 1 };
        //console.log(parentScale)
        this.backgroundSprite.width = screenWidth / parentScale.x;
        this.backgroundSprite.height = screenHeight / parentScale.y;

        if (this.tiledTexture) {
            this.tiledTexture.width = screenWidth / parentScale.x;
            this.tiledTexture.height = screenHeight / parentScale.y;

            const containerScale = this.scale;

            this.tiledTexture.tileScale.set(containerScale.x !== 0 ? 1 / containerScale.x : 1, containerScale.y !== 0 ? 1 / containerScale.y : 1)

            this.tiledTexture.tilePosition.x += this.config.tileSpeedX * delta;
            this.tiledTexture.tilePosition.y += this.config.tileSpeedY * delta;

            if (this.tiledTexture.alpha < this.config.patternAlpha) {
                this.tiledTexture.alpha += 0.2 * delta;
                if (this.tiledTexture.alpha > this.config.patternAlpha) {
                    this.tiledTexture.alpha = this.config.patternAlpha;
                }
            }
        }
    }
}