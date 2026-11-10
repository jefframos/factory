// MobSave.ts
//
// What carries over between battles, in localStorage: coins, the cannon's upgrade levels (fire rate, energy capacity,
// recharge speed: MobConfig's UPGRADES), which battle is next (the player's progress), and which one is picked to play
// (the main screen's arrows go back through those already reached, to replay one; progress never goes back). A loss never takes any of it away (the brief:
// permanent progression isn't erased).

import { RETRY_EASE, UPGRADES, UpgradeKind } from './MobConfig';
import { PLAY } from './MobLevels';
import { CARD_KINDS, CardKind, SETTINGS, cardCost, cardMaxLevel } from './Settings';

const KEY = 'mob.save';

interface SaveData {
    coins: number;
    /** The next battle to beat (0-based): the furthest the player can pick. */
    battle: number;
    /** The battle picked to play (the main screen's, PLAY starts it): `battle` unless an earlier one's been picked. */
    selected: number;
    /** Debug: every level can be picked (to try every area). */
    unlockAll: boolean;
    /** The units' cards the player has (each unlocked by the first level with its house), and each one's level. */
    cards: CardKind[];
    cardLevels: Partial<Record<CardKind, number>>;
    /** The furthest battle reached (1-based; 0 = none yet): for the progress event, sent once per new best. */
    best: number;
    levels: Record<UpgradeKind, number>;
    /** Losses in a row on the picked battle (each makes it RETRY_EASE.step easier); 0 once it's won or another's picked. */
    retries: number;
    /** The first-card tutorial's been done (the battle paused on the first charged card, for the player to tap it). */
    cardTutorial: boolean;
}

const KINDS = Object.keys(UPGRADES) as UpgradeKind[];
const freshLevels = (): Record<UpgradeKind, number> => Object.fromEntries(KINDS.map((kind) => [kind, 1])) as Record<UpgradeKind, number>;

function load(): SaveData {
    try {
        const stored = JSON.parse(window.localStorage.getItem(KEY) ?? '{}') as Partial<SaveData> & { fireLevel?: number };
        const levels = freshLevels();
        for (const kind of KINDS) {
            // Older saves had only the fire rate, as `fireLevel`.
            const level = stored.levels?.[kind] ?? (kind === 'fire' ? stored.fireLevel : undefined) ?? 1;
            levels[kind] = Math.min(UPGRADES[kind].max, Math.max(1, Math.floor(level)));
        }
        const battle = Math.max(0, stored.battle ?? 0);
        return {
            coins: Math.max(0, stored.coins ?? SETTINGS.startCoins), battle, selected: Math.max(0, Math.floor(stored.selected ?? battle)),
            unlockAll: !!stored.unlockAll, cards: (stored.cards ?? []).filter((kind) => CARD_KINDS.includes(kind)), cardLevels: stored.cardLevels ?? {}, best: Math.max(0, stored.best ?? 0), levels, retries: Math.max(0, Math.floor(stored.retries ?? 0)), cardTutorial: !!stored.cardTutorial,
        };
    } catch {
        return { coins: SETTINGS.startCoins, battle: 0, selected: 0, unlockAll: false, cards: [], cardLevels: {}, best: 0, levels: freshLevels(), retries: 0, cardTutorial: false };
    }
}

const data = load();

function save(): void {
    try {
        window.localStorage.setItem(KEY, JSON.stringify(data));
    } catch {
        // Private mode: it lasts this session.
    }
}

export const MobSave = {
    get coins(): number { return data.coins; },
    /** The next battle to beat (0-based, counting up forever: battleConfig() loops the presets): the progress. */
    get battle(): number { return data.battle; },
    /** The battle picked to play (PLAY starts it; the battle scene plays it). */
    get selected(): number { return Math.min(data.selected, MobSave.furthest); },
    /** The furthest battle that can be picked: the next to beat, or (debug) the last level of every area. */
    get furthest(): number { return Math.max(data.battle, data.unlockAll ? PLAY.length - 1 : 0); },
    get unlockAll(): boolean { return data.unlockAll; },
    get fireLevel(): number { return data.levels.fire; },
    get best(): number { return data.best; },
    /** How much easier the next battle is played (0 .. RETRY_EASE.most): RETRY_EASE.step a loss in a row on it. */
    get ease(): number { return Math.min(RETRY_EASE.most, data.retries * RETRY_EASE.step); },

    /** Lost the picked battle: its next try is easier. */
    lost(): void {
        data.retries++;
        save();
    },

    /** Picks battle `index` to play (the main screen's arrows; the debug picker can pick any). */
    select(index: number): void {
        const next = Math.max(0, Math.floor(index));
        if (next !== data.selected) data.retries = 0;
        data.selected = next;
        save();
    },

    /** Won battle `index`: on to the one after it; past the furthest, that's progress. */
    won(index: number): void {
        data.selected = index + 1;
        data.battle = Math.max(data.battle, index + 1);
        data.retries = 0;
        save();
    },

    /** Whether the first-card tutorial's been done. */
    get cardTutorial(): boolean { return data.cardTutorial; },
    cardTutorialDone(): void {
        data.cardTutorial = true;
        save();
    },

    /** Whether the player has `kind`'s card. */
    hasCard(kind: CardKind): boolean {
        return data.cards.includes(kind);
    },

    /** A level with `kind`'s house was reached: its card is the player's; whether it's new. */
    unlockCard(kind: CardKind): boolean {
        if (data.cards.includes(kind)) return false;
        data.cards.push(kind);
        save();
        return true;
    },

    /** `kind`'s card's level (1 to its top). */
    cardLevel(kind: CardKind): number {
        return Math.min(cardMaxLevel(kind), Math.max(1, data.cardLevels[kind] ?? 1));
    },

    /** The price of `kind`'s card's next level (null at the top). */
    cardCost(kind: CardKind): number | null {
        return cardCost(kind, MobSave.cardLevel(kind));
    },

    /** Buys `kind`'s card's next level if there are the coins; whether it did. */
    buyCard(kind: CardKind): boolean {
        const cost = MobSave.cardCost(kind);
        if (cost === null || data.coins < cost || !data.cards.includes(kind)) return false;
        data.coins -= cost;
        data.cardLevels[kind] = MobSave.cardLevel(kind) + 1;
        save();
        return true;
    },

    /** Debug: a card given or taken away. */
    setCard(kind: CardKind, on: boolean): void {
        data.cards = on ? [...new Set([...data.cards, kind])] : data.cards.filter((card) => card !== kind);
        save();
    },

    /** Debug: every level can be picked (or back to the player's own progress). */
    setUnlockAll(on: boolean): void {
        data.unlockAll = on;
        save();
    },

    /** Battle `number` (1-based) was reached: remembered if it's the furthest yet. */
    reach(number: number): void {
        if (number <= data.best) return;
        data.best = number;
        save();
    },

    /** An upgrade's level (1 .. its max). */
    level(kind: UpgradeKind): number {
        return data.levels[kind];
    },

    /** What its next level costs, or null at the top. */
    cost(kind: UpgradeKind): number | null {
        const upgrade = UPGRADES[kind];
        return data.levels[kind] >= upgrade.max ? null : upgrade.cost[data.levels[kind] - 1];
    },

    /** Buys its next level if affordable; whether it did. */
    buy(kind: UpgradeKind): boolean {
        const cost = MobSave.cost(kind);
        if (cost === null || data.coins < cost) return false;
        data.coins -= cost;
        data.levels[kind]++;
        save();
        return true;
    },

    addCoins(amount: number): void {
        data.coins = Math.max(0, data.coins + amount);
        save();
    },

    /** Debug: play battle `index` (the level picker), whatever's been reached. */
    setBattle(index: number): void {
        data.selected = Math.max(0, Math.floor(index));
        data.battle = Math.max(data.battle, data.selected);
        data.retries = 0;
        save();
    },

    /** Debug: back to a new player. */
    reset(): void {
        data.coins = SETTINGS.startCoins;
        data.battle = 0;
        data.selected = 0;
        data.unlockAll = false;
        data.cards = [];
        data.cardLevels = {};
        data.best = 0;
        // The world map's tiles shown filled in (WorldMapView): none now.
        try {
            window.localStorage.removeItem('mob.mapSeen');
        } catch {
            // No storage.
        }
        data.levels = freshLevels();
        data.retries = 0;
        save();
    },
};
