// AnimalUpgradesPopup.ts
//
// Opened by an animal keeper desk (a FarmDeskZone of kind 'animals' — see FarmDeskTypes.ts). One
// row per OWNED animal stall: its product's icon + name, level -> next, how many animals the next
// level brings (each level = one more animal, so the stall lays more often), its price and an
// Upgrade button, or "Max". Upgrading spends the money, then AnimalStallUpgradeStorage.setLevel()
// — PizzaScene spawns the new animal into the pen right away. Row look matches FarmUpgradesPopup.

import * as PIXI from 'pixi.js';
import Popup from './Popup';
import PanelBackground, { PANEL_CONTENT_MARGIN } from '../PanelBackground';
import ScrollView from '../ScrollView';
import { TextStyleRegistry } from '../TextStyleRegistry';
import { createLibraryButton } from '../ButtonLibrary';
import { EconomyStorage } from '../../data/EconomyStorage';
import { CURRENCY_CONFIG, CurrencyType } from '../../data/EconomyTypes';
import { getAssetIcon } from '../../world/AssetLibraryRegistry';
import { resolveResourceAssetKey } from '../../actions/ResourceRegistry';
import { getAnimalCountAt, getAnimalStallConfig, getAnimalStallMaxLevel, getNextAnimalStallUpgrade } from '../../data/AnimalStallTypes';
import { AnimalStallUpgradeStorage } from '../../data/AnimalStallUpgradeStorage';
import { getStorageConfig, isStorageForSale } from '../../data/StorageTypes';
import { StorageOwnershipStorage } from '../../store/StorageOwnershipStorage';
import { GameAnalytics } from '../../analytics/GameAnalytics';

const BODY_WIDTH = 460;
const BODY_HEIGHT = 380;
const CONTENT_WIDTH = BODY_WIDTH - PANEL_CONTENT_MARGIN * 2;
const CONTENT_HEIGHT = BODY_HEIGHT - PANEL_CONTENT_MARGIN * 2;

const ROW_HEIGHT = 78;
const ROW_GAP = 8;
const ROW_BUTTON_WIDTH = 110;
const ROW_BUTTON_HEIGHT = 40;
const ICON_SIZE = 44;
const ICON_GAP = 10;
const MONEY_ICON_SIZE = 18;

/** A stall the player has (bought through its same-id Storages entry, or free). */
function isStallOwned(stallId: string): boolean {
    return !isStorageForSale(getStorageConfig(stallId)) || StorageOwnershipStorage.isOwned(stallId);
}

/** True when some owned stall in `stallIds` has an upgrade the player can pay for right now — the desk button's badge. */
export function canAffordAnyAnimalUpgrade(stallIds: readonly string[]): boolean {
    const money = EconomyStorage.getBalance(CurrencyType.Money);
    return stallIds.some(stallId => {
        if (!isStallOwned(stallId)) {
            return false;
        }
        const next = getNextAnimalStallUpgrade(stallId, AnimalStallUpgradeStorage.getLevel(stallId));
        return next !== undefined && money >= next.cost;
    });
}

export default class AnimalUpgradesPopup extends Popup {
    private readonly stallIds: readonly string[];
    private readonly onClosedCallback?: () => void;

    private declare contentArea: PIXI.Container;
    private declare scrollView: ScrollView;

    private readonly handleChange = (): void => this.render();

    /** `stallIds` — every animal stall on the map; only owned ones are listed. */
    public constructor(title: string, stallIds: readonly string[], onClosed?: () => void) {
        super(title, { contentWidth: BODY_WIDTH, frame: 'ItemFrame', closeOnBackdropTap: false });
        this.stallIds = [...stallIds].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        this.onClosedCallback = onClosed;

        // buildContent() runs inside super(), before the fields above exist.
        this.render();

        EconomyStorage.onChange.add(this.handleChange);
        AnimalStallUpgradeStorage.onChange.add(this.handleChange);
        this.root.once('destroyed', () => {
            EconomyStorage.onChange.remove(this.handleChange);
            AnimalStallUpgradeStorage.onChange.remove(this.handleChange);
        });
    }

    protected override onClosed(): void {
        this.onClosedCallback?.();
    }

    protected buildContent(content: PIXI.Container): void {
        const background = new PanelBackground();
        background.setFixedSize(BODY_WIDTH, BODY_HEIGHT);
        content.addChild(background);

        this.contentArea = new PIXI.Container();
        this.scrollView = new ScrollView({ target: this.contentArea, width: CONTENT_WIDTH, height: CONTENT_HEIGHT });
        this.scrollView.position.set(PANEL_CONTENT_MARGIN, PANEL_CONTENT_MARGIN);
        content.addChild(this.scrollView);
    }

    private render(): void {
        this.contentArea.removeChildren().forEach(child => child.destroy({ children: true }));
        const owned = this.stallIds.filter(isStallOwned);
        if (owned.length === 0) {
            this.contentArea.addChild(new PIXI.Text('No animals yet.', TextStyleRegistry.Inventory));
        }
        owned.forEach((stallId, index) => this.renderRow(index, stallId));
        this.scrollView.refresh();
    }

    private upgrade(stallId: string): void {
        const next = getNextAnimalStallUpgrade(stallId, AnimalStallUpgradeStorage.getLevel(stallId));
        if (!next || !EconomyStorage.spend(CurrencyType.Money, next.cost)) {
            return;
        }
        AnimalStallUpgradeStorage.setLevel(stallId, next.level);
        GameAnalytics.animalStallUpgraded(stallId, next.level);
    }

    private renderRow(index: number, stallId: string): void {
        const row = new PIXI.Container();
        row.position.set(0, index * (ROW_HEIGHT + ROW_GAP));
        this.contentArea.addChild(row);

        const config = getAnimalStallConfig(stallId);
        const level = AnimalStallUpgradeStorage.getLevel(stallId);
        const next = getNextAnimalStallUpgrade(stallId, level);

        const icon = new PIXI.Sprite(getAssetIcon(resolveResourceAssetKey(config.resourceType)));
        icon.anchor.set(0, 0.5);
        icon.width = ICON_SIZE;
        icon.height = ICON_SIZE;
        icon.position.set(0, ROW_HEIGHT / 2);
        row.addChild(icon);
        const textX = ICON_SIZE + ICON_GAP;

        const nameLabel = new PIXI.Text(config.name ?? stallId, TextStyleRegistry.Inventory);
        nameLabel.anchor.set(0, 0.5);
        nameLabel.position.set(textX, 16);
        row.addChild(nameLabel);

        const badgeLabel = new PIXI.Text(next ? `Lv ${level} → ${next.level}` : `Lv ${level}/${getAnimalStallMaxLevel(stallId)}`, {
            ...TextStyleRegistry.Inventory, fontSize: 14, fill: next ? '#33cc66' : '#f5c542',
        });
        badgeLabel.anchor.set(0, 0.5);
        badgeLabel.position.set(textX + nameLabel.width + 6, 16);
        row.addChild(badgeLabel);

        const animalsNow = getAnimalCountAt(stallId, level);
        const effect = next
            ? `+1 animal (${animalsNow} → ${getAnimalCountAt(stallId, next.level)}) · lays more`
            : `${animalsNow} animals`;
        const effectLabel = new PIXI.Text(effect, { ...TextStyleRegistry.Inventory, fontSize: 14 });
        effectLabel.alpha = 0.85;
        effectLabel.anchor.set(0, 0.5);
        effectLabel.position.set(textX, ROW_HEIGHT / 2 + 2);
        row.addChild(effectLabel);

        if (next) {
            const priceRow = new PIXI.Container();
            priceRow.position.set(textX, ROW_HEIGHT - 16);
            row.addChild(priceRow);

            const moneyIcon = new PIXI.Sprite(getAssetIcon(CURRENCY_CONFIG[CurrencyType.Money].assetKey));
            moneyIcon.anchor.set(0, 0.5);
            moneyIcon.width = MONEY_ICON_SIZE;
            moneyIcon.height = MONEY_ICON_SIZE;
            priceRow.addChild(moneyIcon);

            const priceLabel = new PIXI.Text(next.cost.toString(), { ...TextStyleRegistry.Inventory, fontSize: 16 });
            priceLabel.alpha = 0.85;
            priceLabel.anchor.set(0, 0.5);
            priceLabel.position.set(MONEY_ICON_SIZE + 4, 0);
            priceRow.addChild(priceLabel);
        }

        const enabled = next !== undefined && EconomyStorage.getBalance(CurrencyType.Money) >= next.cost;
        const button = createLibraryButton({
            color: enabled ? 'blue' : 'grey',
            width: ROW_BUTTON_WIDTH, height: ROW_BUTTON_HEIGHT,
            label: next ? 'Upgrade' : 'Max',
            onClick: enabled ? () => this.upgrade(stallId) : () => { /* disabled — no-op */ },
        });
        button.position.set(CONTENT_WIDTH - ROW_BUTTON_WIDTH, ROW_HEIGHT / 2 - ROW_BUTTON_HEIGHT / 2);
        button.alpha = enabled ? 1 : 0.5;
        row.addChild(button);
    }
}
