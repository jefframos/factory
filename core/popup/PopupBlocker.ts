import { Game } from '@core/Game';
import { gsap } from 'gsap';
import * as PIXI from 'pixi.js';

export class PopupBlocker extends PIXI.Container {
    private fadeTween: gsap.core.Tween | null = null;
    private closeCallback?: () => void;

    private background: PIXI.Sprite;
    private overlayPattern: PIXI.TilingSprite;

    constructor() {
        super();

        // Base background (tinted sprite with alpha)
        this.background = new PIXI.Sprite(PIXI.Texture.WHITE);
        this.background.tint = 0x000000;
        this.background.alpha = 1;
        this.background.interactive = true;
        this.addChild(this.background);

        // Pattern or tile overlay (can be replaced with a texture)
        this.overlayPattern = new PIXI.TilingSprite(PIXI.Texture.EMPTY, 1, 1);
        this.overlayPattern.alpha = 0.1; // subtle
        this.addChild(this.overlayPattern);

        // Top-level container input handling
        this.alpha = 0;
        this.visible = false;
        this.interactive = true;

        this.on('pointertap', () => {
            this.closeCallback?.();
        });
    }

    setOnTap(callback: () => void) {
        this.closeCallback = callback;
    }

    async fadeIn(): Promise<void> {
        this.visible = true;
        if (this.fadeTween) this.fadeTween.kill();
        return new Promise(resolve => {
            this.fadeTween = gsap.to(this, {
                alpha: 0.75,
                duration: 0.3,
                onComplete: resolve
            });
        });
    }

    async fadeOut(): Promise<void> {
        if (this.fadeTween) this.fadeTween.kill();
        return new Promise(resolve => {
            this.fadeTween = gsap.to(this, {
                alpha: 0,
                duration: 0.3,
                onComplete: () => {
                    this.visible = false;
                    resolve();
                }
            });
        });
    }

    resize(): void {
        const x = Game.overlayScreenData.topLeft.x - Game.DESIGN_WIDTH / 2;
        const y = Game.overlayScreenData.topLeft.y - Game.DESIGN_HEIGHT / 2;
        const w = Game.overlayScreenData.width + 2;
        const h = Game.overlayScreenData.height + 2;

        this.position.set(x, y);
        this.background.width = w;
        this.background.height = h;

        this.overlayPattern.width = w;
        this.overlayPattern.height = h;
    }

    /**
     * Optional helper to set the pattern texture.
     */
    setOverlayTexture(texture: PIXI.Texture, alpha: number = 0.1): void {
        this.overlayPattern.texture = texture;
        this.overlayPattern.alpha = alpha;
    }
}
