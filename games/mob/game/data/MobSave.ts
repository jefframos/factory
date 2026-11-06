// MobSave.ts
//
// What carries over between battles, in localStorage: coins, the cannon's fire-rate level, and which battle is next.
// A loss never takes any of it away (the brief: permanent progression isn't erased).

import { FIRE_UPGRADE_COST, MAX_FIRE_LEVEL } from './MobConfig';

const KEY = 'mob.save';

interface SaveData {
    coins: number;
    fireLevel: number;
    battle: number;
}

function load(): SaveData {
    try {
        const data = JSON.parse(window.localStorage.getItem(KEY) ?? '{}') as Partial<SaveData>;
        return { coins: Math.max(0, data.coins ?? 0), fireLevel: Math.min(MAX_FIRE_LEVEL, Math.max(1, data.fireLevel ?? 1)), battle: Math.max(0, data.battle ?? 0) };
    } catch {
        return { coins: 0, fireLevel: 1, battle: 0 };
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
    get fireLevel(): number { return data.fireLevel; },
    /** The next battle to play (0-based, counting up forever: battleConfig() loops the presets). */
    get battle(): number { return data.battle; },

    addCoins(amount: number): void {
        data.coins = Math.max(0, data.coins + amount);
        save();
    },

    /** Won: on to the next battle. */
    nextBattle(): void {
        data.battle++;
        save();
    },

    /** What the next fire-rate level costs, or null at the top. */
    get upgradeCost(): number | null {
        return data.fireLevel >= MAX_FIRE_LEVEL ? null : FIRE_UPGRADE_COST[data.fireLevel - 1];
    },

    /** Buys the next fire-rate level if affordable; whether it did. */
    buyFireLevel(): boolean {
        const cost = MobSave.upgradeCost;
        if (cost === null || data.coins < cost) return false;
        data.coins -= cost;
        data.fireLevel++;
        save();
        return true;
    },

    /** Debug: back to a new player. */
    reset(): void {
        data.coins = 0;
        data.fireLevel = 1;
        data.battle = 0;
        save();
    },
};
