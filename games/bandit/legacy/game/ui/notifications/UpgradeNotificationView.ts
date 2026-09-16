// UpgradeNotificationView.ts
//
// The visual + animation half of the big center-upper callout — everything
// about WHAT it looks like and HOW it moves lives here; UpgradeNotificationManager
// (see that file's own doc) only knows "build one of these, park it somewhere,
// await play(), move on to the next queued one." Splitting it this way means
// retuning the ribbon/badge/spin layout or the enter/hold/exit timing never
// touches the manager, and the manager's queueing/positioning logic never
// touches this.
//
// Composition, TOP TO BOTTOM: a ribbon (color/art picked from `options.type`
// via UpgradeStyle.ribbonTextureFor() — see that file's own doc; every
// variant shares this same size) stretched as a 9-slice (150px left/right
// padding so the corners/edge art never squishes, no vertical padding since
// the ribbon is never stretched taller than its own art) reading just
// "UPGRADE!", centered with a -20 y offset; then, hanging off the ribbon's
// own bottom edge, a badge (color/art picked from `options.rarity` via
// UpgradeStyle.badgeTextureFor()) holding the target's icon (if it has one),
// with Image_Effect_Rotate spinning slowly behind it for a "shiny" reveal;
// then a caption line below the badge naming exactly what got upgraded
// ("AXE LEVEL 2").

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { TextStyleRegistry } from '../TextStyleRegistry';
import { NotificationRarity, NotificationType } from './NotificationTypes';
import { UpgradeStyle } from './UpgradeStyle';

/** NineSlicePlane border widths for Title_Ribbon01_Blue — see this file's own doc. */
const RIBBON_PADDING_X = 150;
/** The ribbon's own unstretched art size (see public/pizza/images/ui.webp.json) — height never changes, width grows to fit the label. */
const RIBBON_NATURAL_SIZE = { width: 304, height: 143 };
/** Never shrink the ribbon narrower than its own art, even for a short label — avoids inverting/squishing the 9-slice's stretch region. */
const RIBBON_MIN_WIDTH = RIBBON_NATURAL_SIZE.width;

const TITLE_Y_OFFSET = -15;

/** How far the badge's center hangs below the ribbon's own bottom edge — a small overlap (rather than sitting flush against it) reads as "hanging off" the ribbon instead of just floating underneath it. */
const BADGE_Y_OFFSET = RIBBON_NATURAL_SIZE.height / 2 + 60;
const BADGE_NATURAL_SIZE = { width: 129, height: 132 };
/** Target icon's size relative to the badge it sits inside — leaves a visible ring of badge art around it. */
const ICON_SIZE_RATIO = 0.62;
/** Gap between the badge's own bottom edge and the caption line under it. */
const CAPTION_GAP = 14;

const SPIN_EFFECT_SIZE = BADGE_NATURAL_SIZE.width * 1.5;
const SPIN_DURATION_SEC = 8;

const ENTER_DURATION_SEC = 0.5;
const HOLD_DURATION_SEC = 2.4;
const EXIT_DURATION_SEC = 0.4;
/** How far above its resting spot the notification starts (enter) / ends up (exit). */
const TRAVEL_DISTANCE = 160;

export interface UpgradeNotificationOptions {
    /** Which kind of event this is — picks the ribbon color/art via UpgradeStyle.ribbonTextureFor(). */
    type: NotificationType;
    /** How rare this particular upgrade is — picks the badge color/art via UpgradeStyle.badgeTextureFor(). */
    rarity: NotificationRarity;
    /** Shown inside the badge hanging off the ribbon — omitted entirely (badge still shows, just empty) if the target has no icon, per the brief's "if the icon exists." */
    icon?: PIXI.Texture;
    /** The ribbon's own text — always "UPGRADE!" today, kept as a param rather than hardcoded in case a future caller needs a different headline. */
    title: string;
    /** Caption below the badge naming exactly what got upgraded, e.g. "AXE LEVEL 2". */
    subtitle: string;
}

export default class UpgradeNotificationView extends PIXI.Container {
    /** The infinite spin tween on the shine sprite — killed explicitly before destroy() (see hide()'s own doc for why that ordering matters). */
    private readonly spinTween: gsap.core.Tween;

    public constructor(options: UpgradeNotificationOptions) {
        super();

        const title = new PIXI.Text(options.title, { ...TextStyleRegistry.Title, align: 'center' } as PIXI.TextStyle);
        title.anchor.set(0.5, 0.5);

        const ribbonWidth = Math.max(RIBBON_MIN_WIDTH, title.width + RIBBON_PADDING_X * 2);
        const ribbon = new PIXI.NineSlicePlane(PIXI.Texture.from(UpgradeStyle.ribbonTextureFor(options.type)), RIBBON_PADDING_X, 0, RIBBON_PADDING_X, 0);
        ribbon.width = ribbonWidth;
        ribbon.height = RIBBON_NATURAL_SIZE.height;
        ribbon.position.set(-ribbonWidth / 2, -RIBBON_NATURAL_SIZE.height / 2);

        title.position.set(0, TITLE_Y_OFFSET);


        // Spins continuously behind the badge — added before it so the badge/icon render on top.
        const spinEffect = new PIXI.Sprite(PIXI.Texture.from('Image_Effect_Rotate'));
        spinEffect.anchor.set(0.5, 0.5);
        spinEffect.width = SPIN_EFFECT_SIZE;
        spinEffect.height = SPIN_EFFECT_SIZE;
        spinEffect.position.set(0, BADGE_Y_OFFSET);
        this.addChild(spinEffect);
        this.spinTween = gsap.to(spinEffect, { rotation: Math.PI * 2, duration: SPIN_DURATION_SEC, repeat: -1, ease: 'none' });

        const badge = new PIXI.Sprite(PIXI.Texture.from(UpgradeStyle.badgeTextureFor(options.rarity)));
        badge.anchor.set(0.5, 0.5);
        badge.width = BADGE_NATURAL_SIZE.width;
        badge.height = BADGE_NATURAL_SIZE.height;
        badge.position.set(0, BADGE_Y_OFFSET);
        this.addChild(badge);

        if (options.icon) {
            const icon = new PIXI.Sprite(options.icon);
            icon.anchor.set(0.5, 0.5);
            icon.width = BADGE_NATURAL_SIZE.width * ICON_SIZE_RATIO;
            icon.height = BADGE_NATURAL_SIZE.height * ICON_SIZE_RATIO;
            icon.position.set(0, BADGE_Y_OFFSET);
            this.addChild(icon);
        }

        const caption = new PIXI.Text(options.subtitle, TextStyleRegistry.Notification);
        caption.anchor.set(0.5, 0);
        caption.position.set(0, BADGE_Y_OFFSET + BADGE_NATURAL_SIZE.height / 2 + CAPTION_GAP);
        this.addChild(caption);

        this.addChild(ribbon);
        this.addChild(title);
    }

    /**
     * The whole show/hold/hide lifecycle — drops in at `restPosition` (springing up from
     * TRAVEL_DISTANCE below it), holds, then slides back down and fades out, destroying this
     * view once the exit finishes. The caller (UpgradeNotificationManager) just awaits this
     * and moves on to whatever's next in its queue — it never has to know the timing/easing
     * details, only that the view is done and gone once this resolves.
     */
    public play(restPosition: PIXI.IPointData): Promise<void> {
        this.position.set(restPosition.x, restPosition.y - TRAVEL_DISTANCE);
        this.alpha = 0;

        return new Promise(resolve => {
            const timeline = gsap.timeline({ onComplete: () => this.hide(resolve) });
            timeline.to(this, { y: restPosition.y, alpha: 1, duration: ENTER_DURATION_SEC, ease: 'back.out(1.7)' });
            timeline.to(this, { duration: HOLD_DURATION_SEC });
            timeline.to(this, { y: restPosition.y - TRAVEL_DISTANCE, alpha: 0, duration: EXIT_DURATION_SEC, ease: 'sine.in' });
        });
    }

    /**
     * Kills the spin tween BEFORE destroying — otherwise gsap's next tick tries to write
     * .rotation onto the shine sprite's transform after destroy() has already nulled it out,
     * throwing straight out of the render loop (see this class's own history: that's exactly
     * what broke before this got split out of the manager).
     */
    private hide(resolve: () => void): void {
        this.spinTween.kill();
        this.destroy({ children: true });
        resolve();
    }
}
