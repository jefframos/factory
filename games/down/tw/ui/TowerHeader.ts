// TowerHeader.ts

import * as PIXI from 'pixi.js';
import Assets from '../../Assets';

const BG_TEXTURE = 'Button01_s_White_Light1';
const BG_SLICE = 30;

const PADDING_X = 50;
const PADDING_Y = 10;

/**
 * Always-visible "Level N" bubble — deliberately its OWN container (not
 * grouped with TowerNextLevelPanel, which shows the next-level progress bar)
 * so GameHud can position each independently rather than one combined
 * background having to fit both.
 */
export class TowerHeader extends PIXI.Container {
    private readonly bg: PIXI.NineSlicePlane;
    private readonly currentLabel: PIXI.Text;

    public constructor() {
        super();

        this.bg = new PIXI.NineSlicePlane(
            PIXI.Texture.from(BG_TEXTURE),
            BG_SLICE, BG_SLICE, BG_SLICE, BG_SLICE,
        );
        this.addChild(this.bg);

        this.currentLabel = new PIXI.Text('', Assets.TextStyles.HeaderCurrentLevel);
        this.currentLabel.anchor.set(0.5, 0.5);
        this.addChild(this.currentLabel);
    }

    public update(levelIndex: number): void {
        this.currentLabel.text = `Level ${levelIndex + 1}`;
        this.layoutContent();
    }

    private layoutContent(): void {
        this.bg.width = this.currentLabel.width + PADDING_X * 2;
        this.bg.height = this.currentLabel.height + PADDING_Y * 2;
        this.bg.position.set(-this.bg.width / 2, -this.bg.height / 2);
    }
}
