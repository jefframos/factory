// MartPopup.ts
//
// The buy/sell UI for a MartTypes.ts general store — opened by MartZone.ts's
// own "Open Shop" button tap. Same Popup-subclass/bottom-tab-strip shape as
// InventoryPopup.ts (Buy / Sell tabs instead of Tools / Resources / Farm),
// but each row here is a live TRANSACTION, not a static display: tapping
// "Buy"/"Sell" immediately spends/banks Money and re-renders that row's own
// count, over and over — there is no quantity limit beyond what the
// player's own wallet/backpack can support ("buy as much as he wants," see
// MartZone.ts's own doc), unlike a single-item ShopUpgradeStorage purchase.
//
// Buy tab lists `config.offers` — what THIS mart is willing to sell. Sell
// tab is NOT scoped to `offers` at all — it lists every ResourceType the
// player currently holds with a sellable price (MartTypes.getMartSellPrice())
// regardless of whether this particular mart also stocks it for sale, same
// "a general store buys back anything sellable" reasoning MartTypes.ts's
// own top doc lays out.
//
// `onClosed` (passed in by MartZone.ts, wired to PizzaScene's own
// unfreezePlayerMovement()) is invoked via this popup's own onClosed()
// override (see Popup.ts's own doc) — fires the instant PopupManager
// actually starts closing this popup, regardless of which of the three
// close paths (X button, backdrop tap, replaced by another popup) triggered
// it, so movement is never left frozen no matter how the player leaves.

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import Popup from './Popup';
import { TextStyleRegistry } from '../TextStyleRegistry';
import { createLibraryButton } from '../ButtonLibrary';
import { EconomyStorage } from '../../data/EconomyStorage';
import { CURRENCY_CONFIG, CurrencyType } from '../../data/EconomyTypes';
import { BackpackStorage } from '../../data/BackpackStorage';
import { RESOURCE_CONFIG, ResourceType } from '../../actions/ResourceTypes';
import { resolveResourceAssetKey } from '../../actions/ResourceRegistry';
import { getAssetIcon } from '../../world/AssetLibraryRegistry';
import { getMartBuyPrice, getMartSellPrice, MartConfig } from '../../data/MartTypes';

type MartTabId = 'buy' | 'sell';

interface MartTabDef {
    id: MartTabId;
    label: string;
}

const MART_TABS: MartTabDef[] = [
    { id: 'buy', label: 'Buy' },
    { id: 'sell', label: 'Sell' },
];

const BODY_WIDTH = 420;
const BODY_HEIGHT = 420;
const BODY_TABS_GAP = 14;

const TAB_HEIGHT = 66;
const TAB_PADDING_X = 30;
const TAB_OVERLAP = 2;
const TAB_ACTIVE_TEXTURE = 'Label_Parallelogram_Yellow';
const TAB_INACTIVE_TEXTURE = 'Label_Parallelogram_Gray';

const ICON_BG_TEXTURE_KEY = 'BorderFrame_Squrare_Bg';
const ICON_BG_TINT = 0x000000;
const ICON_BG_ALPHA = 0.5;

const ROW_HEIGHT = 64;
const ROW_GAP = 8;
const ROW_ICON_SIZE = 56;
const ROW_ICON_PADDING = 6;
const ROW_LABEL_GAP = 12;
const ROW_BUTTON_WIDTH = 96;
const ROW_BUTTON_HEIGHT = 40;
const MONEY_ICON_SIZE = 18;

/** Icon jiggle on a buy/sell — a quick punch-out-and-settle, same shape as GlobalResourcesUI's/BackpackListUI's own gain jiggle. */
const FEEDBACK_JIGGLE_SCALE = 1.3;
const FEEDBACK_JIGGLE_PUNCH_SEC = 0.12;
const FEEDBACK_JIGGLE_SETTLE_SEC = 0.15;
/** "+1"/"-1" popup rises and fades above the icon — see playRowFeedback(). */
const FEEDBACK_POPUP_RISE_PX = 20;
const FEEDBACK_POPUP_DURATION_SEC = 0.5;
/**
 * How long renderActiveTab() (which fully tears down and rebuilds every row — see this file's
 * own doc) is held off after a buy/sell, so the jiggle/rising-popup animation above actually
 * gets to play on the CURRENT row's icon before it's destroyed and replaced with the
 * post-transaction numbers. Slightly longer than the jiggle+popup's own combined duration so
 * the animation always finishes, not cut off mid-flight. See suppressRender/handleChange.
 */
const FEEDBACK_RENDER_DELAY_SEC = FEEDBACK_POPUP_DURATION_SEC + 0.05;

export default class MartPopup extends Popup {
    private readonly martId: string;
    private readonly config: MartConfig;
    private readonly onClosedCallback?: () => void;

    private declare activeTab: MartTabId;
    private declare body: PIXI.Container;
    private declare tabButtons: Map<MartTabId, PIXI.NineSlicePlane>;

    /** True for FEEDBACK_RENDER_DELAY_SEC right after a buy/sell — see that constant's own doc for why the reactive re-render has to wait rather than firing the instant EconomyStorage/BackpackStorage's own onChange dispatches (synchronously, before the feedback animation below ever gets a frame to render on the row it's about to destroy). */
    private suppressRender = false;

    private readonly handleChange = (): void => {
        if (this.suppressRender) {
            return;
        }
        this.renderActiveTab();
    };

    public constructor(martId: string, config: MartConfig, onClosed?: () => void) {
        super(config.name, { contentWidth: BODY_WIDTH, frame: 'ItemFrame' });
        this.martId = martId;
        this.config = config;
        this.onClosedCallback = onClosed;

        // buildContent() (called by Popup's own constructor, ABOVE, as part of super()) runs
        // before this constructor body gets to assign martId/config just above it — martId/
        // config are still undefined at that point, so buildContent() deliberately stops short
        // of actually rendering a tab's contents (see its own doc). This is the first point
        // they're guaranteed set, so this is the first point it's safe to render anything that
        // reads them.
        this.renderActiveTab();

        // Both tabs care about both storages — Buy affordability depends on EconomyStorage,
        // Sell availability depends on BackpackStorage, and the OTHER tab's own numbers should
        // stay live too (e.g. selling on one tab should immediately update Buy's own "can I
        // afford this now" state next time it's shown) — simplest to just re-render on either
        // change rather than tracking which tab cares about which storage.
        EconomyStorage.onChange.add(this.handleChange);
        BackpackStorage.onChange.add(this.handleChange);
        this.root.once('destroyed', () => {
            EconomyStorage.onChange.remove(this.handleChange);
            BackpackStorage.onChange.remove(this.handleChange);
        });
    }

    /** See this file's own top doc — fires regardless of which of the three close paths (X button, backdrop tap, replaced by another popup) actually triggered it. */
    protected override onClosed(): void {
        this.onClosedCallback?.();
    }

    protected buildContent(content: PIXI.Container, contentWidth: number): void {
        this.activeTab = MART_TABS[0].id;
        this.tabButtons = new Map();

        this.body = new PIXI.Container();
        content.addChild(this.body);

        const spacer = new PIXI.Graphics();
        spacer.beginFill(0x000000, 0).drawRect(0, 0, BODY_WIDTH, BODY_HEIGHT).endFill();
        this.body.addChild(spacer);

        const tabsRow = new PIXI.Container();
        tabsRow.position.set(0, BODY_HEIGHT + BODY_TABS_GAP);
        content.addChild(tabsRow);

        const tabWidth = contentWidth / MART_TABS.length;
        const totalTabsWidth = tabWidth * MART_TABS.length - TAB_OVERLAP * (MART_TABS.length - 1);
        const startX = (contentWidth - totalTabsWidth) / 2;

        MART_TABS.forEach((tab, index) => {
            const tabContainer = new PIXI.Container();
            tabContainer.position.set(startX + index * (tabWidth - TAB_OVERLAP), 0);
            tabContainer.interactive = true;
            tabContainer.cursor = 'pointer';
            tabContainer.on('pointertap', () => this.setActiveTab(tab.id));
            tabsRow.addChild(tabContainer);

            const bg = new PIXI.NineSlicePlane(PIXI.Texture.from(TAB_INACTIVE_TEXTURE), TAB_PADDING_X, 0, TAB_PADDING_X, 0);
            bg.width = tabWidth;
            bg.height = TAB_HEIGHT;
            tabContainer.addChild(bg);

            const label = new PIXI.Text(tab.label, TextStyleRegistry.Inventory);
            label.anchor.set(0.5, 0.5);
            label.position.set(tabWidth / 2, TAB_HEIGHT / 2);
            tabContainer.addChild(label);

            this.tabButtons.set(tab.id, bg);
            this.redrawTab(tab.id, bg);
        });

        // Deliberately NOT calling renderActiveTab() here — see the constructor's own doc for
        // why: this runs during super(), before martId/config (this popup's own constructor
        // params) have actually been assigned, and renderBuyTab()/renderSellTab() both read
        // `this.config`. The constructor calls it itself, right after those fields are set.
    }

    private setActiveTab(tab: MartTabId): void {
        if (this.activeTab === tab) {
            return;
        }
        this.activeTab = tab;

        for (const [id, bg] of this.tabButtons) {
            this.redrawTab(id, bg);
        }
        this.renderActiveTab();
    }

    private redrawTab(tab: MartTabId, bg: PIXI.NineSlicePlane): void {
        bg.texture = PIXI.Texture.from(tab === this.activeTab ? TAB_ACTIVE_TEXTURE : TAB_INACTIVE_TEXTURE);
        if (tab === this.activeTab) {
            bg.parent.parent.setChildIndex(bg.parent, bg.parent.parent.children.length - 1);
        }
    }

    private renderActiveTab(): void {
        while (this.body.children.length > 1) {
            this.body.children[this.body.children.length - 1].destroy({ children: true });
        }

        if (this.activeTab === 'buy') {
            this.renderBuyTab();
        } else {
            this.renderSellTab();
        }
    }

    /** Every `config.offers` entry with a real base ResourceConfig.price (see MartTypes.getMartBuyPrice()'s own doc — an offer for a priceless resource is simply skipped, not shown as unbuyable). Warns per skipped offer (dev-facing only, same "misconfiguration, not a crash" convention LooseResourceNode's own AssetLibraryRegistry warning uses) since an offer silently disappearing with no price set is otherwise indistinguishable from "this mart is empty" — see the bug that prompted this: a mart with real `offers` entries read as completely unstocked because neither resource had a Mart Price set on the Resources tab yet. */
    private renderBuyTab(): void {
        const rows = this.config.offers
            .map(offer => ({ offer, price: getMartBuyPrice(offer.resourceType, offer.priceMultiplier) }))
            .filter((row): row is { offer: typeof row.offer; price: number } => {
                if (row.price === undefined) {
                    console.warn(`[MartPopup] "${this.martId}" offers "${row.offer.resourceType}" but that resource has no Mart Price set (Resources tab) — skipping it from the Buy tab.`);
                    return false;
                }
                return true;
            });

        if (rows.length === 0) {
            this.renderEmptyMessage('Nothing for sale here yet.');
            return;
        }

        rows.forEach(({ offer, price }, index) => {
            const canAfford = EconomyStorage.getBalance(CurrencyType.Money) >= price;
            this.renderRow(index, offer.resourceType, price, 'Buy', canAfford, '+1', '#33cc66', () => {
                if (EconomyStorage.spend(CurrencyType.Money, price)) {
                    BackpackStorage.add(offer.resourceType, 1);
                }
            });
        });
    }

    /** Every ResourceType currently held with a sellable price — NOT scoped to `config.offers`, see this file's own top doc. */
    private renderSellTab(): void {
        const counts = BackpackStorage.getAll();
        const rows = Object.values(ResourceType)
            .map(resourceType => ({ resourceType, count: counts.get(resourceType) ?? 0, price: getMartSellPrice(resourceType) }))
            .filter((row): row is { resourceType: ResourceType; count: number; price: number } => row.count > 0 && row.price !== undefined);

        if (rows.length === 0) {
            this.renderEmptyMessage('Nothing sellable in your backpack right now.');
            return;
        }

        rows.forEach(({ resourceType, price }, index) => {
            this.renderRow(index, resourceType, price, 'Sell', true, '-1', '#e5484d', () => {
                if (BackpackStorage.removeOne(resourceType)) {
                    EconomyStorage.add(CurrencyType.Money, price);
                }
            });
        });
    }

    private renderEmptyMessage(text: string): void {
        const empty = new PIXI.Text(text, TextStyleRegistry.Inventory);
        empty.position.set(0, 0);
        this.body.addChild(empty);
    }

    /** One transaction row — icon, label, an "Owned: N" readout (live BackpackStorage count, shown on BOTH tabs so buying always shows what you're accumulating, not just selling), a money-icon+price readout, and an action button that fires `onAction` every tap (no quantity cap — see this file's own top doc). `enabled` dims the button and makes it non-interactive rather than hiding it, so the row's own layout never shifts as affordability/stock changes. `feedbackText`/`feedbackColor` (e.g. '+1'/green for Buy, '-1'/red for Sell) drive the jiggle+rising-popup animation on a successful tap — see playRowFeedback(). */
    private renderRow(index: number, resourceType: ResourceType, price: number, buttonLabel: string, enabled: boolean, feedbackText: string, feedbackColor: string, onAction: () => void): void {
        const row = new PIXI.Container();
        row.position.set(0, index * (ROW_HEIGHT + ROW_GAP));
        this.body.addChild(row);

        const iconBg = new PIXI.Sprite(PIXI.Texture.from(ICON_BG_TEXTURE_KEY));
        iconBg.tint = ICON_BG_TINT;
        iconBg.alpha = ICON_BG_ALPHA;
        iconBg.anchor.set(0, 0.5);
        iconBg.width = ROW_ICON_SIZE;
        iconBg.height = ROW_ICON_SIZE;
        iconBg.position.set(0, ROW_HEIGHT / 2);
        row.addChild(iconBg);

        const icon = new PIXI.Sprite(getAssetIcon(resolveResourceAssetKey(resourceType)));
        icon.anchor.set(0.5, 0.5);
        icon.width = ROW_ICON_SIZE - ROW_ICON_PADDING * 2;
        icon.height = ROW_ICON_SIZE - ROW_ICON_PADDING * 2;
        icon.position.set(ROW_ICON_SIZE / 2, ROW_HEIGHT / 2);
        row.addChild(icon);

        const textX = ROW_ICON_SIZE + ROW_LABEL_GAP;
        const nameLabel = new PIXI.Text(RESOURCE_CONFIG[resourceType].label, TextStyleRegistry.Inventory);
        nameLabel.anchor.set(0, 0.5);
        nameLabel.position.set(textX, ROW_HEIGHT / 2 - 12);
        row.addChild(nameLabel);

        // Owned count inline as "(N)" right after the name, in green — same info as a separate
        // "Owned: N" label would give, one less text block on an already-busy row. Kept updated
        // directly (see the button's own onClick below) rather than waiting for the delayed
        // full-row re-render playRowFeedback() schedules, so the count itself never looks like
        // it's lagging behind a purchase even while the row's OTHER numbers (price, afford
        // state) intentionally do wait for that animation to finish.
        const ownedCountLabel = new PIXI.Text(`(${BackpackStorage.getCount(resourceType)})`, { ...TextStyleRegistry.Inventory, fontSize: 14, fill: '#33cc66' });
        ownedCountLabel.anchor.set(0, 0.5);
        ownedCountLabel.position.set(textX + nameLabel.width + 6, ROW_HEIGHT / 2 - 12);
        row.addChild(ownedCountLabel);

        const priceRow = new PIXI.Container();
        priceRow.position.set(textX, ROW_HEIGHT / 2 + 12);
        row.addChild(priceRow);

        // Money's own icon is registered in AssetLibraryRegistry under CurrencyType.Money's own
        // assetKey (see FarmZone.ts/ShopZone.ts's own identical convention), not a ResourceType
        // — resolved directly rather than through resolveResourceAssetKey(), which only ever
        // maps ResourceType keys.
        const moneyIcon = new PIXI.Sprite(getAssetIcon(CURRENCY_CONFIG[CurrencyType.Money].assetKey));
        moneyIcon.anchor.set(0, 0.5);
        moneyIcon.width = MONEY_ICON_SIZE;
        moneyIcon.height = MONEY_ICON_SIZE;
        priceRow.addChild(moneyIcon);

        const priceLabel = new PIXI.Text(price.toString(), { ...TextStyleRegistry.Inventory, fontSize: 16 });
        priceLabel.alpha = 0.85;
        priceLabel.anchor.set(0, 0.5);
        priceLabel.position.set(MONEY_ICON_SIZE + 4, 0);
        priceRow.addChild(priceLabel);

        const button = createLibraryButton({
            color: enabled ? 'blue' : 'grey',
            width: ROW_BUTTON_WIDTH, height: ROW_BUTTON_HEIGHT,
            label: buttonLabel,
            onClick: enabled ? () => {
                // Suppress (and schedule the delayed re-render) BEFORE mutating storage — both
                // EconomyStorage/BackpackStorage dispatch their onChange SYNCHRONOUSLY the
                // instant onAction() actually spends/adds, so handleChange would otherwise
                // already have torn this row down (destroying `icon`/`row`) before
                // playRowFeedback() below ever got to animate them.
                this.beginSuppressedRender();
                onAction();
                // Refreshed immediately, unlike the rest of the row (price/afford state, which
                // stays as it was until playRowFeedback()'s own delayed re-render) — the owned
                // count is the one thing that should never look like it's lagging a beat behind
                // a purchase that just visibly happened.
                ownedCountLabel.text = `(${BackpackStorage.getCount(resourceType)})`;
                this.playRowFeedback(icon, row, feedbackText, feedbackColor);
            } : () => { /* disabled — no-op */ },
        });
        button.position.set(BODY_WIDTH - ROW_BUTTON_WIDTH, ROW_HEIGHT / 2 - ROW_BUTTON_HEIGHT / 2);
        button.alpha = enabled ? 1 : 0.5;
        row.addChild(button);
    }

    /** Pending "re-render once the animation settles" call — see beginSuppressedRender()'s own doc. */
    private pendingRenderDelay?: gsap.core.Tween;

    /**
     * Holds off the reactive re-render (see handleChange/suppressRender) for
     * FEEDBACK_RENDER_DELAY_SEC — MUST be called BEFORE the storage mutation that triggers it
     * (see the button onClick above for why: EconomyStorage/BackpackStorage dispatch onChange
     * SYNCHRONOUSLY, so suppressing after the fact is already too late). Resets/extends an
     * already-pending delay instead of stacking one per tap, so rapid repeat taps (buying
     * several in quick succession) settle into a single re-render once the LAST animation
     * finishes, rather than one full row rebuild per tap.
     */
    private beginSuppressedRender(): void {
        this.suppressRender = true;
        this.pendingRenderDelay?.kill();
        this.pendingRenderDelay = gsap.delayedCall(FEEDBACK_RENDER_DELAY_SEC, () => {
            this.suppressRender = false;
            this.pendingRenderDelay = undefined;
            this.renderActiveTab();
        });
    }

    /** Icon punch-and-settle + a rising/fading "+1"/"-1" popup, same visual language as GlobalResourcesUI's/BackpackListUI's own gain feedback — played on the row's CURRENT icon, immediately after `onAction` already mutated storage (see beginSuppressedRender()'s own doc for why the render suppression itself has to happen earlier, before that mutation). */
    private playRowFeedback(icon: PIXI.Sprite, row: PIXI.Container, text: string, color: string): void {
        const baseScaleX = icon.scale.x;
        const baseScaleY = icon.scale.y;
        gsap.killTweensOf(icon.scale);
        gsap.timeline()
            .to(icon.scale, { x: baseScaleX * FEEDBACK_JIGGLE_SCALE, y: baseScaleY * FEEDBACK_JIGGLE_SCALE, duration: FEEDBACK_JIGGLE_PUNCH_SEC, ease: 'back.out(2)' })
            .to(icon.scale, { x: baseScaleX, y: baseScaleY, duration: FEEDBACK_JIGGLE_SETTLE_SEC, ease: 'power1.out' });

        const popup = new PIXI.Text(text, TextStyleRegistry.ResourceDamage);
        popup.style.fill = color;
        popup.anchor.set(0.5, 1);
        const baseY = icon.position.y - ROW_ICON_SIZE / 2;
        popup.position.set(icon.position.x, baseY);
        row.addChild(popup);

        const progress = { t: 0 };
        gsap.to(progress, {
            t: 1,
            duration: FEEDBACK_POPUP_DURATION_SEC,
            ease: 'power2.out',
            onUpdate: () => {
                popup.position.y = baseY - progress.t * FEEDBACK_POPUP_RISE_PX;
                popup.alpha = 1 - progress.t;
            },
            onComplete: () => popup.destroy(),
        });
    }
}
