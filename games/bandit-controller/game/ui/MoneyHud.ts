// MoneyHud.ts
//
// The top-left money "pill" (icon + amount) — SHARED across every scene (Hub,
// RunnerMinigameScene, SwipeMinigameScene) via a single instance index.ts constructs once
// for the whole game session and adds directly to game.uiLayer, a sibling of whichever
// scene happens to be current rather than a child of any one of them. SceneManager fully
// destroy()s and rebuilds a scene on every changeScene() (see GameState.ts's own doc on
// this same problem for the money TOTAL) — if this lived inside GameUI (which is hub-only
// and rebuilt every time you leave/return to the hub) or inside a minigame scene, walking
// into a minigame would visibly destroy and re-create the counter, and any in-flight
// flying-coin icon would have nowhere to land. Living outside every scene's own display
// list means it simply never gets torn down.
//
// Split out of GameUI.ts (which now owns only the hub's own button stack) for exactly this
// reason. See CollectibleBuilder.ts's spawnCollectible() — every scene that places a
// Collectible (hub money piles, minigame coins) routes its payout through this same shared
// instance instead of owning its own counter.
//
// The gain feedback (icon punch-scale + a rising "+N") is ported from
// bandit/legacy's EconomyUI.playGainFeedback() — same constants/easing, unchanged from
// GameUI.ts's own original copy.

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { Game } from 'core/Game';
import { MONEY_PILE_SMALL, resolveCollectibleIconPath } from '../data/CollectibleSettings';

const MARGIN = 16;
const ICON_SIZE = 28;
const ICON_LABEL_GAP = 8;

/** See bandit/legacy's EconomyUI.playGainFeedback() — same values, ported as-is. */
const JIGGLE_PUNCH_SCALE = 1.3;
const JIGGLE_PUNCH_SEC = 0.12;
const JIGGLE_SETTLE_SEC = 0.15;
const GAIN_POPUP_RISE_PX = 16;
const GAIN_POPUP_DURATION_SEC = 0.6;

export default class MoneyHud extends PIXI.Container {
    private readonly moneyIcon: PIXI.Sprite;
    private readonly amountLabel: PIXI.Text;
    /** The `.scale` that renders the REAL loaded icon at ICON_SIZE — set once loadMoneyIcon() resolves. Until then the sprite has no texture to size against, so playGainFeedback()'s reset/tween targets use this instead of a hardcoded 1 (see this file's own history, ported from GameUI.ts: hardcoding 1 there matched the sprite's scale only by accident, and broke as soon as width/height were computed against a real, non-square-pixel-for-pixel texture). */
    private moneyIconBaseScale = 1;

    public constructor(initialAmount: number = 0) {
        super();

        this.moneyIcon = new PIXI.Sprite(PIXI.Texture.EMPTY);
        this.moneyIcon.anchor.set(0, 0.5);
        this.moneyIcon.position.set(0, ICON_SIZE / 2);
        void this.loadMoneyIcon();

        this.amountLabel = new PIXI.Text(initialAmount.toString(), new PIXI.TextStyle({
            fontSize: 24,
            fontWeight: 'bold',
            fill: 0xffe066,
            stroke: 0x000000,
            strokeThickness: 4,
        }));
        this.amountLabel.position.set(ICON_SIZE + ICON_LABEL_GAP, 0);

        this.addChild(this.moneyIcon, this.amountLabel);
        this.reposition();
    }

    private async loadMoneyIcon(): Promise<void> {
        this.moneyIcon.texture = await PIXI.Assets.load<PIXI.Texture>(resolveCollectibleIconPath(MONEY_PILE_SMALL.icon));
        // Sizing has to happen AFTER the real texture lands — width/height setters compute
        // scale against whatever texture is current, and PIXI.Texture.EMPTY (0x0) would have
        // produced a bogus scale that then never got recomputed (see moneyIconBaseScale's doc).
        this.moneyIcon.width = ICON_SIZE;
        this.moneyIcon.height = ICON_SIZE;
        this.moneyIconBaseScale = this.moneyIcon.scale.x;
    }

    /**
     * The already-loaded icon texture — see CollectibleBuilder.spawnCollectible(), which
     * reuses THIS texture for the flying-collect icon rather than preloading a separate copy
     * of its own. Works because every CollectibleDefinition registered so far points at the
     * same icon path (see CollectibleDefinition.icon's own doc: one icon shared by the world
     * drop and the currency HUD) — a future collectible feeding a DIFFERENT counter would
     * need its own texture, not this one. Undefined until loadMoneyIcon() resolves.
     */
    public getIconTexture(): PIXI.Texture | undefined {
        return this.moneyIcon.texture === PIXI.Texture.EMPTY ? undefined : this.moneyIcon.texture;
    }

    /** Called once a flying pickup icon actually lands — see FlyingResourceIcon.ts's onArrive contract. Snaps the digits instantly (no count-up tween) and plays the same icon-punch + rising "+N" bandit/legacy's EconomyUI uses. */
    public setResourceCount(amount: number): void {
        const gained = amount - Number(this.amountLabel.text);
        this.amountLabel.text = amount.toString();

        if (gained > 0) {
            this.playGainFeedback(gained);
        }
    }

    /** In `game.uiLayer`'s own local space — this container's own `.position` (see reposition()) already IS that space, since it's added directly to uiLayer, not nested under a scene. Used as the flying icon's landing point (see CollectibleBuilder.spawnCollectible()). */
    public getMoneyIconOverlayPosition(): PIXI.Point {
        return new PIXI.Point(this.x + this.moneyIcon.x, this.y + this.moneyIcon.y);
    }

    private playGainFeedback(gained: number): void {
        const base = this.moneyIconBaseScale;
        gsap.killTweensOf(this.moneyIcon.scale);
        this.moneyIcon.scale.set(base);
        gsap.timeline()
            .to(this.moneyIcon.scale, { x: base * JIGGLE_PUNCH_SCALE, y: base * JIGGLE_PUNCH_SCALE, duration: JIGGLE_PUNCH_SEC, ease: 'back.out(2)' })
            .to(this.moneyIcon.scale, { x: base, y: base, duration: JIGGLE_SETTLE_SEC, ease: 'power1.out' });

        const popup = new PIXI.Text(`+${gained}`, new PIXI.TextStyle({
            fontSize: 20,
            fontWeight: 'bold',
            fill: 0x33cc66,
            stroke: 0x000000,
            strokeThickness: 3,
        }));
        popup.anchor.set(0, 1);
        popup.position.set(this.amountLabel.position.x, this.amountLabel.position.y);
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
