import BaseButton from 'core/ui/BaseButton';
import * as PIXI from 'pixi.js';
import { Signal } from 'signals';

// ─────────────────────────────────────────────────────────────────────────────
// Atlas-key constants – change only these strings to rewire all textures
// ─────────────────────────────────────────────────────────────────────────────
const ATLAS = {
    // Panel
    PANEL: 'ItemFrame01_Single_Navy',

    // Score shine (rotated sprite behind the score)
    SCORE_SHINE: 'Image_Effect_Rotate',

    // Replay button
    REPLAY_STANDARD: 'Button01_s_Purple',
    REPLAY_DOWN: 'Button01_s_Purple',
    REPLAY_DISABLED: 'Button01_s_Gray',

    // Continue button
    CONTINUE_STANDARD: 'Button01_s_Green',
    CONTINUE_DOWN: 'Button01_s_Green',
    CONTINUE_DISABLED: 'Button01_s_Green',

    // Continue video / watch-ad icon
    CONTINUE_VIDEO_ICON: 'ItemIcon_Video-2',
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Layout constants
// ─────────────────────────────────────────────────────────────────────────────
const PANEL_WIDTH = 520;
const PANEL_HEIGHT = 640;
const PANEL_NINE_SLICE_PADDING = 30;

const BUTTON_WIDTH = 420;
const BUTTON_HEIGHT = 90;
const BUTTON_PADDING = 35;

const SHINE_ROTATION_SPEED = 0.4; // radians per second

const FADE_DURATION_MS = 280; // milliseconds for fade in / out

// ─────────────────────────────────────────────────────────────────────────────
// Font style helpers
// ─────────────────────────────────────────────────────────────────────────────




const REPLAY_FONT_STYLE: Partial<PIXI.ITextStyle> = {
    fontFamily: 'LEMONMILK-Bold',
    fontSize: 32,
    fontWeight: 'bold',
    fill: 0xffffff,
    stroke: 0,
    strokeThickness: 4,
    dropShadow: true,

    dropShadowDistance: 2,
    dropShadowColor: 0x000000,
    dropShadowAlpha: 1,
    dropShadowAngle: 3.14 / 2
};

const CONTINUE_FONT_STYLE: Partial<PIXI.ITextStyle> = {
    ...REPLAY_FONT_STYLE, fontSize: 28
};


const SCORE_STYLE: Partial<PIXI.ITextStyle> = {
    ...REPLAY_FONT_STYLE,
    fontSize: 80,
    dropShadowDistance: 6,
    fontWeight: 'bold',
    fill: 0xffe066,

};


const TITLE_STYLE: Partial<PIXI.ITextStyle> = {
    ...REPLAY_FONT_STYLE,
    fontSize: 52,
    fontWeight: 'bold',
    fill: 0xffffff,
};

// ─────────────────────────────────────────────────────────────────────────────
// GameOverPopup
// ─────────────────────────────────────────────────────────────────────────────
export class GameOverPopup extends PIXI.Container {
    // Public signals – consumers connect to these
    public readonly onReplay = new Signal();
    public readonly onContinue = new Signal();

    // ── UI nodes ───────────────────────────────────────────────────────────────
    private readonly _dimmer: PIXI.Graphics;
    private readonly _card: PIXI.Container;
    private readonly _panel: PIXI.NineSlicePlane;
    private readonly _titleText: PIXI.Text;
    private readonly _scoreShine: PIXI.Sprite;
    private readonly _scoreText: PIXI.Text;
    private readonly _replayBtn: BaseButton;
    private readonly _continueBtn: BaseButton;

    // ── Animation state ────────────────────────────────────────────────────────
    private _prevTime: number = 0;
    private _fadeProgress: number = 0;   // 0 = fully hidden, 1 = fully visible
    private _fadingIn: boolean = false;
    private _fadingOut: boolean = false;
    private _shineAngle: number = 0;

    // ── Viewport dimensions ────────────────────────────────────────────────────
    private _viewWidth: number;
    private _viewHeight: number;


    // ─────────────────────────────────────────────────────────────────────────
    constructor(viewWidth: number, viewHeight: number) {
        super();

        this._viewWidth = viewWidth;
        this._viewHeight = viewHeight;

        // Start hidden
        this.visible = false;
        this.alpha = 0;

        // ── Dimmer ───────────────────────────────────────────────────────────────
        this._dimmer = new PIXI.Graphics();
        this._dimmer.beginFill(0x000000, 0.15);
        this._dimmer.drawRect(-viewWidth * 2, -viewWidth * 2, viewWidth * 4, viewHeight * 4);
        this._dimmer.endFill();
        this.addChild(this._dimmer);

        // ── Card (centred container) ─────────────────────────────────────────────
        this._card = new PIXI.Container();
        this.addChild(this._card);

        // NineSlice panel background
        this._panel = new PIXI.NineSlicePlane(
            PIXI.Texture.from(ATLAS.PANEL),
            PANEL_NINE_SLICE_PADDING,
            PANEL_NINE_SLICE_PADDING,
            PANEL_NINE_SLICE_PADDING,
            PANEL_NINE_SLICE_PADDING,
        );
        this._panel.width = PANEL_WIDTH;
        this._panel.height = PANEL_HEIGHT;
        this._card.addChild(this._panel);

        // ── Title ────────────────────────────────────────────────────────────────
        this._titleText = new PIXI.Text('GAME OVER', new PIXI.TextStyle(TITLE_STYLE));
        this._titleText.anchor.set(0.5, 0);
        this._card.addChild(this._titleText);

        // ── Score shine (rotates behind score number) ────────────────────────────
        this._scoreShine = new PIXI.Sprite(PIXI.Texture.from(ATLAS.SCORE_SHINE));
        this._scoreShine.anchor.set(0.5);
        this._card.addChild(this._scoreShine);

        // ── Score text ───────────────────────────────────────────────────────────
        this._scoreText = new PIXI.Text('0', new PIXI.TextStyle(SCORE_STYLE));
        this._scoreText.anchor.set(0.5);
        this._card.addChild(this._scoreText);


        // ── Replay button ────────────────────────────────────────────────────────
        this._replayBtn = new BaseButton({
            standard: {
                width: BUTTON_WIDTH,
                height: BUTTON_HEIGHT,
                allPadding: BUTTON_PADDING,
                texture: PIXI.Texture.from(ATLAS.REPLAY_STANDARD),
                label: 'REPLAY',
                fontStyle: new PIXI.TextStyle(REPLAY_FONT_STYLE),
            },
            over: {
                tint: 0xddddff,
            },
            down: {
                texture: PIXI.Texture.from(ATLAS.REPLAY_DOWN),
                tint: 0xcccccc,
            },
            click: {
                callback: () => {
                    this.onReplay.dispatch();
                },
            },
            disabled: {
                texture: PIXI.Texture.from(ATLAS.REPLAY_DISABLED),
                tint: 0x888888,
            },
        });
        this._card.addChild(this._replayBtn);
        console.log(this._replayBtn)
        this._replayBtn.setLabel('Restart')

        // ── Continue (watch ad) button ───────────────────────────────────────────
        this._continueBtn = new BaseButton({
            standard: {
                width: BUTTON_WIDTH,
                height: BUTTON_HEIGHT,
                allPadding: BUTTON_PADDING,
                texture: PIXI.Texture.from(ATLAS.CONTINUE_STANDARD),
                label: 'CONTINUE',
                fontStyle: new PIXI.TextStyle(CONTINUE_FONT_STYLE),
                // Video icon on the left side of the label
                iconTexture: PIXI.Texture.from(ATLAS.CONTINUE_VIDEO_ICON),
                iconSize: { width: 60, height: 60 },
                iconAnchor: new PIXI.Point(0, 0),
                centerIconVertically: true,
                iconOffset: new PIXI.Point(BUTTON_PADDING, -5),
                // Nudge label right to make room for the icon
                labelOffset: { x: 28, y: 0 },
            },
            over: {
                tint: 0xddffd0,
            },
            down: {
                texture: PIXI.Texture.from(ATLAS.CONTINUE_DOWN),
                tint: 0xaaaaaa,
            },
            click: {
                callback: () => {
                    this.onContinue.dispatch();
                },
            },
            disabled: {
                texture: PIXI.Texture.from(ATLAS.CONTINUE_DISABLED),
                tint: 0x888888,
            },
        });
        this._card.addChild(this._continueBtn);
        this._continueBtn.setLabel('CONTINUE')
        // Perform initial layout
        this.layout();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Public API
    // ─────────────────────────────────────────────────────────────────────────

    /** Show the popup and display the supplied score. */
    public showPopup(score: number): void {
        this._scoreText.text = String(score);

        // Make visible before animation starts so updateTransform drives the fade
        this.visible = true;
        this.interactiveChildren = false; // block interaction until fully visible

        // If we were mid-fade-out, reverse from current alpha to avoid a jump
        this._fadingOut = false;
        this._fadingIn = true;

        // Seed _prevTime so the first delta is 0 instead of huge
        this._prevTime = performance.now();
    }

    /** Hide the popup with a fade-out. */
    public hidePopup(): void {
        if (!this.visible) return;

        this.interactiveChildren = false;
        this._fadingIn = false;
        this._fadingOut = true;

        this._prevTime = performance.now();
    }

    /** Recompute positions – call after resizing the viewport. */
    public layout(): void {
        // Centre the card
        this._card.x = Math.round((this._viewWidth - PANEL_WIDTH) / 2);
        this._card.y = Math.round((this._viewHeight - PANEL_HEIGHT) / 2);

        const cx = PANEL_WIDTH / 2; // local centre-x of the panel

        // Title: near the top of the panel
        this._titleText.x = cx;
        this._titleText.y = 48;

        // Shine & score: mid-upper area
        const scoreCentreY = 220;
        this._scoreShine.x = cx;
        this._scoreShine.y = scoreCentreY;
        this._scoreText.x = cx;
        this._scoreText.y = scoreCentreY;

        // Replay button (upper of the two buttons)
        const replayY = PANEL_HEIGHT - BUTTON_HEIGHT * 2 - 48 - 16;
        this._replayBtn.x = Math.round((PANEL_WIDTH - BUTTON_WIDTH) / 2);
        this._replayBtn.y = replayY;

        // Continue button (lower)
        const continueY = replayY + BUTTON_HEIGHT + 16;
        this._continueBtn.x = Math.round((PANEL_WIDTH - BUTTON_WIDTH) / 2);
        this._continueBtn.y = continueY;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // updateTransform – called every render frame by PixiJS (no Ticker needed)
    // ─────────────────────────────────────────────────────────────────────────
    public override updateTransform(): void {
        if (this.visible) {
            const now = performance.now();
            // Guard: if _prevTime was never seeded (shouldn't happen) use now
            const elapsed = this._prevTime > 0 ? (now - this._prevTime) / 1000 : 0; // seconds
            this._prevTime = now;

            // ── Fade in / out ───────────────────────────────────────────────────
            if (this._fadingIn) {
                this._fadeProgress += elapsed / (FADE_DURATION_MS / 1000);
                if (this._fadeProgress >= 1) {
                    this._fadeProgress = 1;
                    this._fadingIn = false;
                    this.interactiveChildren = true;
                }
                this.alpha = this._easeOut(this._fadeProgress);
            } else if (this._fadingOut) {
                this._fadeProgress -= elapsed / (FADE_DURATION_MS / 1000);
                if (this._fadeProgress <= 0) {
                    this._fadeProgress = 0;
                    this._fadingOut = false;
                    this.visible = false;
                    this.alpha = 0;
                } else {
                    this.alpha = this._easeOut(this._fadeProgress);
                }
            }

            // ── Shine rotation (only while visible & not fully faded out) ────────
            if (this.alpha > 0) {
                this._shineAngle += SHINE_ROTATION_SPEED * elapsed;
                this._scoreShine.rotation = this._shineAngle;
            }
        }

        super.updateTransform();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Cleanup
    // ─────────────────────────────────────────────────────────────────────────
    public override destroy(options?: boolean | PIXI.IDestroyOptions): void {

        super.destroy(options);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Private helpers
    // ─────────────────────────────────────────────────────────────────────────

    /** Quadratic ease-out so the fade feels snappy at the start and settles smoothly. */
    private _easeOut(t: number): number {
        return 1 - (1 - t) * (1 - t);
    }
}
