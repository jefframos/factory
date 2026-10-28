// MoneyHud.ts
//
// The top-left money pill (library coin + dark resource bar + amount) â€” SHARED across every scene (Hub,
// RunnerMinigameScene, SwipeMinigameScene) via a single instance index.ts constructs once
// for the whole game session and adds directly to game.uiLayer, a sibling of whichever
// scene happens to be current rather than a child of any one of them. SceneManager fully
// destroy()s and rebuilds a scene on every changeScene() (see GameState.ts's own doc on
// this same problem for the money TOTAL) â€” if this lived inside GameUI (which is hub-only
// and rebuilt every time you leave/return to the hub) or inside a minigame scene, walking
// into a minigame would visibly destroy and re-create the counter, and any in-flight
// flying-coin icon would have nowhere to land. Living outside every scene's own display
// list means it simply never gets torn down.
//
// Split out of GameUI.ts (which now owns only the hub's own button stack) for exactly this
// reason. See CollectibleBuilder.ts's spawnCollectible() â€” every scene that places a
// Collectible (hub money piles, minigame coins) routes its payout through this same shared
// instance instead of owning its own counter.
//
// The gain feedback (icon punch-scale + a rising "+N") is ported from
// bandit/legacy's EconomyUI.playGainFeedback() â€” same constants/easing, unchanged from
// GameUI.ts's own original copy.

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { Game } from 'core/Game';
import { UiKit } from './UiKit';

const MARGIN = 16;
const ICON_SIZE = 46;
const PILL_HEIGHT = 36;
const PILL_MIN_WIDTH = 120;
/** The pill starts under the coin's centre so the coin overlaps its left end. */
const PILL_X = ICON_SIZE / 2;
const LABEL_X = ICON_SIZE + 6;

/** See bandit/legacy's EconomyUI.playGainFeedback() — same values, ported as-is. */
const JIGGLE_PUNCH_SCALE = 1.3;
const JIGGLE_PUNCH_SEC = 0.12;
const JIGGLE_SETTLE_SEC = 0.15;
const GAIN_POPUP_RISE_PX = 16;
const GAIN_POPUP_DURATION_SEC = 0.6;

export default class MoneyHud extends PIXI.Container {
    private readonly pill: PIXI.NineSlicePlane;
    private readonly moneyIcon: PIXI.Sprite;
    private readonly amountLabel: PIXI.Text;
    private readonly moneyIconBaseScale: number;
    private moneyIconFeedback?: gsap.core.Timeline;
    private readonly counter = { value: 0 };

    public constructor(initialAmount: number = 0) {
        super();

        this.pill = new PIXI.NineSlicePlane(PIXI.Texture.from('ResourceBar_Single_Bg'), 10, 10, 10, 10);
        this.pill.tint = 0x0d1a2b;
        this.pill.alpha = 0.7;
        this.pill.height = PILL_HEIGHT;
        this.pill.position.set(PILL_X, (ICON_SIZE - PILL_HEIGHT) / 2);

        this.moneyIcon = PIXI.Sprite.from('ItemIcon_Money_Bill');
        this.moneyIcon.anchor.set(0.5);
        this.moneyIcon.scale.set(ICON_SIZE / Math.max(this.moneyIcon.texture.width, this.moneyIcon.texture.height));
        this.moneyIconBaseScale = this.moneyIcon.scale.x;
        this.moneyIcon.position.set(ICON_SIZE / 2, ICON_SIZE / 2);

        this.amountLabel = new PIXI.Text(initialAmount.toString(), new PIXI.TextStyle({
            fontFamily: UiKit.fontFamily('primary'),
            fontSize: 26,
            fill: 0xffffff,
            stroke: 0x0d1a2b,
            strokeThickness: 4,
        }));
        this.amountLabel.anchor.set(0, 0.5);
        this.amountLabel.position.set(LABEL_X, ICON_SIZE / 2 + 1);

        this.addChild(this.pill, this.moneyIcon, this.amountLabel);
        this.fitPill();
        this.reposition();
    }

    private fitPill(): void {
        this.pill.width = Math.max(PILL_MIN_WIDTH, LABEL_X - PILL_X + this.amountLabel.width + 16);
    }

    /** The HUD coin texture — CollectibleBuilder.spawnCollectible() reuses it for the flying-collect icon so pickups land on a matching icon. */
    public getIconTexture(): PIXI.Texture | undefined {
        return this.moneyIcon.texture;
    }

    /** Called once a flying pickup icon actually lands — see FlyingResourceIcon.ts's onArrive contract. Snaps the digits instantly (no count-up tween) and plays the same icon-punch + rising "+N" bandit/legacy's EconomyUI uses. */
    public setResourceCount(amount: number): void {
        gsap.killTweensOf(this.counter);
        const gained = amount - Number(this.amountLabel.text);
        this.amountLabel.text = amount.toString();
        this.fitPill();

        if (gained > 0) {
            this.playGainFeedback(gained);
        }
    }

    /** Rolls the digits up to `amount` over `duration` (big payouts); the gain popup plays once, at the start. */
    public countTo(amount: number, duration: number): void {
        const from = Number(this.amountLabel.text);
        gsap.killTweensOf(this.counter);
        this.counter.value = from;
        if (amount > from) {
            this.playGainFeedback(amount - from);
        }
        gsap.to(this.counter, {
            value: amount,
            duration,
            ease: 'power1.out',
            onUpdate: () => {
                if (!this.amountLabel.destroyed) {
                    this.amountLabel.text = Math.round(this.counter.value).toString();
                    this.fitPill();
                }
            },
        });
    }

    /** Short icon punch without the "+N" popup — one per coin landing during countTo(). */
    public punchIcon(): void {
        const base = this.moneyIconBaseScale;
        if (this.moneyIconFeedback) {
            return;
        }
        gsap.killTweensOf(this.moneyIcon.scale);
        gsap.fromTo(this.moneyIcon.scale, { x: base * 1.2, y: base * 1.2 }, { x: base, y: base, duration: 0.15, ease: 'power1.out' });
    }

    /** In `game.uiLayer`'s own local space — this container's own `.position` (see reposition()) already IS that space, since it's added directly to uiLayer, not nested under a scene. Used as the flying icon's landing point (see CollectibleBuilder.spawnCollectible()). */
    public getMoneyIconOverlayPosition(): PIXI.Point {
        return new PIXI.Point(this.x + this.moneyIcon.x, this.y + this.moneyIcon.y);
    }

    private playGainFeedback(gained: number): void {
        const base = this.moneyIconBaseScale;
        this.moneyIconFeedback?.kill();
        gsap.killTweensOf(this.moneyIcon.scale);
        this.moneyIcon.scale.set(base);
        this.moneyIconFeedback = gsap.timeline({
            onComplete: () => {
                this.moneyIcon.scale.set(base);
                this.moneyIconFeedback = undefined;
            },
        })
            .to(this.moneyIcon.scale, { x: base * JIGGLE_PUNCH_SCALE, y: base * JIGGLE_PUNCH_SCALE, duration: JIGGLE_PUNCH_SEC, ease: 'back.out(2)' })
            .to(this.moneyIcon.scale, { x: base, y: base, duration: JIGGLE_SETTLE_SEC, ease: 'power1.out' });

        const popup = new PIXI.Text(`+${gained}`, new PIXI.TextStyle({
            fontFamily: UiKit.fontFamily('primary'),
            fontSize: 22,
            fill: 0x5dff7a,
            stroke: 0x0d3a1a,
            strokeThickness: 4,
        }));
        popup.anchor.set(0, 0.5);
        popup.position.set(LABEL_X, ICON_SIZE + 8);
        this.addChild(popup);

        const progress = { t: 0 };
        const baseY = popup.position.y;
        gsap.to(progress, {
            t: 1,
            duration: GAIN_POPUP_DURATION_SEC,
            ease: 'power2.out',
            onUpdate: () => {
                popup.position.y = baseY - progress.t * GAIN_POPUP_RISE_PX;
                popup.alpha = 1 - progress.t;
            },
            onComplete: () => popup.destroy(),
        });
    }

    /** Call whenever the viewport resizes (see index.ts's own onResize()) — keeps the pill pinned to its corner regardless of which scene is current. */
    public reposition(): void {
        const screen = Game.overlayScreenData;
        if (!screen) {
            return;
        }
        this.position.set(screen.topLeft.x + MARGIN, screen.topLeft.y + MARGIN);
    }
}
