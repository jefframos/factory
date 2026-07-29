// TowerNextLevelPanel.ts

import * as PIXI from 'pixi.js';
import { NineSliceProgressBar } from 'core/ui/NineSliceProgressBar';
import Assets from '../../Assets';

const BG_TEXTURE = 'Button01_s_White_Light1';
const BG_SLICE = 30;

const BAR_BORDER = 30;
const BAR_FILL_COLOR = 0xffe066;

const PADDING_X = 5;
const PADDING_Y = 5;

const DEFAULT_WIDTH = 180;
const DEFAULT_HEIGHT = 50;

/**
 * Next-level progress readout — "current/target" height (e.g. "5.0/22m")
 * over a horizontal fill bar, both driven by update(). A separate
 * container from TowerHeader (which just shows "Level N") so GameHud can
 * position each independently — see PowerupBelt/TowerHeader for the same
 * "shared background texture, own container" convention.
 *
 * `width`/`height` fix the WHOLE container's size up front — the bar fills
 * it entirely (minus PADDING_X/PADDING_Y), and the label sits centered on
 * top of the bar. Font size is whatever Assets.TextStyles.HeaderNextLevel
 * says — not derived here.
 */
export class TowerNextLevelPanel extends PIXI.Container {
    private readonly bg: PIXI.NineSlicePlane;
    private readonly bar: NineSliceProgressBar;
    private readonly label: PIXI.Text;

    public constructor(width: number = DEFAULT_WIDTH, height: number = DEFAULT_HEIGHT) {
        super();

        this.bg = new PIXI.NineSlicePlane(
            PIXI.Texture.from(BG_TEXTURE),
            BG_SLICE, BG_SLICE, BG_SLICE, BG_SLICE,
        );
        this.bg.width = width;
        this.bg.height = height;
        this.bg.position.set(-width / 2, -height / 2);
        this.addChild(this.bg);

        const barWidth = width - PADDING_X * 2;
        const barHeight = height - PADDING_Y * 2;

        this.bar = new NineSliceProgressBar({
            width: barWidth,
            height: barHeight,
            bgTexture: PIXI.Texture.from('Button01_s_White_Light1'),
            barTexture: PIXI.Texture.from('Button01_s_White_Light1_fill'),
            leftWidth: BAR_BORDER,
            topHeight: BAR_BORDER,
            rightWidth: BAR_BORDER,
            bottomHeight: BAR_BORDER,
            barColor: BAR_FILL_COLOR,
            useMask: true
        });
        this.addChild(this.bar);

        this.label = new PIXI.Text('', Assets.TextStyles.HeaderNextLevel);
        this.label.anchor.set(0.5, 0.5);
        this.addChild(this.label);
    }

    /**
     * `currentHeightMeters`/`targetHeightMeters` are always plain meters
     * (the "5.0/22m" look), independent of the km-scale destination toggle
     * TowerHeader/TowerHeightGauge use elsewhere — this panel is purely
     * about the next-level climb, not the whole level's destination
     * distance. `fraction` (0..1) drives the fill.
     */
    public update(currentHeightMeters: number, targetHeightMeters: number, fraction: number): void {
        this.label.text = `${currentHeightMeters.toFixed(1)}/${targetHeightMeters.toFixed(0)}m`;
        this.bar.update(fraction);
    }

    public destroy(options?: boolean | PIXI.IDestroyOptions): void {
        this.bar.destroy();
        super.destroy(options ?? { children: true });
    }
}
