import ViewUtils from '@core/utils/ViewUtils';
import { LevelDefinition } from 'games/game4/types';
import * as PIXI from 'pixi.js';
import { Signal } from 'signals';
import Assets from '../Assets';

export class NextLevelCard extends PIXI.Container {
    public readonly onClicked = new Signal();

    private background: PIXI.NineSlicePlane;
    private previewSprite: PIXI.Sprite;
    private maskGraphic: PIXI.Graphics;
    private nextLabel: PIXI.Text;
    private playNowLabel: PIXI.Text;
    private fingerIcon: PIXI.Sprite;

    // Animation state
    private animTime: number = 0;
    private isAnimating: boolean = false;

    constructor(w: number, h: number) {
        super();

        this.pivot.set(w / 2, h / 2);
        this.eventMode = 'static';
        this.cursor = 'pointer';

        // Setup visual components...
        this.createChildren(w, h);

        // Bind the update method to maintain 'this' context
        this.update = this.update.bind(this);

        this.on('pointertap', () => this.onClicked.dispatch());

        // Start animating automatically
        this.startAnimation();

        // Clean up when the object is destroyed
        this.on('destroyed', () => this.stopAnimation());
    }

    private createChildren(w: number, h: number): void {
        const pad = 20;

        this.background = new PIXI.NineSlicePlane(
            PIXI.Texture.from(Assets.Textures.UI.NextCardBackground) ?? PIXI.Texture.WHITE,
            16, 16, 16, 16
        );
        this.background.width = w;
        this.background.height = h;
        this.addChild(this.background);

        this.nextLabel = new PIXI.Text('NEXT PUZZLE', { ...Assets.MainFont, fontSize: 24, fill: 0xffffff });
        this.nextLabel.anchor.set(0.5, 0);
        this.nextLabel.position.set(w / 2, pad);
        this.addChild(this.nextLabel);

        const innerH = h - (pad * 6);
        this.previewSprite = new PIXI.Sprite(PIXI.Texture.WHITE);
        this.previewSprite.anchor.set(0.5);
        this.previewSprite.position.set(w / 2, h / 2);

        this.maskGraphic = new PIXI.Graphics()
            .beginFill(0xffffff)
            .drawRoundedRect(pad, this.nextLabel.y + this.nextLabel.height + 10, w - pad * 2, innerH, 20)
            .endFill();

        this.previewSprite.mask = this.maskGraphic;
        this.addChild(this.maskGraphic, this.previewSprite);

        this.playNowLabel = new PIXI.Text('PLAY NOW', { ...Assets.MainFont, fontSize: 32, fill: 0xf0f04a });
        this.playNowLabel.anchor.set(0.5, 1);
        this.playNowLabel.position.set(w / 2, h - pad);
        this.addChild(this.playNowLabel);

        this.fingerIcon = PIXI.Sprite.from(Assets.Textures.Icons.Finger || PIXI.Texture.WHITE);
        this.fingerIcon.anchor.set(0.5);
        this.fingerIcon.position.set(w - pad, h - pad);
        this.addChild(this.fingerIcon);
    }

    public startAnimation(): void {
        if (this.isAnimating) return;
        this.isAnimating = true;
        PIXI.Ticker.shared.add(this.update);
    }

    public stopAnimation(): void {
        this.isAnimating = false;
        PIXI.Ticker.shared.remove(this.update);
    }

    private update(delta: number): void {
        // Increment time based on ticker delta for frame-rate independence
        this.animTime += 0.05 * delta;

        // 1. Card Pulse
        const pulse = 1 + Math.sin(this.animTime * 1.5) * 0.015;
        this.scale.set(pulse);

        // 2. Finger Floating & Subtle Rotation
        const fingerYOffset = Math.sin(this.animTime * 3) * 8;
        const fingerRotation = Math.cos(this.animTime * 2) * 0.1;

        this.fingerIcon.y = (this.background.height - 20) + fingerYOffset;
        this.fingerIcon.rotation = fingerRotation;

        // 3. Optional: "Play Now" slight text grow/shrink
        const textPulse = 1 + Math.sin(this.animTime * 4) * 0.05;
        this.playNowLabel.scale.set(textPulse);
    }

    public setup(level: LevelDefinition): void {
        const imgSrc = level.thumb || level.imageSrc;
        if (!imgSrc) return;

        const targetW = this.background.width - 40;
        const targetH = this.maskGraphic.height;

        const applyTexture = (tex: PIXI.Texture) => {
            this.previewSprite.texture = tex;
            const scale = ViewUtils.elementEvelop(this.previewSprite, targetW, targetH);
            this.previewSprite.scale.set(scale);
        };

        if (PIXI.Assets.cache.has(imgSrc)) {
            applyTexture(PIXI.Assets.get(imgSrc));
        } else {
            PIXI.Assets.load(imgSrc).then((tex) => {
                if (!this.destroyed) applyTexture(tex);
            });
        }
    }
}