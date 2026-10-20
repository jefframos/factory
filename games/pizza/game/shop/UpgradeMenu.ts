// UpgradeMenu.ts
//
// What the upgrades menu sells, and buying it — the logic behind the bottom-left backpack button
// (ui/UpgradeMenuButton.ts) and its popup (ui/popups/UpgradesPopup.ts). Tool upgrades used to be
// bought by standing in shops on the map; those map objects now sit on Tiled's "backup" layer and
// the same ShopTypes.ts ladders are sold here instead (ShopUpgradeStorage keeps the levels, so a
// save that bought levels at a map shop keeps them).
//
// Entry order is MENU_ORDER. An entry is listed when:
//   - its tool is owned (ItemStorage — the backpack/carrier and axe from the start, the pickaxe
//     once crafted, ...): "new upgrades appear as new tools are found";
//   - its shop's own appearRequirement is met, and it isn't disabled;
//   - its SHOW_AFTER gate is met — the axe waits for the first backpack upgrade, so the menu's
//     first visit is one clear choice (see the lesson below).
//
// The button itself (isButtonUnlocked()) appears once the FTUE (zone 0's tutorial) is over AND the
// wallet first covers the first backpack level — and stays for good after that.
//
// The lesson: until the first backpack level is bought (UpgradeMenuStorage.lessonDone) the button
// pulses with "!" and, inside the menu, a hand points at the backpack's Buy button. After that,
// the "!" means "something here is affordable or new".
//
// A purchase is instant: money from the wallet, resources from the backpack, then
// ShopUpgradeStorage funds and completes the level (applyShopLevel() — chop/mine/slash stats, or
// the carrier's capacity read on demand).

import { Signal } from 'signals';
import { getShopConfig, getShopMaxLevel, getUpgradeCost, ShopConfig, ShopCost } from './ShopTypes';
import { ShopUpgradeStorage } from './ShopUpgradeStorage';
import { UpgradeMenuStorage } from './UpgradeMenuStorage';
import { getToolStartLevel, TOOL_LIBRARY, ToolVisualEntry } from '../actions/ToolRegistry';
import { ResourceType } from '../actions/ResourceTypes';
import { ItemStorage } from '../crafting/ItemStorage';
import { ItemType } from '../crafting/ItemTypes';
import { EconomyStorage } from '../data/EconomyStorage';
import { CurrencyType } from '../data/EconomyTypes';
import { BackpackStorage } from '../data/BackpackStorage';
import { isMilestoneRequirementMet } from '../data/MilestoneRequirement';
import { getCarrierCapacityAtLevel, getCarrierLevel } from '../data/CarrierCapacity';
import { TutorialProgressStorage } from '../tutorial/TutorialProgressStorage';
import { ZONE_TUTORIAL_CONFIG } from '../tutorial/ZoneTutorialTypes';
import { GameAnalytics } from '../analytics/GameAnalytics';

/** The backpack — the menu's first (and, until it's bought, only) entry. */
export const FIRST_UPGRADE_SHOP_ID = 'shopBackpack';

const MENU_ORDER = ['shopBackpack', 'shop1', 'shop2', 'shopKnife'];

/** Extra gate per entry — listed only once another entry reached a level (see this file's own doc). */
const SHOW_AFTER: Partial<Record<string, { shopId: string; level: number }>> = {
    shop1: { shopId: FIRST_UPGRADE_SHOP_ID, level: 1 },
};

export interface UpgradeMenuEntry {
    shopId: string;
    config: ShopConfig;
    name: string;
    /** Levels bought so far (0 = none). */
    level: number;
    maxLevel: number;
    /** The next level's price — undefined at max. */
    cost?: ShopCost;
    /** The level after that, for "then: ..." — undefined when the next one is the last. */
    costAfter?: ShopCost;
    /** "Carry 3 → 4" / "Per hit 1.8 → 2.7 · Speed 1.2 → 1.4/s" (now -> after the next level); at max, just now. */
    effect: string;
    affordable: boolean;
    /** Never seen with the menu open — wears NEW. */
    isNew: boolean;
}

/** (shopId, newLevel) after every purchase made through UpgradeMenu.buy(). */
const onPurchase: Signal = new Signal();

export const UpgradeMenu = {
    onPurchase,

    /** Every entry the menu lists right now, in MENU_ORDER. */
    getEntries(): UpgradeMenuEntry[] {
        return MENU_ORDER.filter(isListed).map(shopId => buildEntry(shopId, getShopConfig(shopId)!));
    },

    canAfford(shopId: string): boolean {
        const config = getShopConfig(shopId);
        return config !== undefined && isListed(shopId) && canPay(shopId, config);
    },

    /** Something listed is affordable or new — the button's "!" (see UpgradeMenuButton.ts). */
    needsAttention(): boolean {
        return MENU_ORDER.some(shopId => isListed(shopId) && (!UpgradeMenuStorage.hasSeen(shopId) || canPay(shopId, getShopConfig(shopId)!)));
    },

    /** See this file's own doc — checked every frame by the button; latches UpgradeMenuStorage.unlocked. */
    isButtonUnlocked(): boolean {
        if (UpgradeMenuStorage.isUnlocked()) {
            return true;
        }
        const ftue = ZONE_TUTORIAL_CONFIG[0];
        const ftueDone = !ftue || TutorialProgressStorage.getCompletedStepCount(0) >= ftue.steps.length;
        if (ftueDone && this.canAfford(FIRST_UPGRADE_SHOP_ID)) {
            UpgradeMenuStorage.markUnlocked();
            return true;
        }
        return false;
    },

    /** True until the first backpack level is bought — the hand in the menu, the pulsing button. */
    isLessonPending(): boolean {
        return !UpgradeMenuStorage.isLessonDone() && ShopUpgradeStorage.getLevel(FIRST_UPGRADE_SHOP_ID) === 0;
    },

    /** Buys `shopId`'s next level if it's listed and affordable. Returns the new level, or undefined. */
    buy(shopId: string): number | undefined {
        const config = getShopConfig(shopId);
        if (!config || !isListed(shopId) || !canPay(shopId, config)) {
            return undefined;
        }
        const money = ShopUpgradeStorage.getRemainingMoney(shopId, config);
        const resources = remainingResources(shopId, config);
        if (money > 0 && !EconomyStorage.spend(CurrencyType.Money, money)) {
            return undefined;
        }
        for (const [type, amount] of resources) {
            BackpackStorage.remove(type, amount);
        }
        ShopUpgradeStorage.addProgress(shopId, config, money);
        for (const [type, amount] of resources) {
            ShopUpgradeStorage.addResourceProgress(shopId, config, type, amount);
        }
        const level = ShopUpgradeStorage.tryCompleteUpgrade(shopId, config);
        if (level === undefined) {
            return undefined;
        }
        if (shopId === FIRST_UPGRADE_SHOP_ID) {
            UpgradeMenuStorage.markLessonDone();
        }
        GameAnalytics.shopUpgradeBought(config.tool, level);
        this.onPurchase.dispatch(shopId, level);
        return level;
    },
};

function isListed(shopId: string): boolean {
    const config = getShopConfig(shopId);
    if (!config || config.disabled) {
        return false;
    }
    if (!ItemStorage.hasCount(config.tool as ItemType, 1)) {
        return false;
    }
    if (config.appearRequirement && !isMilestoneRequirementMet(config.appearRequirement)) {
        return false;
    }
    const after = SHOW_AFTER[shopId];
    return !after || ShopUpgradeStorage.getLevel(after.shopId) >= after.level;
}

function canPay(shopId: string, config: ShopConfig): boolean {
    if (ShopUpgradeStorage.isMaxLevel(shopId, config)) {
        return false;
    }
    return EconomyStorage.getBalance(CurrencyType.Money) >= ShopUpgradeStorage.getRemainingMoney(shopId, config)
        && remainingResources(shopId, config).every(([type, amount]) => BackpackStorage.getCount(type) >= amount);
}

/** What's left of the next level's resources (a map shop may have taken part of it already). */
function remainingResources(shopId: string, config: ShopConfig): [ResourceType, number][] {
    const cost = getUpgradeCost(config, ShopUpgradeStorage.getLevel(shopId));
    return (Object.keys(cost.resources) as ResourceType[])
        .map(type => [type, ShopUpgradeStorage.getRemainingResource(shopId, config, type)] as [ResourceType, number])
        .filter(([, amount]) => amount > 0);
}

function buildEntry(shopId: string, config: ShopConfig): UpgradeMenuEntry {
    const level = ShopUpgradeStorage.getLevel(shopId);
    const maxed = ShopUpgradeStorage.isMaxLevel(shopId, config);
    const maxLevel = getShopMaxLevel(config);
    const cost = maxed ? undefined : {
        money: ShopUpgradeStorage.getRemainingMoney(shopId, config),
        resources: Object.fromEntries(remainingResources(shopId, config)) as ShopCost['resources'],
    };
    const costAfter = !maxed && level + 1 < maxLevel ? getUpgradeCost(config, level + 1) : undefined;
    return {
        shopId,
        config,
        name: config.name,
        level,
        maxLevel,
        cost,
        costAfter,
        effect: describeEffect(shopId, config, maxed),
        affordable: canPay(shopId, config),
        isNew: !UpgradeMenuStorage.hasSeen(shopId),
    };
}

/** See UpgradeMenuEntry.effect. */
function describeEffect(shopId: string, config: ShopConfig, maxed: boolean): string {
    const tool = TOOL_LIBRARY[config.tool] as ToolVisualEntry;
    if (config.tool === 'carrier') {
        const now = getCarrierCapacityAtLevel(getCarrierLevel());
        return maxed ? `Carry ${now}` : `Carry ${now} → ${getCarrierCapacityAtLevel(getCarrierLevel() + 1)}`;
    }
    const attrs = tool.attributes;
    if (!attrs || tool.maxLevel <= 0) {
        return '';
    }
    const ladder = getToolStartLevel(config.tool) + ShopUpgradeStorage.getLevel(shopId);
    const at = (level: number, key: 'resourcePerHit' | 'speed'): number => {
        const progress = Math.min(1, level / tool.maxLevel);
        return attrs[key].min + (attrs[key].max - attrs[key].min) * progress;
    };
    const perHit = maxed ? fmt(at(ladder, 'resourcePerHit')) : `${fmt(at(ladder, 'resourcePerHit'))} → ${fmt(at(ladder + 1, 'resourcePerHit'))}`;
    const speed = maxed ? fmt(at(ladder, 'speed')) : `${fmt(at(ladder, 'speed'))} → ${fmt(at(ladder + 1, 'speed'))}`;
    return `Per hit ${perHit} · Speed ${speed}/s`;
}

function fmt(value: number): string {
    return Number(value.toFixed(1)).toString();
}
