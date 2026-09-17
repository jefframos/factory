// GameUI.ts
//
// The whole 2D UI this controller demo needs: one button, top-right,
// resetting the player back to spawn, plus a top-left money "pill" (icon +
// amount) fed by the world's Collectible pickups (see
// ControllerScene.buildCollectibles()/onCollectResource()). Positioned
// against Game.overlayScreenData.topRight/topLeft — the same "screen corner
// minus a fixed margin" convention bandit's own top-bar HUD uses for its
// currency container (see EconomyUI.ts/UIService.ts:
// `screen.topRight.x - panelWidth - MARGIN`, MARGIN = 16), added directly to
// the game's uiLayer rather than nested under the scene. No nine-slice
// button art exists in this controller's own asset set, so the button uses
// PIXI.Texture.WHITE + tint — the same placeholder convention bandit itself
// falls back to wherever it has no button art yet (see UIService.ts's own
// doc on this).
//
// The gain feedback (icon punch-scale + a rising "+N") is ported from
// bandit/legacy's EconomyUI.playGainFeedback() — same constants/easing.

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { Game } from 'core/Game';
import BaseButton from 'core/ui/BaseButton';
import { MONEY_PILE_SMALL, resolveCollectibleIconPath } from '../data/CollectibleSettings';

const MARGIN = 16;
const BUTTON_WIDTH = 140;
const BUTTON_HEIGHT = 44;

const ICON_SIZE = 28;
const ICON_LABEL_GAP = 8;

/** See bandit/legacy's EconomyUI.playGainFeedback() — same values, ported as-is. */
const JIGGLE_PUNCH_SCALE = 1.3;
const JIGGLE_PUNCH_SEC = 0.12;
const JIGGLE_SETTLE_SEC = 0.15;
const GAIN_POPUP_RISE_PX = 16;
const GAIN_POPUP_DURATION_SEC = 0.6;

export default class GameUI extends PIXI.Container {
    private readonly resetButton: BaseButton;
    private readonly moneyPill: PIXI.Container;
    private readonly moneyIcon: PIXI.Sprite;
    private readonly amountLabel: PIXI.Text;
    /** The `.scale` that renders the REAL loaded icon at ICON_SIZE — set once loadMoneyIcon() resolves. Until then the sprite has no texture to size against, so playGainFeedback()'s reset/tween targets use this instead of a hardcoded 1 (see this file's own history: hardcoding 1 there matched the sprite's scale only by accident, and broke as soon as width/height were computed against a real, non-square-pixel-for-pixel texture). */
    private moneyIconBaseScale = 1;

    public constructor(onReset: () => void) {
        super();

        this.resetButton = new BaseButton({
            standard: {
                texture: PIXI.Texture.WHITE,
                tint: 0x3a4a6b,
                width: BUTTON_WIDTH,
                height: BUTTON_HEIGHT,
                fontStyle: new PIXI.TextStyle({ fontSize: 20, fontWeight: 'bold', fill: 0xffffff }),
                fontColor: 0xffffff,
                fitText: 0.8,
            },
            over: { tint: 0x4d5f89 },
            down: { tint: 0x2a3654 },
            click: { tint: 0x2a3654, callback: onReset },
        }, new PIXI.Point(0, 0));
        this.resetButton.setLabel('Reset');

        this.moneyIcon = new PIXI.Sprite(PIXI.Texture.EMPTY);
        this.moneyIcon.anchor.set(0, 0.5);
        this.moneyIcon.position.set(0, ICON_SIZE / 2);
        void this.loadMoneyIcon();

        this.amountLabel = new PIXI.Text('0', new PIXI.TextStyle({
            fontSize: 24,
            fontWeight: 'bold',
            fill: 0xffe066,
            stroke: 0x000000,
            strokeThickness: 4,
        }));
        this.amountLabel.position.set(ICON_SIZE + ICON_LABEL_GAP, 0);

        this.moneyPill = new PIXI.Container();
        this.moneyPill.addChild(this.moneyIcon, this.amountLabel);

        this.addChild(this.resetButton, this.moneyPill);
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

    /** Called by ControllerScene once a flying pickup icon actually lands — see FlyingResourceIcon.ts's onArrive contract. Snaps the digits instantly (no count-up tween) and plays the same icon-punch + rising "+N" bandit/legacy's EconomyUI uses. */
    public setResourceCount(amount: number): void {
        const gained = amount - Number(this.amountLabel.text);
        this.amountLabel.text = amount.toString();

        if (gained > 0) {
            this.playGainFeedback(gained);
        }
    }

    /** In `game.uiLayer`'s own local space — GameUI itself is never transformed (see reposition(), which sets each child's absolute position directly), so a child's own `.position` already IS that space. Used as the flying icon's landing point (see ControllerScene.onCollectResource()). */
    public getMoneyIconOverlayPosition(): PIXI.Point {
        return new PIXI.Point(this.moneyPill.x + this.moneyIcon.x, this.moneyPill.y + this.moneyIcon.y);
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
        this.moneyPill.addChild(popup);

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

    /** Call whenever the viewport resizes (see ControllerScene.resize()) — keeps the button/pill pinned to their corners. */
    public reposition(): void {
        const screen = Game.overlayScreenData;
        if (!screen) {
            return;
        }
        this.resetButton.position.set(screen.topRight.x - BUTTON_WIDTH - MARGIN, screen.topRight.y + MARGIN);
        this.moneyPill.position.set(screen.topLeft.x + MARGIN, screen.topLeft.y + MARGIN);
    }
}
