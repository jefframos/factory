import { Game } from "@core/Game";
import { Assets, Container, Sprite, Texture, TilingSprite } from "pixi.js";

export interface PatternConfig {
    patternPath: string;
    background: number | string;
    patternAlpha?: number;
    tileSpeedX?: number;
    tileSpeedY?: number;
}

export default class PatternBackground extends Container {
    private backgroundSprite: Sprite;
    private tilingJigsaw?: TilingSprite;
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
        if (this.tilingJigsaw) return;

        this.tilingJigsaw = new TilingSprite(
            tex,
            Game.gameScreenData?.width ?? 800,
            Game.gameScreenData?.height ?? 600
        );
        this.tilingJigsaw.anchor.set(0.5);

        // If it was cached, maybe skip the fade-in? 
        // Here we keep it 0 for consistency with your update logic.
        this.tilingJigsaw.alpha = 0;

        this.addChildAt(this.tilingJigsaw, 1);
    }

    public update(delta: number) {
        const screenWidth = Game.gameScreenData?.width ?? 800;
        const screenHeight = Game.gameScreenData?.height ?? 600;

        this.backgroundSprite.width = screenWidth;
        this.backgroundSprite.height = screenHeight;

        if (this.tilingJigsaw) {
            this.tilingJigsaw.width = screenWidth;
            this.tilingJigsaw.height = screenHeight;

            this.tilingJigsaw.tilePosition.x += this.config.tileSpeedX * delta;
            this.tilingJigsaw.tilePosition.y += this.config.tileSpeedY * delta;

            if (this.tilingJigsaw.alpha < this.config.patternAlpha) {
                this.tilingJigsaw.alpha += 0.2 * delta;
                if (this.tilingJigsaw.alpha > this.config.patternAlpha) {
                    this.tilingJigsaw.alpha = this.config.patternAlpha;
                }
            }
        }
    }
}