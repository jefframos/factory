// HomeButton.ts

import * as PIXI from 'pixi.js';
import { Signal } from 'signals';

const BG_TEXTURE = 'Button01_s_White_Light1';
const BG_SLICE = 30;
const ICON_FRAME = 'PictoIcon_Home_2-2';

/**
 * Top-left "open the home menu" button — own local origin is its top-left
 * corner (same convention GemCounter/ShapeModeToggleButton use), so
 * GameHud.layout() can flush it straight into the screen corner. Purely a
 * dumb button — dispatches onTap; IslandViewScene decides what that means
 * (opens HomePopup), same "dumb widget, smart scene" convention every other
 * GameHud sub-widget follows.
 */
export class HomeButton extends PIXI.Container {
    public static readonly SIZE = 48;

    public readonly onTap: Signal = new Signal();

    private readonly bg: PIXI.NineSlicePlane;
    private readonly icon: PIXI.Sprite;

    public constructor() {
        super();

        const size = HomeButton.SIZE;

        this.bg = new PIXI.NineSlicePlane(
            PIXI.Texture.from(BG_TEXTURE),
            BG_SLICE, BG_SLICE, BG_SLICE, BG_SLICE,
        );
        this.bg.width = size;
        this.bg.height = size;
        this.addChild(this.bg);

        this.icon = PIXI.Sprite.from(ICON_FRAME);
        this.icon.anchor.set(0.5);
        this.icon.position.set(size * 0.5, size * 0.5);
        const iconSize = size - 14;
        this.icon.scale.set(iconSize / Math.max(this.icon.texture.width, this.icon.texture.height));
        this.addChild(this.icon);

        this.eventMode = 'static';
        this.cursor = 'pointer';
        this.on('pointertap', () => this.onTap.dispatch());
    }

    public override destroy(options?: boolean | PIXI.IDestroyOptions): void {
        this.onTap.removeAll();
        super.destroy(options ?? { children: true });
    }
}
