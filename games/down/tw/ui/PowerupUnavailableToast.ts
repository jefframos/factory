// PowerupUnavailableToast.ts

import gsap from 'gsap';
import * as PIXI from 'pixi.js';
import Assets from '../../Assets';

const DISPLAY_SECONDS = 1.1;
const FADE_SECONDS = 0.2;
const PADDING_X = 24;
const PADDING_Y = 14;
const CORNER_RADIUS = 16;

/**
 * Brief center-screen "Can't use this powerup right now" message — see
 * IslandViewScene.canUsePowerupRightNow(), the gate that decides when to
 * show this instead of opening the normal confirm popup (trapdoor/
 * destroy-piece/upgrade-piece with nothing on the board, clear-low-tier
 * with nothing in tier 0/1/2). Same fade-in/hold/fade-out shape as
 * ZoneNotification, just a plain background pill instead of a per-letter
 * pop-in animation — this is a rejection, not a celebration.
 */
export class PowerupUnavailableToast extends PIXI.Container {
    private readonly bg: PIXI.Graphics;
    private readonly label: PIXI.Text;
    private tween: gsap.core.Timeline | null = null;

    public constructor() {
        super();

        this.alpha = 0;

        this.bg = new PIXI.Graphics();
        this.addChild(this.bg);

        this.label = new PIXI.Text('', Assets.TextStyles.WarningToast);
        this.label.anchor.set(0.5);
        this.addChild(this.label);
    }

    /** Shows `message`, fades out on its own after DISPLAY_SECONDS — no hide() needed, killing/restarting the tween handles a rapid re-trigger cleanly. */
    public show(message: string): void {
        this.label.text = message;

        this.bg.clear();
        this.bg.beginFill(0x1a1a1a, 0.85);
        this.bg.drawRoundedRect(
            -this.label.width * 0.5 - PADDING_X,
            -this.label.height * 0.5 - PADDING_Y,
            this.label.width + PADDING_X * 2,
            this.label.height + PADDING_Y * 2,
            CORNER_RADIUS,
        );
        this.bg.endFill();

        this.tween?.kill();
        this.alpha = 0;

        this.tween = gsap.timeline();

        this.tween
            .to(this, { alpha: 1, duration: FADE_SECONDS })
            .to({}, { duration: DISPLAY_SECONDS })
            .to(this, { alpha: 0, duration: FADE_SECONDS });
    }

    public override destroy(options?: boolean | PIXI.IDestroyOptions): void {
        this.tween?.kill();
        super.destroy(options ?? { children: true });
    }
}
