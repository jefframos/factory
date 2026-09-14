// PowerupConfirmPopup.ts

import BaseButton from 'core/ui/BaseButton';
import ViewUtils from 'core/utils/ViewUtils';
import * as PIXI from 'pixi.js';
import { Signal } from 'signals';
import { formatPowerupName, getPowerup } from '../PowerupStorage';
import { PowerupButton } from './PowerupButton';
import InteractiveEventUtils from 'core/utils/InteractiveEventUtils';

// ─────────────────────────────────────────────────────────────────────────────
// Atlas-key constants — same frames GameOverPopup already uses, kept
// consistent with that popup's look rather than introducing new art.
// ─────────────────────────────────────────────────────────────────────────────
const ATLAS = {
    PANEL: 'ItemFrame03_Single_Purple',
    USE_STANDARD: 'Label_Parallelogram_Yellow',
    USE_DOWN: 'Label_Parallelogram_Hologram',
    CANCEL_STANDARD: 'Label_Parallelogram_Gray',
    CANCEL_DOWN: 'Label_Parallelogram_Gray',
    VIDEO_STANDARD: 'Label_Parallelogram_Hologram',
    VIDEO_DOWN: 'Label_Parallelogram_Hologram',
    VIDEO_DISABLED: 'Label_Parallelogram_Hologram',
    VIDEO_ICON: 'ItemIcon_Video-2',
} as const;

const PANEL_WIDTH = 460;
const PANEL_HEIGHT = 480;
const PANEL_NINE_SLICE_PADDING = 60;
const ICON_SIZE = 110;

const BUTTON_WIDTH = 380;
const BUTTON_HEIGHT = 66;
const BUTTON_PADDING = 35;

const FADE_DURATION_MS = 220;

const TITLE_STYLE: Partial<PIXI.ITextStyle> = {
    fontFamily: 'Baloo2-ExtraBold',
    fontSize: 34,
    fontWeight: 'bold',
    fill: 0xffffff,
    stroke: 0,
    strokeThickness: 4,
    dropShadow: true,
    dropShadowDistance: 2,
    dropShadowColor: 0x000000,
    dropShadowAlpha: 1,
    dropShadowAngle: 3.14 / 2,
};

const BUTTON_FONT_STYLE: Partial<PIXI.ITextStyle> = {
    ...TITLE_STYLE,
    fontSize: 28,
};

/**
 * "Use this powerup?" confirmation — shown before ANY HUD powerup tap
 * actually takes effect (see IslandViewScene.beginPowerupConfirm()). Same
 * dimmer+card+fade shape as GameOverPopup, just with the powerup's own icon
 * and name instead of score stats.
 *
 * Two modes, chosen by `showPopup()`'s `hasCount` argument: with at least
 * one in inventory, USE/CANCEL (spends it immediately); with zero, WATCH
 * VIDEO/CANCEL instead — same "grant then immediately apply" shape as
 * LevelUpNotification's own watch-video button, just for a single powerup
 * instead of doubling a level-up reward. Only one of USE/WATCH VIDEO is
 * ever visible at a time, occupying the same slot.
 */
export class PowerupConfirmPopup extends PIXI.Container {
    public readonly onConfirm = new Signal();
    public readonly onCancel = new Signal();
    public readonly onWatchVideo = new Signal();

    private readonly _dimmer: PIXI.Graphics;
    private readonly _card: PIXI.Container;
    private readonly _panel: PIXI.NineSlicePlane;
    private readonly _titleText: PIXI.Text;
    private readonly _iconSlot: PIXI.Container;
    private _icon: PIXI.Container | null = null;
    private readonly _useBtn: BaseButton;
    private readonly _videoBtn: BaseButton;
    private readonly _cancelBtn: BaseButton;

    private _prevTime = 0;
    private _fadeProgress = 0;
    private _fadingIn = false;
    private _fadingOut = false;

    private _viewWidth: number;
    private _viewHeight: number;

    public constructor(viewWidth: number, viewHeight: number) {
        super();

        this._viewWidth = viewWidth;
        this._viewHeight = viewHeight;

        this.visible = false;
        this.alpha = 0;

        this._dimmer = new PIXI.Graphics();
        this._dimmer.beginFill(0x000000, 0.65);
        this._dimmer.drawRect(-viewWidth * 2, -viewWidth * 2, viewWidth * 4, viewHeight * 4);
        this._dimmer.endFill();
        this.addChild(this._dimmer);

        InteractiveEventUtils.addClickTap(this._dimmer, () => {
            this.onCancel.dispatch()
        })

        this._card = new PIXI.Container();
        this.addChild(this._card);

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
        this._panel.interactive = true;

        this._titleText = new PIXI.Text('', new PIXI.TextStyle(TITLE_STYLE));
        this._titleText.anchor.set(0.5, 0);
        this._card.addChild(this._titleText);

        this._iconSlot = new PIXI.Container();
        this._card.addChild(this._iconSlot);

        this._useBtn = new BaseButton({
            standard: {
                width: BUTTON_WIDTH,
                height: BUTTON_HEIGHT,
                texturePadding: { bottom: 0, left: 35, right: 35, top: 0 },
                texture: PIXI.Texture.from(ATLAS.USE_STANDARD),
                fontStyle: new PIXI.TextStyle(BUTTON_FONT_STYLE),
            },
            over: { tint: 0xddffd0 },
            down: {
                texture: PIXI.Texture.from(ATLAS.USE_DOWN),
                tint: 0xaaaaaa,
            },
            click: {
                callback: () => this.onConfirm.dispatch(),
            },
        });
        this._card.addChild(this._useBtn);
        this._useBtn.setLabel('USE')

        this._videoBtn = new BaseButton({
            standard: {
                width: BUTTON_WIDTH,
                height: BUTTON_HEIGHT,
                texturePadding: { bottom: 0, left: 35, right: 35, top: 0 },
                texture: PIXI.Texture.from(ATLAS.VIDEO_STANDARD),
                label: 'WATCH VIDEO',
                fontStyle: new PIXI.TextStyle(BUTTON_FONT_STYLE),
                // Video icon on the left of the label — same layout GameOverPopup's own CONTINUE button uses.
                iconTexture: PIXI.Texture.from(ATLAS.VIDEO_ICON),
                iconSize: { width: 60, height: 60 },
                iconAnchor: new PIXI.Point(0, 0),
                centerIconVertically: true,
                iconOffset: new PIXI.Point(BUTTON_PADDING, -5),
                labelOffset: { x: 28, y: 0 },
            },
            over: { tint: 0xddffd0 },
            down: {
                texture: PIXI.Texture.from(ATLAS.VIDEO_DOWN),
                tint: 0xaaaaaa,
            },
            click: {
                callback: () => this.onWatchVideo.dispatch(),
            },
            disabled: {
                texture: PIXI.Texture.from(ATLAS.VIDEO_DISABLED),
                tint: 0x888888,
            },
        });
        this._videoBtn.setLabel('WATCH VIDEO')
        this._videoBtn.visible = false;
        this._card.addChild(this._videoBtn);

        this._cancelBtn = new BaseButton({
            standard: {
                width: BUTTON_WIDTH,
                height: BUTTON_HEIGHT,
                texturePadding: { bottom: 0, left: 35, right: 35, top: 0 },
                texture: PIXI.Texture.EMPTY,
                label: 'CANCEL',
                fontStyle: new PIXI.TextStyle(
                    { ...BUTTON_FONT_STYLE, fontSize: 22, fill: 0xaaaaaa }
                ),
            },
            over: { tint: 0xddddff },
            down: {
                //texture: PIXI.Texture.from(ATLAS.CANCEL_DOWN),
                tint: 0xcccccc,
            },
            click: {
                callback: () => this.onCancel.dispatch(),
            },
        });
        this._cancelBtn.setLabel('CANCEL')

        this._card.addChild(this._cancelBtn);

        this.layout();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Public API
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Show the popup for `powerupId` — swaps in its icon/name every call,
     * same as GameOverPopup.showPopup() re-populating its text each time.
     * `hasCount` picks the mode (see this class's own doc): true shows
     * USE, false shows WATCH VIDEO instead, in that same button slot.
     */
    public showPopup(powerupId: string, hasCount: boolean): void {
        this._titleText.text = formatPowerupName(powerupId).toUpperCase();

        this._useBtn.visible = hasCount;
        this._videoBtn.visible = !hasCount;
        this._videoBtn.enable();

        this._icon?.destroy();
        this._icon = PowerupConfirmPopup.buildIconFor(powerupId);
        this._iconSlot.addChild(this._icon);
        this.layout();

        this.visible = true;
        this.interactiveChildren = false;

        this._fadingOut = false;
        this._fadingIn = true;

        this._prevTime = performance.now();
    }

    /** Call while awaiting the platform's rewarded-video promise — disables WATCH VIDEO so a slow ad load can't be double-tapped, same convention as GameOverPopup.setContinueBusy()/LevelUpNotification.setWatchBusy(). */
    public setVideoBusy(busy: boolean): void {
        if (busy) {
            this._videoBtn.disable();
        } else {
            this._videoBtn.enable();
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

    /** Recompute positions — call after resizing the viewport. */
    public layout(): void {
        this._card.x = Math.round((this._viewWidth - PANEL_WIDTH) / 2);
        this._card.y = Math.round((this._viewHeight - PANEL_HEIGHT) / 2);

        const cx = PANEL_WIDTH / 2;

        this._titleText.x = cx;
        this._titleText.y = 40;

        if (this._icon) {
            this._icon.x = cx;
            this._icon.y = 175;
        }

        // USE and WATCH VIDEO share this same slot — only one is ever visible.
        const useY = PANEL_HEIGHT - BUTTON_HEIGHT * 2 - 48 - 16;
        this._useBtn.x = Math.round((PANEL_WIDTH - BUTTON_WIDTH) / 2);
        this._useBtn.y = useY;
        this._videoBtn.x = this._useBtn.x;
        this._videoBtn.y = useY;

        const cancelY = useY + BUTTON_HEIGHT + 16;
        this._cancelBtn.x = Math.round((PANEL_WIDTH - BUTTON_WIDTH) / 2);
        this._cancelBtn.y = cancelY;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // updateTransform — called every render frame by PixiJS, same fade-drive
    // convention as GameOverPopup (no Ticker/RAF wiring needed).
    // ─────────────────────────────────────────────────────────────────────────
    public override updateTransform(): void {
        if (this.visible) {
            const now = performance.now();
            const elapsed = this._prevTime > 0 ? (now - this._prevTime) / 1000 : 0;
            this._prevTime = now;

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
        }

        super.updateTransform();
    }

    public override destroy(options?: boolean | PIXI.IDestroyOptions): void {
        this.onConfirm.removeAll();
        this.onCancel.removeAll();
        this.onWatchVideo.removeAll();
        super.destroy(options);
    }

    private _easeOut(t: number): number {
        return 1 - (1 - t) * (1 - t);
    }

    /** Same icon-resolution rule TopPowerupSlots.buildIconFor()/PowerupBelt.buildPowerupIconFor() use — kept as its own small copy, same established convention (each widget's own icon size differs, nothing else in common worth factoring out). */
    private static buildIconFor(id: string): PIXI.Container {
        const powerup = getPowerup(id);

        if (!powerup) {
            return PowerupButton.buildPieceIcon('#ffffff', undefined, ICON_SIZE);
        }

        if (powerup.icon) {
            const sprite = PIXI.Sprite.from(powerup.icon);
            sprite.anchor.set(0.5);
            sprite.scale.set(ViewUtils.elementScaler(sprite, ICON_SIZE, ICON_SIZE));
            return sprite;
        }

        return PowerupButton.buildPieceIcon(powerup.piece.color, powerup.piece.polygon, ICON_SIZE);
    }
}
