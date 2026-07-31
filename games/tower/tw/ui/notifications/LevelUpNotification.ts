// LevelUpNotification.ts

import SoundManager from 'core/audio/SoundManager';
import BaseButton from 'core/ui/BaseButton';
import { gsap } from 'gsap';
import * as PIXI from 'pixi.js';
import { Signal } from 'signals';
import Assets from '../../../Assets';
import { formatPowerupName, getPowerup, SKIP_PIECE_POWERUP_ID } from '../../PowerupStorage';
import { PowerupButton } from '../PowerupButton';
import { RewardContainer } from '../RewardContainer';
import { ConfettiEffect } from './ConfettiEffect';
import ViewUtils from 'core/utils/ViewUtils';

/** Seconds after the icon/name reveal before both buttons fade in — see revealReward(). */
const BUTTON_REVEAL_DELAY = 0.35;

/** Chest scale relative to its own native art size — see layout(). */
const REWARD_CHEST_SCALE = 1.1;

const ATLAS = {
    PANEL: 'ItemFrame03_Single_Purple',
    RIBBON: 'Title_Ribbon01_Sky',
    COLLECT_STANDARD: 'Label_Parallelogram_Yellow',
    COLLECT_DOWN: 'Label_Parallelogram_Yellow',
    WATCH_STANDARD: 'Label_Parallelogram_Hologram',
    WATCH_DOWN: 'Label_Parallelogram_Hologram',
    WATCH_DISABLED: 'Button01_s_Gray',
    WATCH_VIDEO_ICON: 'ItemIcon_Video-2',
    SCORE_SHINE: 'Image_Effect_Rotate',

} as const;

const PANEL_WIDTH = 520;
const PANEL_HEIGHT = 650;
const PANEL_NINE_SLICE_PADDING = 60;
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
const ICON_SIZE = 128;

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

const REWARD_STYLE: Partial<PIXI.ITextStyle> = {
    ...TITLE_STYLE,
    fontSize: 28,
};

const BUTTON_FONT_STYLE: Partial<PIXI.ITextStyle> = {
    ...TITLE_STYLE,
    fontSize: 22,
};

/**
 * "You leveled up — here's the powerup you earned" popup, structurally the
 * same shape as GameOverPopup (dimmer + card + panel + fade in/out via
 * updateTransform(), no external ticker needed) since the two read as the
 * same kind of moment — but shows the granted powerup's icon/name instead
 * of a score, and offers doubling the reward via a rewarded video instead
 * of a replay/continue-run choice. IslandViewScene owns the actual
 * grant/video-ad logic — this only dispatches onCollect/onWatchVideo and
 * renders whatever show()/showDoubled() are told.
 */
export class LevelUpNotification extends PIXI.Container {
    /** Dismiss, keeping whatever's already been granted (1x, or 2x if showDoubled() was already called). */
    public readonly onCollect = new Signal();
    /** Requests the rewarded-video double — see IslandViewScene, which awaits the platform's ad call and calls showDoubled()/re-enables the button depending on the result. */
    public readonly onWatchVideo = new Signal();

    private readonly dimmer: PIXI.Graphics;
    private readonly card: PIXI.Container;
    private readonly panel: PIXI.NineSlicePlane;
    /** Groups the ribbon graphic + the title text together — see the constructor. */
    private readonly titleContainer: PIXI.Container;
    private readonly ribbon: PIXI.NineSlicePlane;
    private readonly titleText: PIXI.Text;
    private readonly subtitleText: PIXI.Text;
    private readonly rewardLabel: PIXI.Text;
    private iconContainer: PIXI.Container;
    /** Chest prop — jiggles/bursts open, then reveals the icon/name (see show()/revealReward()) before the buttons appear. */
    private readonly rewardContainer = new RewardContainer();
    private readonly collectBtn: BaseButton;
    private readonly watchBtn: BaseButton;
    private readonly confetti: ConfettiEffect;

    private readonly _scoreShine: PIXI.Sprite;

    private powerupId = '';

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
        this.titleContainer.addChild(this.ribbon);

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

        // Chest added BEFORE the icon so the icon renders in front of it —
        // the powerup should pop out on top of the chest, not behind it.
        this.card.addChild(this.rewardContainer);

        this.iconContainer = new PIXI.Container();
        this.card.addChild(this.iconContainer);

        this.rewardLabel = new PIXI.Text('', new PIXI.TextStyle(REWARD_STYLE));
        this.rewardLabel.anchor.set(0.5, 0);
        this.card.addChild(this.rewardLabel);

        this.watchBtn = new BaseButton({
            standard: {
                width: BUTTON_WIDTH,
                height: BUTTON_HEIGHT,
                allPadding: BUTTON_PADDING,
                texture: PIXI.Texture.from(ATLAS.WATCH_STANDARD),
                fontStyle: new PIXI.TextStyle({ ...BUTTON_FONT_STYLE, fontSize: 38 }),
                iconTexture: PIXI.Texture.from(ATLAS.WATCH_VIDEO_ICON),
                iconSize: { width: 60, height: 60 },
                iconAnchor: new PIXI.Point(0, 0),
                centerIconVertically: true,
                textOffset: { x: 0, y: -3 },
                iconOffset: new PIXI.Point(BUTTON_PADDING, -5),
            },
            over: { tint: 0xddffd0 },
            down: { texture: PIXI.Texture.from(ATLAS.WATCH_DOWN), tint: 0xaaaaaa },
            click: { callback: () => this.onWatchVideo.dispatch() },
            disabled: { texture: PIXI.Texture.from(ATLAS.WATCH_DISABLED), tint: 0x888888 },
        } as any);
        this.card.addChild(this.watchBtn);

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

    /**
     * Shows the popup for `levelIndex`/`powerupId` — the chest appears
     * closed, jiggles, then bursts open (see RewardContainer.open()); only
     * once the lid actually pops does the icon/name reveal (revealReward()),
     * and only a beat after THAT do both buttons fade in. Resets to the
     * single-reward (not-yet-doubled) state. `videoBonusAmount` is how many
     * copies watching the video actually grants (see IslandViewScene's
     * REWARD_VIDEO_BONUS_AMOUNT) — shown on the watch button itself
     * ("x3") so it never drifts out of sync with the real reward.
     */
    public show(levelIndex: number, powerupId: string, videoBonusAmount: number): void {
        this.powerupId = powerupId;
        this.subtitleText.text = `Level ${levelIndex + 1}`;
        this.watchBtn.setLabel(`x${videoBonusAmount} CLAIM`);

        this.iconContainer.visible = false;
        this.rewardLabel.visible = false;
        this.watchBtn.visible = false;
        this.collectBtn.visible = false;

        this.rewardContainer.visible = true;
        this.rewardContainer.initContainer();
        this.rewardContainer.open(() => this.revealReward(powerupId));

        this.visible = true;
        this.interactiveChildren = false;
        this.fadingOut = false;
        this.fadingIn = true;
        this.prevTime = performance.now();

        this.layout();
    }

    /** Fires the instant the chest's lid pops open (see RewardContainer.open()) — reveals the icon/name, fires the screen-wide confetti, and queues both buttons to fade in a beat later. */
    private revealReward(powerupId: string): void {
        this.rewardLabel.text = `+1 ${formatPowerupName(powerupId)}`;
        this.rebuildIcon(powerupId);

        this.iconContainer.visible = true;
        this.iconContainer.scale.set(0.4);
        this.rewardLabel.visible = true;
        this.rewardLabel.alpha = 0;

        gsap.to(this.iconContainer.scale, { x: 1, y: 1, duration: 0.35, ease: 'back.out(3)' });
        gsap.to(this.rewardLabel, { alpha: 1, duration: 0.25 });

        this.confetti.play();
        SoundManager.instance.tryToPlaySound(Assets.Sounds.Game.Wee);

        gsap.delayedCall(BUTTON_REVEAL_DELAY, () => {
            this.watchBtn.visible = true;
            this.watchBtn.enable();
            this.collectBtn.visible = true;
            this.layout();
        });
    }

    /** Call once the rewarded video actually completes — bumps the shown reward to x2 and retires the watch button (only COLLECT remains). */
    public showDoubled(): void {
        this.rewardLabel.text = `+2 ${formatPowerupName(this.powerupId)}!`;
        this.watchBtn.visible = false;
        this.layout();
    }

    /** Call if the video was cancelled/failed — re-enables the watch button so the player can try again, rather than getting stuck on a spent tap. */
    public reenableWatch(): void {
        this.watchBtn.enable();
    }

    public setWatchBusy(busy: boolean): void {
        if (busy) {
            this.watchBtn.disable();
        } else {
            this.watchBtn.enable();
        }
    }

    /** Global (stage-space) position of the granted-powerup icon — for TowerRewardFlyUtils to fly copies of it toward the powerup belt from the exact spot it's currently shown at. */
    public getIconGlobalPosition(): { x: number; y: number } {
        const point = this.iconContainer.getGlobalPosition();
        return { x: point.x, y: point.y };
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
        this.titleText.position.set(cx, RIBBON_HEIGHT * 0.5 + this.ribbon.y - 10);

        this.subtitleText.position.set(cx, RIBBON_HEIGHT + 4 + 20);

        this.iconContainer.position.set(cx, 320);
        this.rewardContainer.position.set(cx, 320);
        this.rewardContainer.scale.set(REWARD_CHEST_SCALE);

        this._scoreShine.x = this.iconContainer.x
        this._scoreShine.y = this.iconContainer.y

        this.rewardLabel.position.set(cx, this.iconContainer.position.y + 50);

        const watchY = PANEL_HEIGHT - BUTTON_HEIGHT * 2 - 48 - 16;
        this.watchBtn.position.set(Math.round((PANEL_WIDTH - BUTTON_WIDTH) / 2), watchY);

        const collectY = this.watchBtn.visible ? watchY + BUTTON_HEIGHT + 16 : watchY;
        this.collectBtn.position.set(Math.round((PANEL_WIDTH - BUTTON_WIDTH) / 2), collectY);
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

            if (this.rewardContainer.visible) {
                this.rewardContainer.update(elapsed);
            }
        }


        super.updateTransform();
    }

    private rebuildIcon(powerupId: string): void {
        this.iconContainer.removeChildren().forEach(child => child.destroy());

        const icon = powerupId === SKIP_PIECE_POWERUP_ID
            ? PowerupButton.buildSkipIcon(ICON_SIZE)
            : LevelUpNotification.buildPowerupIcon(powerupId, ICON_SIZE);

        this.iconContainer.addChild(icon);
    }

    private static buildPowerupIcon(id: string, size: number): PIXI.Container {
        const powerup = getPowerup(id);

        if (!powerup) {
            return PowerupButton.buildPieceIcon('#ffffff', undefined, size);
        }

        if (powerup.icon) {
            const sprite = PIXI.Sprite.from(powerup.icon);
            sprite.anchor.set(0.5);
            sprite.scale.set(ViewUtils.elementScaler(sprite, size));
            return sprite;
        }

        return PowerupButton.buildPieceIcon(powerup.piece.color, powerup.piece.polygon, size);
    }

    private static easeOut(t: number): number {
        return 1 - (1 - t) * (1 - t);
    }

    public override destroy(options?: boolean | PIXI.IDestroyOptions): void {
        gsap.killTweensOf(this.iconContainer.scale);
        gsap.killTweensOf(this.rewardLabel);
        super.destroy(options ?? { children: true });
    }
}
