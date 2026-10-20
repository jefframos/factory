// UpgradesPopup.ts
//
// The upgrades menu (see shop/UpgradeMenu.ts for what's listed and when), opened by the
// bottom-left backpack button (ui/UpgradeMenuButton.ts). One row per tool:
//
//   [icon]  Backpack   Lv 1 → 2                         [ Buy ]
//           Carry 4 → 5
//           (coin) 60   (wood) 4/10            <- red when the player is short
//           then: 120 · 25 wood                <- the level after, so the next goal is visible
//
// MAX instead of Buy at the top of a ladder, NEW on a row the player hasn't seen with the menu
// open (they're marked seen when it closes). The first time (UpgradeMenu.isLessonPending()) a hand
// bobs over the backpack's Buy button. A purchase plays a small "+1" pop over its row here —
// no tap-to-continue notification, those pause the world and can't be tapped through a popup.
//
// Re-renders on any money / backpack / level change while open. Row look matches FarmUpgradesPopup.

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import Popup from './Popup';
import PanelBackground, { PANEL_CONTENT_MARGIN } from '../PanelBackground';
import ScrollView from '../ScrollView';
import { TextStyleRegistry } from '../TextStyleRegistry';
import { createLibraryButton } from '../ButtonLibrary';
import { EconomyStorage } from '../../data/EconomyStorage';
import { CURRENCY_CONFIG, CurrencyType } from '../../data/EconomyTypes';
import { BackpackStorage } from '../../data/BackpackStorage';
import { getAssetIcon } from '../../world/AssetLibraryRegistry';
import { resolveResourceAssetKey } from '../../actions/ResourceRegistry';
import { ResourceType } from '../../actions/ResourceTypes';
import { getToolIcon } from '../../actions/ToolRegistry';
import { ShopUpgradeStorage } from '../../shop/ShopUpgradeStorage';
import { UpgradeMenuStorage } from '../../shop/UpgradeMenuStorage';
import { FIRST_UPGRADE_SHOP_ID, UpgradeMenu, UpgradeMenuEntry } from '../../shop/UpgradeMenu';
import { ShopCost } from '../../shop/ShopTypes';

const BODY_WIDTH = 500;
const BODY_HEIGHT = 420;
const CONTENT_WIDTH = BODY_WIDTH - PANEL_CONTENT_MARGIN * 2;
const CONTENT_HEIGHT = BODY_HEIGHT - PANEL_CONTENT_MARGIN * 2;

const ROW_HEIGHT = 104;
const ROW_GAP = 10;
const ICON_SIZE = 56;
const ICON_GAP = 12;
const BUTTON_WIDTH = 104;
const BUTTON_HEIGHT = 44;
const CHIP_ICON_SIZE = 20;
const CHIP_GAP = 14;

const COLOR_UP = '#33cc66';
const COLOR_MAX = '#f5c542';
const COLOR_SHORT = '#ff6b6b';
const COLOR_NEW = '#ffd34d';

/** The lesson's pointer — same hand the zone tutorials use. */
const HAND_TEXTURE = 'tutorialHand2';
const HAND_SIZE = 64;
/** Where the fingertip sits in the hand art (128x128, pointing down). */
const HAND_TIP_ANCHOR = { x: 0.58, y: 0.95 };

export default class UpgradesPopup extends Popup {
    private declare contentArea: PIXI.Container;
    private declare scrollView: ScrollView;
    /** Above the rows, not cleared by render() — the lesson hand and purchase pops live here. */
    private declare overlay: PIXI.Container;
    private hand?: PIXI.Sprite;
    /** Row y (in contentArea) per shop id, from the last render — where a pop / the hand goes. */
    private readonly rowY = new Map<string, number>();
    private readonly onClosedCallback?: () => void;

    private readonly handleChange = (): void => this.render();
    private readonly handlePurchase = (shopId: string): void => this.playPurchasePop(shopId);

    public constructor(onClosed?: () => void) {
        super('Upgrades', { contentWidth: BODY_WIDTH, frame: 'ItemFrame', titleIcon: 'survival-backpack' });
        this.onClosedCallback = onClosed;

        // buildContent() runs inside super(), before the fields above exist.
        this.render();

        EconomyStorage.onChange.add(this.handleChange);
        BackpackStorage.onChange.add(this.handleChange);
        ShopUpgradeStorage.onChange.add(this.handleChange);
        UpgradeMenu.onPurchase.add(this.handlePurchase);
        this.root.once('destroyed', () => this.unsubscribe());
    }

    protected override onClosed(): void {
        // Everything listed has now been seen — NEW tags (and the button's "!" for them) go away.
        UpgradeMenuStorage.markSeen(UpgradeMenu.getEntries().map(entry => entry.shopId));
        this.unsubscribe();
        this.onClosedCallback?.();
    }

    private unsubscribe(): void {
        EconomyStorage.onChange.remove(this.handleChange);
        BackpackStorage.onChange.remove(this.handleChange);
        ShopUpgradeStorage.onChange.remove(this.handleChange);
        UpgradeMenu.onPurchase.remove(this.handlePurchase);
        if (this.hand) {
            gsap.killTweensOf(this.hand);
        }
    }

    protected buildContent(content: PIXI.Container): void {
        const background = new PanelBackground();
        background.setFixedSize(BODY_WIDTH, BODY_HEIGHT);
        content.addChild(background);

        this.contentArea = new PIXI.Container();
        this.scrollView = new ScrollView({ target: this.contentArea, width: CONTENT_WIDTH, height: CONTENT_HEIGHT });
        this.scrollView.position.set(PANEL_CONTENT_MARGIN, PANEL_CONTENT_MARGIN);
        content.addChild(this.scrollView);

        this.overlay = new PIXI.Container();
        this.overlay.position.set(PANEL_CONTENT_MARGIN, PANEL_CONTENT_MARGIN);
        content.addChild(this.overlay);
    }

    private render(): void {
        this.contentArea.removeChildren().forEach(child => child.destroy({ children: true }));
        this.rowY.clear();
        const entries = UpgradeMenu.getEntries();
        if (entries.length === 0) {
            this.contentArea.addChild(new PIXI.Text('Nothing to upgrade yet.', TextStyleRegistry.Inventory));
        }
        entries.forEach((entry, index) => this.renderRow(entry, index * (ROW_HEIGHT + ROW_GAP)));
        this.scrollView.refresh();
        this.updateHand();
    }

    private renderRow(entry: UpgradeMenuEntry, y: number): void {
        this.rowY.set(entry.shopId, y);
        const row = new PIXI.Container();
        row.position.set(0, y);
        this.contentArea.addChild(row);

        const icon = new PIXI.Sprite(getToolIcon(entry.config.tool));
        icon.anchor.set(0, 0.5);
        icon.width = ICON_SIZE;
        icon.height = ICON_SIZE;
        icon.position.set(0, ROW_HEIGHT / 2);
        row.addChild(icon);
        const textX = ICON_SIZE + ICON_GAP;

        // Line 1: name + level (+ NEW)
        const name = text(entry.name, 20);
        name.position.set(textX, 4);
        row.addChild(name);
        const maxed = entry.cost === undefined;
        const levelLabel = text(maxed ? `MAX (Lv ${entry.level})` : `Lv ${entry.level} → ${entry.level + 1}`, 15, maxed ? COLOR_MAX : COLOR_UP);
        levelLabel.position.set(textX + name.width + 8, 8);
        row.addChild(levelLabel);
        if (entry.isNew) {
            const tag = text('NEW', 13, COLOR_NEW);
            tag.position.set(levelLabel.x + levelLabel.width + 8, 9);
            row.addChild(tag);
        }

        // Line 2: what it does
        if (entry.effect) {
            const effect = text(entry.effect, 15);
            effect.alpha = 0.9;
            effect.position.set(textX, 32);
            row.addChild(effect);
        }

        // Line 3: price, red where short. Line 4: the level after.
        if (entry.cost) {
            const chips = this.costChips(entry.cost, true);
            chips.position.set(textX, 58);
            row.addChild(chips);
        }
        if (entry.costAfter) {
            const after = text(`then: ${describeCost(entry.costAfter)}`, 12);
            after.alpha = 0.6;
            after.position.set(textX, 82);
            row.addChild(after);
        }

        const button = createLibraryButton({
            color: maxed ? 'grey' : entry.affordable ? 'green' : 'grey',
            width: BUTTON_WIDTH, height: BUTTON_HEIGHT,
            label: maxed ? 'Max' : 'Buy',
            onClick: entry.affordable ? () => { UpgradeMenu.buy(entry.shopId); } : () => { /* not affordable — no-op */ },
        });
        button.position.set(CONTENT_WIDTH - BUTTON_WIDTH, ROW_HEIGHT / 2 - BUTTON_HEIGHT / 2);
        button.alpha = entry.affordable ? 1 : 0.55;
        row.addChild(button);
    }

    /** Coin + amount, then icon + have/need per resource; `markShort` paints what the player lacks red. */
    private costChips(cost: ShopCost, markShort: boolean): PIXI.Container {
        const chips = new PIXI.Container();
        let x = 0;
        const add = (texture: PIXI.Texture, label: string, short: boolean): void => {
            const icon = new PIXI.Sprite(texture);
            icon.anchor.set(0, 0.5);
            icon.width = CHIP_ICON_SIZE;
            icon.height = CHIP_ICON_SIZE;
            icon.position.set(x, CHIP_ICON_SIZE / 2);
            chips.addChild(icon);
            const value = text(label, 16, markShort && short ? COLOR_SHORT : undefined);
            value.anchor.set(0, 0.5);
            value.position.set(x + CHIP_ICON_SIZE + 4, CHIP_ICON_SIZE / 2);
            chips.addChild(value);
            x = value.x + value.width + CHIP_GAP;
        };
        if (cost.money > 0) {
            add(getAssetIcon(CURRENCY_CONFIG[CurrencyType.Money].assetKey), `${cost.money}`, EconomyStorage.getBalance(CurrencyType.Money) < cost.money);
        }
        for (const [type, need] of Object.entries(cost.resources) as [ResourceType, number][]) {
            const have = BackpackStorage.getCount(type);
            add(getAssetIcon(resolveResourceAssetKey(type)), `${Math.min(have, need)}/${need}`, have < need);
        }
        if (cost.money <= 0 && Object.keys(cost.resources).length === 0) {
            const free = text('Free', 16, COLOR_UP);
            chips.addChild(free);
        }
        return chips;
    }

    /** The lesson hand over the backpack's Buy button — only while the lesson is pending and it's affordable. */
    private updateHand(): void {
        const y = this.rowY.get(FIRST_UPGRADE_SHOP_ID);
        const show = UpgradeMenu.isLessonPending() && y !== undefined && UpgradeMenu.canAfford(FIRST_UPGRADE_SHOP_ID);
        if (!show) {
            if (this.hand) {
                gsap.killTweensOf(this.hand);
                this.hand.destroy();
                this.hand = undefined;
            }
            return;
        }
        if (!this.hand) {
            const hand = new PIXI.Sprite(PIXI.Texture.from(HAND_TEXTURE));
            // The art points DOWN — anchored at the fingertip, so `position` is where it touches.
            hand.anchor.set(HAND_TIP_ANCHOR.x, HAND_TIP_ANCHOR.y);
            hand.width = HAND_SIZE;
            hand.height = HAND_SIZE;
            this.overlay.addChild(hand);
            this.hand = hand;
        }
        // Fingertip on the Buy button's upper half, tapping down onto it.
        const tipX = CONTENT_WIDTH - BUTTON_WIDTH / 2;
        const tipY = y! + ROW_HEIGHT / 2 - BUTTON_HEIGHT / 2 + 12;
        gsap.killTweensOf(this.hand);
        this.hand.position.set(tipX, tipY);
        gsap.to(this.hand, { y: tipY - 14, duration: 0.45, ease: 'sine.inOut', yoyo: true, repeat: -1 });
    }

    /** "Upgraded!" rising off the row just bought. */
    private playPurchasePop(shopId: string): void {
        const y = this.rowY.get(shopId);
        if (y === undefined) {
            return;
        }
        const pop = text('Upgraded!', 26, COLOR_UP);
        pop.anchor.set(0.5);
        pop.position.set(CONTENT_WIDTH / 2, y + ROW_HEIGHT / 2);
        this.overlay.addChild(pop);
        pop.scale.set(0.6);
        gsap.to(pop.scale, { x: 1, y: 1, duration: 0.25, ease: 'back.out(2)' });
        gsap.to(pop, {
            y: pop.y - 40, alpha: 0, duration: 0.9, delay: 0.35, ease: 'sine.in',
            onComplete: () => pop.destroy(),
        });
    }
}

function text(value: string, fontSize: number, fill?: string): PIXI.Text {
    return new PIXI.Text(value, { ...TextStyleRegistry.Inventory, fontSize, ...(fill ? { fill } : {}) });
}

/** "120 · 25 wood" — the level after the next, kept to one short line. */
function describeCost(cost: ShopCost): string {
    const parts: string[] = [];
    if (cost.money > 0) {
        parts.push(`${cost.money} coins`);
    }
    for (const [type, amount] of Object.entries(cost.resources) as [string, number][]) {
        parts.push(`${amount} ${type}`);
    }
    return parts.join(' · ') || 'free';
}
