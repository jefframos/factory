import BaseButton from 'core/ui/BaseButton';
import * as PIXI from 'pixi.js';
import { Signal } from 'signals';

// ─────────────────────────────────────────────────────────────────────────────
// Atlas-key constants – change only these strings to rewire all textures
// ─────────────────────────────────────────────────────────────────────────────
const ATLAS = {
    // Panel
    PANEL: 'ItemFrame01_Single_Hologram1',

    // Score shine (rotated sprite behind the score)
    SCORE_SHINE: 'Image_Effect_Rotate',

    // Gems-earned icon
    GEM_ICON: 'ResourceBar_Single_Icon_Gem',

    // Replay button
    REPLAY_STANDARD: 'Label_Parallelogram_Gray',
    REPLAY_DOWN: 'Label_Parallelogram_Gray',
    REPLAY_DISABLED: 'Label_Parallelogram_Gray',

    // Continue button
    CONTINUE_STANDARD: 'Label_Parallelogram_Hologram',
    CONTINUE_DOWN: 'Label_Parallelogram_Hologram',
    CONTINUE_DISABLED: 'Label_Parallelogram_Hologram',

    // Continue video / watch-ad icon
    CONTINUE_VIDEO_ICON: 'ItemIcon_Video-2',
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Layout constants
// ─────────────────────────────────────────────────────────────────────────────
const PANEL_WIDTH = 520;
const PANEL_HEIGHT = 560;
const PANEL_NINE_SLICE_PADDING = 30;

const BUTTON_WIDTH = 420;
const BUTTON_HEIGHT = 66;
const BUTTON_PADDING = 35;

const SHINE_ROTATION_SPEED = 0.4; // radians per second

const FADE_DURATION_MS = 280; // milliseconds for fade in / out

// ─────────────────────────────────────────────────────────────────────────────
// Font style helpers
// ─────────────────────────────────────────────────────────────────────────────




const REPLAY_FONT_STYLE: Partial<PIXI.ITextStyle> = {
    fontFamily: 'Baloo2-ExtraBold',
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

/** "Best: N" — shown under a stat when this run DIDN'T beat the existing record. */
const BEST_STYLE: Partial<PIXI.ITextStyle> = {
    ...REPLAY_FONT_STYLE,
    fontSize: 22,
    fill: 0xaaaaaa,
    dropShadowDistance: 2,
};

/** "NEW HIGH SCORE!" — shown in BEST_STYLE's place when this run DID beat the record. */
const NEW_HIGH_STYLE: Partial<PIXI.ITextStyle> = {
    ...REPLAY_FONT_STYLE,
    fontSize: 24,
    fill: 0x66ff99,
    dropShadowDistance: 2,
};

/** "+N" gems-earned line — see GameOverData.gemsEarned. */
const GEMS_EARNED_STYLE: Partial<PIXI.ITextStyle> = {
    ...REPLAY_FONT_STYLE,
    fontSize: 26,
    fill: 0x7fe3ff,
    dropShadowDistance: 2,
};

const GEM_ICON_SIZE = 30;


const TITLE_STYLE: Partial<PIXI.ITextStyle> = {
    ...REPLAY_FONT_STYLE,
    fontSize: 52,
    fontWeight: 'bold',
    fill: 0xffffff,
};

export interface GameOverData {
    score: number;
    bestScoreText: string;
    isNewScoreHigh: boolean;
    /** Gems awarded for this run's score (see IslandViewScene's onGameOver) — 0 hides the gems-earned line entirely. */
    gemsEarned: number;
    /** Rewarded-video respawns left THIS run (see IslandViewScene's MAX_RESPAWNS_PER_RUN/respawnsUsedThisRun) — 0 hides the RESPAWN button entirely, leaving just CONTINUE; otherwise shown on RESPAWN's own label so the limit reads as a countdown, not a surprise. */
    respawnsRemaining: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// GameOverPopup
// ─────────────────────────────────────────────────────────────────────────────
export class GameOverPopup extends PIXI.Container {
    // Public signals – consumers connect to these
    /** The "Continue" button (on-screen label — see the constructor) — see IslandViewScene's replayCallback, which now opens HomePopup instead of restarting directly. Kept named onReplay/`_replayBtn` internally for historical reasons. */
    public readonly onReplay = new Signal();
    public readonly onContinue = new Signal();

    // ── UI nodes ───────────────────────────────────────────────────────────────
    private readonly _dimmer: PIXI.Graphics;
    private readonly _card: PIXI.Container;
    private readonly _panel: PIXI.NineSlicePlane;
    private readonly _titleText: PIXI.Text;
    private readonly _scoreShine: PIXI.Sprite;
    private readonly _scoreText: PIXI.Text;
    private readonly _scoreBestText: PIXI.Text;
    private readonly _gemIcon: PIXI.Sprite;
    private readonly _gemsEarnedText: PIXI.Text;
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
        this._dimmer.beginFill(0x000000, 0.65);
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

        // ── Score best/new-high ───────────────────────────────────────────────────
        this._scoreBestText = new PIXI.Text('', new PIXI.TextStyle(BEST_STYLE));
        this._scoreBestText.anchor.set(0.5, 0);
        this._card.addChild(this._scoreBestText);

        // ── Gems earned (see GameOverData.gemsEarned) ─────────────────────────────
        this._gemIcon = PIXI.Sprite.from(ATLAS.GEM_ICON);
        this._gemIcon.anchor.set(1, 0.5);
        this._gemIcon.scale.set(GEM_ICON_SIZE / Math.max(this._gemIcon.texture.width, this._gemIcon.texture.height));
        this._card.addChild(this._gemIcon);

        this._gemsEarnedText = new PIXI.Text('', new PIXI.TextStyle(GEMS_EARNED_STYLE));
        this._gemsEarnedText.anchor.set(0, 0.5);
        this._card.addChild(this._gemsEarnedText);

        // ── Continue (opens the home menu) button ─────────────────────────────────
        // Named/signaled as "replay" internally (onReplay) for historical
        // reasons — restarting in place moved to HomePopup's own RESTART
        // button; this one now just opens that menu, so its own on-screen
        // label reads "Continue" instead. See IslandViewScene's
        // replayCallback (passed into GameHud's constructor).
        this._replayBtn = new BaseButton({
            standard: {
                width: BUTTON_WIDTH,
                height: BUTTON_HEIGHT,
                texturePadding: { bottom: 0, top: 0, right: 35, left: 35 },
                texture: PIXI.Texture.EMPTY,
                label: 'REPLAY',
                fontStyle: new PIXI.TextStyle({ ...REPLAY_FONT_STYLE, fontSize: 26 }),
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
        this._replayBtn.setLabel('Continue')

        // ── Continue (watch ad) button ───────────────────────────────────────────
        this._continueBtn = new BaseButton({
            standard: {
                width: BUTTON_WIDTH,
                height: BUTTON_HEIGHT,
                texturePadding: { bottom: 0, top: 0, right: 35, left: 35 },
                texture: PIXI.Texture.from(ATLAS.CONTINUE_STANDARD),
                label: 'RESPAWN',
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
        this._continueBtn.setLabel('RESPAWN')
        // Perform initial layout
        this.layout();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Public API
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Show the popup — `bestScoreText` is already a formatted string (see
     * IslandViewScene's onGameOver, which uses HighScoreStorage).
     */
    public showPopup(data: GameOverData): void {
        this._scoreText.text = String(data.score);

        this._scoreBestText.text = data.isNewScoreHigh ? 'NEW HIGH SCORE!' : `Best: ${data.bestScoreText}`;
        this._scoreBestText.style = new PIXI.TextStyle(data.isNewScoreHigh ? NEW_HIGH_STYLE : BEST_STYLE);

        this._gemIcon.visible = data.gemsEarned > 0;
        this._gemsEarnedText.visible = data.gemsEarned > 0;
        this._gemsEarnedText.text = `+${data.gemsEarned}`;

        // Past the limit, RESPAWN disappears entirely — see GameOverData's
        // own doc — rather than staying visible-but-disabled, so CONTINUE
        // reads as the only real option instead of a greyed-out dead end.
        this._continueBtn.visible = data.respawnsRemaining > 0;
        if (this._continueBtn.visible) {
            this._continueBtn.setLabel(`RESPAWN (${data.respawnsRemaining} LEFT)`);
        }

        this.layout();

        // Make visible before animation starts so updateTransform drives the fade
        this.visible = true;
        this.interactiveChildren = false; // block interaction until fully visible

        // If we were mid-fade-out, reverse from current alpha to avoid a jump
        this._fadingOut = false;
        this._fadingIn = true;

        // Seed _prevTime so the first delta is 0 instead of huge
        this._prevTime = performance.now();
    }

    /** Call while awaiting the platform's rewarded-video promise — disables the RESPAWN button so a slow ad load can't be double-tapped. */
    public setContinueBusy(busy: boolean): void {
        if (busy) {
            this._continueBtn.disable();
        } else {
            this._continueBtn.enable();
        }
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
        const scoreCentreY = 190;
        this._scoreShine.x = cx;
        this._scoreShine.y = scoreCentreY;
        this._scoreText.x = cx;
        this._scoreText.y = scoreCentreY;

        // Score's best/new-high line, just below the score number
        this._scoreBestText.x = cx;
        this._scoreBestText.y = scoreCentreY + 45;

        // Gems-earned line, just below that (icon left of the "+N" text,
        // centered on the panel as a pair) — hidden entirely via visible
        // when this run earned none, see showPopup().
        const gemsY = scoreCentreY + 45 + this._scoreBestText.height + 30;
        const gemsPairWidth = this._gemIcon.width + 8 + this._gemsEarnedText.width;
        this._gemIcon.x = cx - gemsPairWidth / 2 + this._gemIcon.width;
        this._gemIcon.y = gemsY;
        this._gemsEarnedText.x = this._gemIcon.x + 8;
        this._gemsEarnedText.y = gemsY;

        // Replay button (upper of the two buttons)
        const replayY = PANEL_HEIGHT - BUTTON_HEIGHT * 2 - 48 - 16;
        this._replayBtn.x = Math.round((PANEL_WIDTH - BUTTON_WIDTH) / 2);

        const continueY = replayY + BUTTON_HEIGHT + 16;
        // Continue button (lower)
        this._continueBtn.x = Math.round((PANEL_WIDTH - BUTTON_WIDTH) / 2);


        this._continueBtn.y = replayY;
        // Single button when RESPAWN is hidden (respawns exhausted) — sits
        // centered across the two-slot span instead of one of the two
        // original slots, so CONTINUE doesn't read as awkwardly offset.
        this._replayBtn.y = this._continueBtn.visible ? continueY : Math.round((replayY + continueY) / 2);
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
