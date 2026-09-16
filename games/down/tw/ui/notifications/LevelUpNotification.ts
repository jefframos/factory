// LevelUpNotification.ts

import * as PIXI from 'pixi.js';
import { Signal } from 'signals';
import BaseButton from 'core/ui/BaseButton';
import { ConfettiEffect } from './ConfettiEffect';

const ATLAS = {
    PANEL: 'ItemFrame01_Single_Hologram1',
    RIBBON: 'Title_Ribbon01_Plum',
    COLLECT_STANDARD: 'Label_Parallelogram_Yellow',
    COLLECT_DOWN: 'Label_Parallelogram_Yellow',
    SCORE_SHINE: 'Image_Effect_Rotate',
    GEM_ICON: 'ResourceBar_Single_Icon_Gem',

} as const;

const GEM_ICON_SIZE = 44;

const PANEL_WIDTH = 520;
const PANEL_HEIGHT = 520;
const PANEL_NINE_SLICE_PADDING = 30;
const SHINE_ROTATION_SPEED = 0.4; // radians per second

// Ribbon (see ATLAS.RIBBON) sits behind the title text — 150px inset on
// each side, flush top-to-bottom (no vertical padding) within its own row.
const RIBBON_PADDING_X = -140;
const RIBBON_HEIGHT = 143;
const RIBBON_NINE_SLICE_PADDING = 150;

const BUTTON_WIDTH = 420;
const BUTTON_HEIGHT = 66;
const BUTTON_PADDING = 35;

const FADE_DURATION_MS = 280;

const TITLE_STYLE: Partial<PIXI.ITextStyle> = {
    fontFamily: 'Baloo2-ExtraBold',
    fontSize: 52,
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

const SUBTITLE_STYLE: Partial<PIXI.ITextStyle> = {
    ...TITLE_STYLE,
    fontSize: 28,
    fill: 0xffe066,
};

/** "+N" gems-earned line — see show()'s gemsEarned param. */
const GEMS_EARNED_STYLE: Partial<PIXI.ITextStyle> = {
    ...TITLE_STYLE,
    fontSize: 40,
    fill: 0x7fe3ff,
};

const BUTTON_FONT_STYLE: Partial<PIXI.ITextStyle> = {
    ...TITLE_STYLE,
    fontSize: 22,
};

/**
 * Plain "Level Up!" milestone celebration, structurally the same shape as
 * GameOverPopup (dimmer + card + panel + fade in/out via updateTransform(),
 * no external ticker needed). No reward attached — powerups are gem-
 * purchased now (see IslandViewScene.useHudPowerup) rather than granted
 * here, so this only dispatches onCollect and renders whatever show() is
 * told.
 */
export class LevelUpNotification extends PIXI.Container {
    /** Dismiss — see IslandViewScene, which resumes the run once this fires. */
    public readonly onCollect = new Signal();

    private readonly dimmer: PIXI.Graphics;
    private readonly card: PIXI.Container;
    private readonly panel: PIXI.NineSlicePlane;
    /** Groups the ribbon graphic + the title text together — see the constructor. */
    private readonly titleContainer: PIXI.Container;
    private readonly ribbon: PIXI.NineSlicePlane;
    private readonly titleText: PIXI.Text;
    private readonly subtitleText: PIXI.Text;
    private readonly gemIcon: PIXI.Sprite;
    private readonly gemsEarnedText: PIXI.Text;
    private readonly collectBtn: BaseButton;
    private readonly confetti: ConfettiEffect;

    private readonly _scoreShine: PIXI.Sprite;

    private _shineAngle: number = 0;

    private prevTime = 0;
    private fadeProgress = 0;
    private fadingIn = false;
    private fadingOut = false;

    public constructor(private readonly viewWidth: number, private readonly viewHeight: number) {
        super();

        this.visible = false;
        this.alpha = 0;

        this.dimmer = new PIXI.Graphics();
        this.dimmer.beginFill(0x000000, 0.65);
        this.dimmer.drawRect(-viewWidth * 2, -viewWidth * 2, viewWidth * 4, viewHeight * 4);
        this.dimmer.endFill();
        this.addChild(this.dimmer);

        this.card = new PIXI.Container();
        this.addChild(this.card);

        this.panel = new PIXI.NineSlicePlane(
            PIXI.Texture.from(ATLAS.PANEL),
            PANEL_NINE_SLICE_PADDING, PANEL_NINE_SLICE_PADDING, PANEL_NINE_SLICE_PADDING, PANEL_NINE_SLICE_PADDING,
        );
        this.panel.width = PANEL_WIDTH;
        this.panel.height = PANEL_HEIGHT;
        this.card.addChild(this.panel);

        this.titleContainer = new PIXI.Container();
        this.card.addChild(this.titleContainer);

        this._scoreShine = new PIXI.Sprite(PIXI.Texture.from(ATLAS.SCORE_SHINE));
        this._scoreShine.anchor.set(0.5);
        this.card.addChild(this._scoreShine);

        this.ribbon = new PIXI.NineSlicePlane(
            PIXI.Texture.from(ATLAS.RIBBON),
            RIBBON_NINE_SLICE_PADDING, 0, RIBBON_NINE_SLICE_PADDING, 0,
        );
        // this.titleContainer.addChild(this.ribbon);

        this.titleText = new PIXI.Text('LEVEL UP!', new PIXI.TextStyle({
            ...TITLE_STYLE,
            wordWrap: true,
            wordWrapWidth: PANEL_WIDTH - RIBBON_PADDING_X * 2 - 20,
            align: 'center',
        }));
        this.titleText.anchor.set(0.5, 0.5);
        this.titleContainer.addChild(this.titleText);

        this.subtitleText = new PIXI.Text('', new PIXI.TextStyle(SUBTITLE_STYLE));
        this.subtitleText.anchor.set(0.5, 0);
        this.card.addChild(this.subtitleText);

        this.gemIcon = PIXI.Sprite.from(ATLAS.GEM_ICON);
        this.gemIcon.anchor.set(1, 0.5);
        this.gemIcon.scale.set(GEM_ICON_SIZE / Math.max(this.gemIcon.texture.width, this.gemIcon.texture.height));
        this.card.addChild(this.gemIcon);

        this.gemsEarnedText = new PIXI.Text('', new PIXI.TextStyle(GEMS_EARNED_STYLE));
        this.gemsEarnedText.anchor.set(0, 0.5);
        this.card.addChild(this.gemsEarnedText);

        this.collectBtn = new BaseButton({
            standard: {
                width: BUTTON_WIDTH,
                height: BUTTON_HEIGHT,
                allPadding: BUTTON_PADDING,
                texture: PIXI.Texture.from(ATLAS.COLLECT_STANDARD),
                textOffset: { x: 0, y: -3 },
                fontStyle: new PIXI.TextStyle({ ...BUTTON_FONT_STYLE, fontSize: 32 }),
            },
            over: { tint: 0xddddff },
            down: { texture: PIXI.Texture.from(ATLAS.COLLECT_DOWN), tint: 0xcccccc },
            click: { callback: () => this.onCollect.dispatch() },
        } as any);
        this.collectBtn.setLabel('CLAIM');
        this.card.addChild(this.collectBtn);

        this.confetti = new ConfettiEffect(viewWidth);
        this.addChild(this.confetti);

        this.layout();
    }

    /** Shows the popup for `levelIndex` with the `gemsEarned` already granted (see IslandViewScene's onLevelProgressed) — confetti and the CLAIM button appear immediately (no reward reveal to wait on). */
    public show(levelIndex: number, gemsEarned: number): void {
        this.subtitleText.text = `Level ${levelIndex + 1}`;
        this.gemsEarnedText.text = `+${gemsEarned}`;

        this.visible = true;
        this.interactiveChildren = false;
        this.fadingOut = false;
        this.fadingIn = true;
        this.prevTime = performance.now();

        this.confetti.play();

        this.layout();
    }

    public hide(): void {
        if (!this.visible) {
            return;
        }

        this.interactiveChildren = false;
        this.fadingIn = false;
        this.fadingOut = true;
        this.prevTime = performance.now();
    }

    public layout(): void {
        this.card.x = Math.round((this.viewWidth - PANEL_WIDTH) / 2);
        this.card.y = Math.round((this.viewHeight - PANEL_HEIGHT) / 2) - 50;

        const cx = PANEL_WIDTH * 0.5;

        this.titleContainer.position.set(0, 0);
        this.ribbon.width = PANEL_WIDTH - RIBBON_PADDING_X * 2;
        this.ribbon.height = RIBBON_HEIGHT;
        this.ribbon.position.set(RIBBON_PADDING_X, 40);
        this.titleText.position.set(cx, RIBBON_HEIGHT * 0.5 + this.ribbon.y - 50);

        this.subtitleText.position.set(cx, this.titleText.y + 30);

        this._scoreShine.x = cx;
        this._scoreShine.y = 260;

        // Gems-earned pair (icon left of the "+N" text), centered on the
        // panel as a pair, sitting right in front of the shine above.
        const gemsPairWidth = this.gemIcon.width + 8 + this.gemsEarnedText.width;
        this.gemIcon.x = cx - gemsPairWidth / 2 + this.gemIcon.width;
        this.gemIcon.y = this._scoreShine.y;
        this.gemsEarnedText.x = this.gemIcon.x + 8;
        this.gemsEarnedText.y = this._scoreShine.y;

        this.collectBtn.position.set(Math.round((PANEL_WIDTH - BUTTON_WIDTH) / 2), PANEL_HEIGHT - BUTTON_HEIGHT - 48);
    }

    public override updateTransform(): void {
        if (this.visible) {
            const now = performance.now();
            const elapsed = this.prevTime > 0 ? (now - this.prevTime) / 1000 : 0;
            this.prevTime = now;

            if (this.fadingIn) {
                this.fadeProgress += elapsed / (FADE_DURATION_MS / 1000);

                if (this.fadeProgress >= 1) {
                    this.fadeProgress = 1;
                    this.fadingIn = false;
                    this.interactiveChildren = true;
                }

                this.alpha = LevelUpNotification.easeOut(this.fadeProgress);
            } else if (this.fadingOut) {
                this.fadeProgress -= elapsed / (FADE_DURATION_MS / 1000);

                if (this.fadeProgress <= 0) {
                    this.fadeProgress = 0;
                    this.fadingOut = false;
                    this.visible = false;
                    this.alpha = 0;
                } else {
                    this.alpha = LevelUpNotification.easeOut(this.fadeProgress);
                }
            }
            if (this.alpha > 0) {
                this._shineAngle += SHINE_ROTATION_SPEED * elapsed;
                this._scoreShine.rotation = this._shineAngle;
            }
        }

        super.updateTransform();
    }

    private static easeOut(t: number): number {
        return 1 - (1 - t) * (1 - t);
    }

    public override destroy(options?: boolean | PIXI.IDestroyOptions): void {
        super.destroy(options ?? { children: true });
    }
}
