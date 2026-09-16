// GemCounter.ts

import * as PIXI from 'pixi.js';
import Assets from '../../Assets';

const BG_TEXTURE = 'Button01_s_White_Light1';
const BG_SLICE = 30;
const PADDING_X = 16;
const PADDING_Y = 8;
const ICON_SIZE = 32;
const ICON_GAP = 8;

/**
 * Top-left "how many gems do I have" pill — always visible during gameplay,
 * same NineSlicePlane-bubble convention as ShapeModeToggleButton/TowerHeader.
 * Own local origin is its top-left corner (same convention
 * ShapeModeToggleButton uses) rather than center-anchored, so GameHud.layout()
 * can flush it straight into the screen corner. Purely a display — dumb
 * widget, fed GemStorage.get() every frame by IslandViewScene via
 * GameHud.updateGems(), same "HUD widgets don't read storage themselves"
 * convention every other GameHud sub-widget already follows.
 */
export class GemCounter extends PIXI.Container {
    private readonly bg: PIXI.NineSlicePlane;
    private readonly icon: PIXI.Sprite;
    private readonly label: PIXI.Text;

    /** -1 so the very first update() call still lays out the pill instead of short-circuiting on "already 0". */
    private amount = -1;

    public constructor() {
        super();

        this.bg = new PIXI.NineSlicePlane(
            PIXI.Texture.from(BG_TEXTURE),
            BG_SLICE, BG_SLICE, BG_SLICE, BG_SLICE,
        );
        this.addChild(this.bg);

        this.icon = PIXI.Sprite.from(Assets.Textures.Icons.Gem);
        this.icon.anchor.set(0.5);
        this.icon.scale.set(ICON_SIZE / Math.max(this.icon.texture.width, this.icon.texture.height));
        this.addChild(this.icon);

        this.label = new PIXI.Text('0', Assets.TextStyles.NextLabel);
        this.label.anchor.set(0, 0.5);
        this.addChild(this.label);

        this.update(0);
    }

    public update(amount: number): void {
        if (amount === this.amount) {
            return;
        }

        this.amount = amount;
        this.label.text = String(amount);

        const height = ICON_SIZE + PADDING_Y * 2;
        const width = PADDING_X * 2 + ICON_SIZE + ICON_GAP + this.label.width;

        this.bg.width = width;
        this.bg.height = height;
        this.bg.position.set(0, 0);

        this.icon.position.set(PADDING_X + ICON_SIZE / 2, height / 2);
        this.label.position.set(PADDING_X + ICON_SIZE + ICON_GAP, height / 2);
    }
}
