// HireWorkersPopup.ts
//
// Opened by HireDeskZone's "Hire" button. Two tabs, same bottom tab strip as MartPopup:
//   - Hire: one row per role the store's hire desk offers (StoreConfig.hiring — see
//     StoreTypes.getStoreHireRoles()): role name, how many the store has out of its max, the
//     price, and a Hire button. Hiring spends the money first, then calls Store.hireWorker() —
//     refunded if the store refuses.
//   - Upgrade: one row per worker the store has (StoreWorkerStorage's roster — starting workers
//     included): name, current level, the cost of the next level (StoreTypes.getNextWorkerUpgrade())
//     and an Upgrade button, or "Max" at the top of its role's ladder. Upgrading spends the money,
//     then StoreWorkerStorage.setLevel() — Store hands the new level to the live worker itself.
//
// `onClosed` (HireDeskZone -> PizzaScene.unfreezePlayerMovement) fires however the popup closes —
// see MartPopup's own doc.

import * as PIXI from 'pixi.js';
import Popup from './Popup';
import PanelBackground, { PANEL_CONTENT_MARGIN } from '../PanelBackground';
import ScrollView from '../ScrollView';
import { TextStyleRegistry } from '../TextStyleRegistry';
import { createLibraryButton } from '../ButtonLibrary';
import { EconomyStorage } from '../../data/EconomyStorage';
import { CURRENCY_CONFIG, CurrencyType } from '../../data/EconomyTypes';
import { getAssetIcon } from '../../world/AssetLibraryRegistry';
import {
    getHireMaxCount,
    getNextWorkerUpgrade,
    getStoreConfig,
    getStoreHireRoles,
    getWorkerMaxLevel,
    StoreHireRoleConfig,
    StoreWorkerRole,
} from '../../store/StoreTypes';
import { SavedStoreWorker, StoreWorkerStorage } from '../../store/StoreWorkerStorage';
import type Store from '../../store/Store';
import { canAffordAnyWorkerUpgrade, STAFF_ALERT_TEXTURE } from '../../store/StaffUpgradeAlert';
import ViewUtils from 'core/utils/ViewUtils';

type HireTabId = 'hire' | 'upgrade';

const HIRE_TABS: { id: HireTabId; label: string }[] = [
    { id: 'hire', label: 'Hire' },
    { id: 'upgrade', label: 'Upgrade' },
];

const BODY_WIDTH = 420;
const BODY_HEIGHT = 360;
const BODY_TABS_GAP = 14;
const CONTENT_WIDTH = BODY_WIDTH - PANEL_CONTENT_MARGIN * 2;
const CONTENT_HEIGHT = BODY_HEIGHT - PANEL_CONTENT_MARGIN * 2;

/** Same tab strip look as MartPopup's. */
const TAB_HEIGHT = 66;
const TAB_PADDING_X = 30;
const TAB_OVERLAP = 2;
const TAB_ACTIVE_TEXTURE = 'Label_Parallelogram_Yellow';
const TAB_INACTIVE_TEXTURE = 'Label_Parallelogram_Gray';
/** Upgrade tab's exclamation badge — same size as BackpackButton's, nudged to overhang the tab's top-right corner. */
const TAB_ALERT_SIZE = 28;
const TAB_ALERT_INSET = 8;

const ROW_HEIGHT = 64;
const ROW_GAP = 8;
const ROW_BUTTON_WIDTH = 110;
const ROW_BUTTON_HEIGHT = 40;
const MONEY_ICON_SIZE = 18;

const ROLE_LABELS: Record<StoreWorkerRole, string> = {
    cashier: 'Cashier',
    restocker: 'Restocker',
    cleaner: 'Cleaner',
};
/** Upgrade tab order — grouped by role, then by id. */
const ROLE_ORDER: StoreWorkerRole[] = ['cashier', 'restocker', 'cleaner'];

/** One row's content — both tabs render through renderRow(). */
interface RowSpec {
    title: string;
    /** Small colored text right after the title — "(1/3)" on Hire, "Lv 2" on Upgrade. */
    badge: string;
    badgeColor: string;
    /** Price under the title; undefined = no price shown (maxed). */
    price?: number;
    buttonLabel: string;
    enabled: boolean;
    onAction: () => void;
}

export default class HireWorkersPopup extends Popup {
    private readonly storeId: string;
    private readonly getStore: () => Store | undefined;
    private readonly onClosedCallback?: () => void;

    private declare activeTab: HireTabId;
    private declare contentArea: PIXI.Container;
    private declare scrollView: ScrollView;
    private declare tabButtons: Map<HireTabId, PIXI.NineSlicePlane>;
    /** Icon_Exclamation on the Upgrade tab — shown while some worker upgrade is affordable (see StaffUpgradeAlert.ts); refreshed by render(). */
    private declare upgradeTabAlert: PIXI.Sprite;

    private readonly handleChange = (): void => this.render();

    public constructor(storeId: string, getStore: () => Store | undefined, onClosed?: () => void) {
        super('Staff', { contentWidth: BODY_WIDTH, frame: 'ItemFrame', closeOnBackdropTap: false });
        this.storeId = storeId;
        this.getStore = getStore;
        this.onClosedCallback = onClosed;

        // Same reason as MartPopup: buildContent() runs inside super(), before the fields above exist.
        this.render();

        EconomyStorage.onChange.add(this.handleChange);
        StoreWorkerStorage.onLevelChanged.add(this.handleChange);
        this.root.once('destroyed', () => {
            EconomyStorage.onChange.remove(this.handleChange);
            StoreWorkerStorage.onLevelChanged.remove(this.handleChange);
        });
    }

    protected override onClosed(): void {
        this.onClosedCallback?.();
    }

    protected buildContent(content: PIXI.Container, contentWidth: number): void {
        this.activeTab = HIRE_TABS[0].id;
        this.tabButtons = new Map();

        const background = new PanelBackground();
        background.setFixedSize(BODY_WIDTH, BODY_HEIGHT);
        content.addChild(background);

        this.contentArea = new PIXI.Container();
        this.scrollView = new ScrollView({ target: this.contentArea, width: CONTENT_WIDTH, height: CONTENT_HEIGHT });
        this.scrollView.position.set(PANEL_CONTENT_MARGIN, PANEL_CONTENT_MARGIN);
        content.addChild(this.scrollView);

        const tabsRow = new PIXI.Container();
        tabsRow.position.set(0, BODY_HEIGHT + BODY_TABS_GAP);
        content.addChild(tabsRow);

        const tabWidth = contentWidth / HIRE_TABS.length;
        const totalTabsWidth = tabWidth * HIRE_TABS.length - TAB_OVERLAP * (HIRE_TABS.length - 1);
        const startX = (contentWidth - totalTabsWidth) / 2;

        HIRE_TABS.forEach((tab, index) => {
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

            if (tab.id === 'upgrade') {
                // Pinned to the tab's top-right corner, same corner BaseButton.addAlertIcon() uses.
                const badge = new PIXI.Sprite(PIXI.Texture.from(STAFF_ALERT_TEXTURE));
                badge.anchor.set(1, 0);
                badge.scale.set(ViewUtils.elementScaler(badge, TAB_ALERT_SIZE));
                badge.position.set(tabWidth - TAB_ALERT_INSET, -TAB_ALERT_INSET);
                badge.visible = false;
                tabContainer.addChild(badge);
                this.upgradeTabAlert = badge;
            }

            this.tabButtons.set(tab.id, bg);
            this.redrawTab(tab.id, bg);
        });
    }

    private setActiveTab(tab: HireTabId): void {
        if (this.activeTab === tab) {
            return;
        }
        this.activeTab = tab;
        for (const [id, bg] of this.tabButtons) {
            this.redrawTab(id, bg);
        }
        this.render();
    }

    private redrawTab(tab: HireTabId, bg: PIXI.NineSlicePlane): void {
        bg.texture = PIXI.Texture.from(tab === this.activeTab ? TAB_ACTIVE_TEXTURE : TAB_INACTIVE_TEXTURE);
        if (tab === this.activeTab) {
            bg.parent.parent.setChildIndex(bg.parent, bg.parent.parent.children.length - 1);
        }
    }

    private render(): void {
        this.contentArea.removeChildren().forEach(child => child.destroy({ children: true }));

        const store = this.getStore();
        this.upgradeTabAlert.visible = store?.isOpen() === true && canAffordAnyWorkerUpgrade(this.storeId);
        if (!store?.isOpen()) {
            this.renderMessage('Open the store first.');
        } else if (this.activeTab === 'hire') {
            this.renderHireTab(store);
        } else {
            this.renderUpgradeTab();
        }
        this.scrollView.refresh();
    }

    private roster(): readonly SavedStoreWorker[] {
        return StoreWorkerStorage.getRoster(this.storeId) ?? [];
    }

    // ---- Hire tab

    private renderHireTab(store: Store): void {
        getStoreHireRoles(getStoreConfig(this.storeId)).forEach((entry, index) => {
            const hired = this.roster().filter(worker => worker.role === entry.role).length;
            const max = getHireMaxCount(entry);
            const full = hired >= max;
            this.renderRow(index, {
                title: ROLE_LABELS[entry.role] ?? entry.role,
                badge: `(${hired}/${max})`,
                badgeColor: full ? '#e5484d' : '#33cc66',
                price: full ? undefined : entry.cost,
                buttonLabel: full ? 'Full' : 'Hire',
                enabled: !full && EconomyStorage.getBalance(CurrencyType.Money) >= entry.cost,
                onAction: () => this.hire(entry, store),
            });
        });
    }

    private hire(entry: StoreHireRoleConfig, store: Store): void {
        const hired = this.roster().filter(worker => worker.role === entry.role).length;
        if (hired >= getHireMaxCount(entry) || !EconomyStorage.spend(CurrencyType.Money, entry.cost)) {
            return;
        }
        if (!store.hireWorker(entry.role)) {
            EconomyStorage.add(CurrencyType.Money, entry.cost);
        }
        // spend()/add() already re-rendered via onChange, but before the roster changed.
        this.render();
    }

    // ---- Upgrade tab

    private renderUpgradeTab(): void {
        const workers = [...this.roster()].sort((a, b) =>
            ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || a.id.localeCompare(b.id, undefined, { numeric: true }));
        if (workers.length === 0) {
            this.renderMessage('No staff yet — hire someone first.');
            return;
        }

        const config = getStoreConfig(this.storeId);
        workers.forEach((worker, index) => {
            const level = worker.level ?? 1;
            const next = getNextWorkerUpgrade(config, worker.role, level);
            const maxLevel = getWorkerMaxLevel(config, worker.role);
            this.renderRow(index, {
                title: this.workerName(worker),
                badge: next ? `Lv ${level} → ${next.level}` : `Lv ${level}/${maxLevel}`,
                badgeColor: next ? '#33cc66' : '#f5c542',
                price: next?.cost,
                buttonLabel: next ? 'Upgrade' : 'Max',
                enabled: next !== undefined && EconomyStorage.getBalance(CurrencyType.Money) >= next.cost,
                onAction: () => this.upgrade(worker),
            });
        });
    }

    /** "Restocker 2" from id "restocker2" — the roster's own numbering (see Store.hireWorker()). */
    private workerName(worker: SavedStoreWorker): string {
        const number = worker.id.match(/(\d+)$/)?.[1];
        const label = ROLE_LABELS[worker.role] ?? worker.role;
        return number ? `${label} ${number}` : label;
    }

    private upgrade(worker: SavedStoreWorker): void {
        // Re-read the saved level — the row may be a frame stale.
        const current = this.roster().find(entry => entry.id === worker.id);
        if (!current) {
            return;
        }
        const next = getNextWorkerUpgrade(getStoreConfig(this.storeId), current.role, current.level ?? 1);
        if (!next || !EconomyStorage.spend(CurrencyType.Money, next.cost)) {
            return;
        }
        StoreWorkerStorage.setLevel(this.storeId, current.id, next.level);
    }

    // ---- Shared row

    private renderMessage(text: string): void {
        this.contentArea.addChild(new PIXI.Text(text, TextStyleRegistry.Inventory));
    }

    private renderRow(index: number, spec: RowSpec): void {
        const row = new PIXI.Container();
        row.position.set(0, index * (ROW_HEIGHT + ROW_GAP));
        this.contentArea.addChild(row);

        const nameLabel = new PIXI.Text(spec.title, TextStyleRegistry.Inventory);
        nameLabel.anchor.set(0, 0.5);
        nameLabel.position.set(0, ROW_HEIGHT / 2 - 12);
        row.addChild(nameLabel);

        const badgeLabel = new PIXI.Text(spec.badge, { ...TextStyleRegistry.Inventory, fontSize: 14, fill: spec.badgeColor });
        badgeLabel.anchor.set(0, 0.5);
        badgeLabel.position.set(nameLabel.width + 6, ROW_HEIGHT / 2 - 12);
        row.addChild(badgeLabel);

        if (spec.price !== undefined) {
            const priceRow = new PIXI.Container();
            priceRow.position.set(0, ROW_HEIGHT / 2 + 12);
            row.addChild(priceRow);

            const moneyIcon = new PIXI.Sprite(getAssetIcon(CURRENCY_CONFIG[CurrencyType.Money].assetKey));
            moneyIcon.anchor.set(0, 0.5);
            moneyIcon.width = MONEY_ICON_SIZE;
            moneyIcon.height = MONEY_ICON_SIZE;
            priceRow.addChild(moneyIcon);

            const priceLabel = new PIXI.Text(spec.price.toString(), { ...TextStyleRegistry.Inventory, fontSize: 16 });
            priceLabel.alpha = 0.85;
            priceLabel.anchor.set(0, 0.5);
            priceLabel.position.set(MONEY_ICON_SIZE + 4, 0);
            priceRow.addChild(priceLabel);
        }

        const button = createLibraryButton({
            color: spec.enabled ? 'blue' : 'grey',
            width: ROW_BUTTON_WIDTH, height: ROW_BUTTON_HEIGHT,
            label: spec.buttonLabel,
            onClick: spec.enabled ? spec.onAction : () => { /* disabled — no-op */ },
        });
        button.position.set(CONTENT_WIDTH - ROW_BUTTON_WIDTH, ROW_HEIGHT / 2 - ROW_BUTTON_HEIGHT / 2);
        button.alpha = spec.enabled ? 1 : 0.5;
        row.addChild(button);
    }
}
