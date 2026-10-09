// FarmUpgradesPopup.ts
//
// Opened by FarmDeskZone's button (the farm manager by the farm gate). One row per OWNED farm
// (FarmPlotStorage), sorted by id: its crop's icon + "<Crop> Farm", the current level -> next,
// what the next level does (sell price / grow speed / extra per harvest — FarmUpgradeTypes.ts), its price
// and an Upgrade button, or "Max" at the top of the farm's ladder. Upgrading spends the money,
// then FarmUpgradeStorage.setLevel() — new crops planted from then on use the new stats.
//
// `onClosed` (FarmDeskZone -> PizzaScene.unfreezePlayerMovement) fires however the popup closes.
// Row look matches HireWorkersPopup.

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
import { FarmPlotStorage } from '../../data/FarmPlotStorage';
import { getFarmPlotConfig } from '../../data/FarmTypes';
import { CROP_CONFIG } from '../../data/CropTypes';
import { FarmUpgradeStorage } from '../../data/FarmUpgradeStorage';
import { getFarmMaxLevel, getFarmUpgradeStats, getNextFarmUpgrade } from '../../data/FarmUpgradeTypes';
import { GameAnalytics } from '../../analytics/GameAnalytics';

const BODY_WIDTH = 460;
const BODY_HEIGHT = 380;
const CONTENT_WIDTH = BODY_WIDTH - PANEL_CONTENT_MARGIN * 2;
const CONTENT_HEIGHT = BODY_HEIGHT - PANEL_CONTENT_MARGIN * 2;

const ROW_HEIGHT = 78;
const ROW_GAP = 8;
const ROW_BUTTON_WIDTH = 110;
const ROW_BUTTON_HEIGHT = 40;
const CROP_ICON_SIZE = 44;
const CROP_ICON_GAP = 10;
const MONEY_ICON_SIZE = 18;

/** True when some owned farm in `farmIds` has an upgrade the player can pay for right now — FarmDeskZone's button badge. */
export function canAffordAnyFarmUpgrade(farmIds: readonly string[]): boolean {
    const money = EconomyStorage.getBalance(CurrencyType.Money);
    return farmIds.some(farmId => {
        if (!FarmPlotStorage.isOwned(farmId)) {
            return false;
        }
        const next = getNextFarmUpgrade(farmId, FarmUpgradeStorage.getLevel(farmId));
        return next !== undefined && money >= next.cost;
    });
}

export default class FarmUpgradesPopup extends Popup {
    private readonly farmIds: readonly string[];
    private readonly onClosedCallback?: () => void;

    private declare contentArea: PIXI.Container;
    private declare scrollView: ScrollView;

    private readonly handleChange = (): void => this.render();

    /** `farmIds` — every farm on the map; only owned ones are listed. */
    public constructor(title: string, farmIds: readonly string[], onClosed?: () => void) {
        super(title, { contentWidth: BODY_WIDTH, frame: 'ItemFrame', closeOnBackdropTap: false });
        this.farmIds = [...farmIds].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        this.onClosedCallback = onClosed;

        // buildContent() runs inside super(), before the fields above exist.
        this.render();

        EconomyStorage.onChange.add(this.handleChange);
        FarmUpgradeStorage.onChange.add(this.handleChange);
        this.root.once('destroyed', () => {
            EconomyStorage.onChange.remove(this.handleChange);
            FarmUpgradeStorage.onChange.remove(this.handleChange);
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
        const owned = this.farmIds.filter(farmId => FarmPlotStorage.isOwned(farmId));
        if (owned.length === 0) {
            this.contentArea.addChild(new PIXI.Text('No farms yet.', TextStyleRegistry.Inventory));
        }
        owned.forEach((farmId, index) => this.renderRow(index, farmId));
        this.scrollView.refresh();
    }

    private upgrade(farmId: string): void {
        // Re-read the saved level — the row may be a frame stale.
        const next = getNextFarmUpgrade(farmId, FarmUpgradeStorage.getLevel(farmId));
        if (!next || !EconomyStorage.spend(CurrencyType.Money, next.cost)) {
            return;
        }
        FarmUpgradeStorage.setLevel(farmId, next.level);
        GameAnalytics.farmUpgraded(farmId, next.level);
    }

    /** "+40% price · x1.5 speed · +1 per harvest" — what `level` gives (or "No bonus yet" at level 1). */
    private describe(farmId: string, level: number): string {
        const { growSpeed, yieldBonus, priceBonus } = getFarmUpgradeStats(farmId, level);
        const parts: string[] = [];
        if (priceBonus > 0) {
            parts.push(`+${Math.round(priceBonus * 100)}% price`);
        }
        if (growSpeed !== 1) {
            parts.push(`x${Number(growSpeed.toFixed(2))} speed`);
        }
        if (yieldBonus > 0) {
            parts.push(`+${yieldBonus} per harvest`);
        }
        return parts.length > 0 ? parts.join(' · ') : 'No bonus yet';
    }

    private renderRow(index: number, farmId: string): void {
        const row = new PIXI.Container();
        row.position.set(0, index * (ROW_HEIGHT + ROW_GAP));
        this.contentArea.addChild(row);

        const level = FarmUpgradeStorage.getLevel(farmId);
        const next = getNextFarmUpgrade(farmId, level);
        const cropId = getFarmPlotConfig(farmId).assignedCropId;
        const crop = cropId ? CROP_CONFIG[cropId] : undefined;

        let textX = 0;
        if (crop) {
            const icon = new PIXI.Sprite(getAssetIcon(resolveResourceAssetKey(crop.yield.resourceType)));
            icon.anchor.set(0, 0.5);
            icon.width = CROP_ICON_SIZE;
            icon.height = CROP_ICON_SIZE;
            icon.position.set(0, ROW_HEIGHT / 2);
            row.addChild(icon);
            textX = CROP_ICON_SIZE + CROP_ICON_GAP;
        }

        const nameLabel = new PIXI.Text(crop ? `${crop.name} Farm` : farmId, TextStyleRegistry.Inventory);
        nameLabel.anchor.set(0, 0.5);
        nameLabel.position.set(textX, 16);
        row.addChild(nameLabel);

        const badgeLabel = new PIXI.Text(next ? `Lv ${level} → ${next.level}` : `Lv ${level}/${getFarmMaxLevel(farmId)}`, {
            ...TextStyleRegistry.Inventory, fontSize: 14, fill: next ? '#33cc66' : '#f5c542',
        });
        badgeLabel.anchor.set(0, 0.5);
        badgeLabel.position.set(textX + nameLabel.width + 6, 16);
        row.addChild(badgeLabel);

        const effectLabel = new PIXI.Text(next ? this.describe(farmId, next.level) : this.describe(farmId, level), {
            ...TextStyleRegistry.Inventory, fontSize: 14,
        });
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
            onClick: enabled ? () => this.upgrade(farmId) : () => { /* disabled — no-op */ },
        });
        button.position.set(CONTENT_WIDTH - ROW_BUTTON_WIDTH, ROW_HEIGHT / 2 - ROW_BUTTON_HEIGHT / 2);
        button.alpha = enabled ? 1 : 0.5;
        row.addChild(button);
    }
}
