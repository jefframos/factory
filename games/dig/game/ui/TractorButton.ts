// TractorButton.ts
//
// The HUD's tractor button: a sticker of the tractor as it looks now (its paint and part; a white outline, nothing behind
// it), a bouncing "!" while there's something new for it. Shown once there's a tractor to dress (MowHud).

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { UiKit } from './UiKit';
import { UiAnim } from './UiAnim';
import { ModelIcons } from './ModelIcons';
import { DigAudio } from '../audio/DigAudio';
import { DigProgress } from '../data/DigProgress';
import { stickerCanvas } from './Sticker';

/** The sticker's outline and shadow, as shares of the picture. */
const OUTLINE = 0.055;
const SHADOW = 0.05;
const stickers = new WeakMap<HTMLCanvasElement, PIXI.Texture>();

/** The sticker of a picture (Sticker), one per picture. */
function stickerOf(picture: HTMLCanvasElement): PIXI.Texture {
    let texture = stickers.get(picture);
    if (!texture) {
        const size = picture.width;
        texture = PIXI.Texture.from(stickerCanvas(picture, size, size, size * OUTLINE, size * SHADOW));
        stickers.set(picture, texture);
    }
    return texture;
}

export class TractorButton extends PIXI.Container {
    private readonly picture = new PIXI.Sprite(PIXI.Texture.EMPTY);
    private readonly alert: PIXI.Container;
    private wearing = '';

    public constructor(private readonly size: number, onTap: () => void) {
        super();
        this.picture.anchor.set(0.5);
        this.alert = UiKit.sprite('hud', 'alert');
        this.alert.scale.set(34 / Math.max(this.alert.width, this.alert.height, 1));
        this.alert.position.set(size / 2 - 6, -size / 2 + 6);
        gsap.to(this.alert, { y: this.alert.y - 8, duration: 0.45, ease: 'sine.inOut', yoyo: true, repeat: -1 });
        this.addChild(this.picture, this.alert);
        this.hitArea = new PIXI.Rectangle(-size / 2, -size / 2, size, size);
        this.eventMode = 'static';
        this.cursor = 'pointer';
        this.visible = false;
        // Taps on HUD buttons must not also start the movement joystick underneath.
        this.on('pointerdown', (event: PIXI.FederatedPointerEvent) => event.stopPropagation());
        this.on('pointertap', (event: PIXI.FederatedPointerEvent) => {
            event.stopPropagation();
            DigAudio.play('toggle');
            onTap();
        });
    }

    /** Whether it's there, and its "!". */
    public set(shown: boolean, alert: boolean): void {
        if (shown && !this.visible) UiAnim.popIn(this);
        this.visible = shown;
        this.alert.visible = alert;
        if (!shown) return;
        const tool = DigProgress.tool;
        const look = DigProgress.tractorLook;
        const wearing = `${look.colors}|${look.paints}|${look.parts}`;
        if (wearing === this.wearing) return;
        this.wearing = wearing;
        void ModelIcons.tractorCanvas(tool, look).then((canvas) => {
            if (this.destroyed || this.wearing !== wearing) return;
            // (The renderer isn't up yet: the next refresh asks again.)
            if (!canvas) {
                this.wearing = '';
                return;
            }
            this.picture.texture = stickerOf(canvas);
            this.picture.scale.set((this.size * 1.12) / this.picture.texture.width);
        });
    }

    public override destroy(): void {
        UiAnim.kill(this);
        super.destroy({ children: true });
    }
}
