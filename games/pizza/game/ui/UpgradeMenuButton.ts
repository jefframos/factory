// UpgradeMenuButton.ts
//
// Bottom-left backpack button that opens the upgrades menu (popups/UpgradesPopup.ts — what it
// sells and when: shop/UpgradeMenu.ts). Hidden until UpgradeMenu.isButtonUnlocked() (the FTUE
// is over and the first backpack upgrade is affordable), then there for good.
//
//   "!" badge   — something listed is affordable or new (UpgradeMenu.needsAttention());
//   pulse       — starts every time that badge comes up, stops when the player opens the menu
//                 (inside, the lesson's hand takes over — see UpgradesPopup.ts).
//
// Positioned by UIService (positionUpgradeMenuButton()); same "one field + update()/destroy()"
// shape as BackpackButton.

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import BaseButton from 'core/ui/BaseButton';
import { createLibraryButton } from './ButtonLibrary';
import { PopupManager } from './popups/PopupManager';
import UpgradesPopup from './popups/UpgradesPopup';
import { UpgradeMenu } from '../shop/UpgradeMenu';
import { GameAnalytics } from '../analytics/GameAnalytics';

export const UPGRADE_MENU_BUTTON_SIZE = 76;
const ICON_SIZE = 56;
const BADGE_TEXTURE = 'Icon_Exclamation';
const BADGE_SIZE = 30;
const PULSE_SCALE = 1.12;
const PULSE_SEC = 0.45;

export default class UpgradeMenuButton extends PIXI.Container {
    /** Scaled by the pulse — the button inside keeps its own hover/press scaling untouched. */
    private readonly pulseRoot = new PIXI.Container();
    private readonly button: BaseButton;
    private badgeShown = false;
    private pulsing = false;
    /** The player opened the menu since the badge last came up — the pulse stays off until it comes up again. */
    private openedSinceBadge = false;

    public constructor() {
        super();
        this.button = createLibraryButton({
            color: 'yellow',
            width: UPGRADE_MENU_BUTTON_SIZE, height: UPGRADE_MENU_BUTTON_SIZE,
            iconTexture: PIXI.Texture.from('survival-backpack'),
            iconSize: { width: ICON_SIZE, height: ICON_SIZE },
            // On CLICK, not STANDARD — see BackpackButton's own note.
            onClick: () => this.open(),
        });
        // Pulse around the button's center.
        this.pulseRoot.pivot.set(UPGRADE_MENU_BUTTON_SIZE / 2, UPGRADE_MENU_BUTTON_SIZE / 2);
        this.pulseRoot.position.set(UPGRADE_MENU_BUTTON_SIZE / 2, UPGRADE_MENU_BUTTON_SIZE / 2);
        this.pulseRoot.addChild(this.button);
        this.addChild(this.pulseRoot);
        this.visible = false;
    }

    private open(): void {
        this.openedSinceBadge = true;
        GameAnalytics.upgradeMenuOpened();
        PopupManager.instance.show(new UpgradesPopup());
    }

    /** Called every frame by UIService — visibility, badge and pulse from UpgradeMenu's state. */
    public update(): void {
        this.visible = UpgradeMenu.isButtonUnlocked();
        if (!this.visible) {
            return;
        }

        const attention = UpgradeMenu.needsAttention();
        if (attention && !this.badgeShown) {
            this.button.addAlertIcon(PIXI.Texture.from(BADGE_TEXTURE), BADGE_SIZE);
            this.openedSinceBadge = false;
        } else if (!attention && this.badgeShown) {
            this.button.removeAlertIcon();
        }
        this.badgeShown = attention;

        this.setPulsing(attention && !this.openedSinceBadge);
    }

    private setPulsing(on: boolean): void {
        if (on === this.pulsing) {
            return;
        }
        this.pulsing = on;
        gsap.killTweensOf(this.pulseRoot.scale);
        if (on) {
            gsap.to(this.pulseRoot.scale, { x: PULSE_SCALE, y: PULSE_SCALE, duration: PULSE_SEC, ease: 'sine.inOut', yoyo: true, repeat: -1 });
        } else {
            gsap.to(this.pulseRoot.scale, { x: 1, y: 1, duration: 0.15 });
        }
    }

    public override destroy(options?: Parameters<PIXI.Container['destroy']>[0]): void {
        gsap.killTweensOf(this.pulseRoot.scale);
        this.button.destroy();
        super.destroy(options);
    }
}
