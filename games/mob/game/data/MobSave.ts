// MobSave.ts
//
// What carries over between battles, in localStorage: coins, the cannon's upgrade levels (fire rate, energy capacity,
// recharge speed: MobConfig's UPGRADES), and which battle is next. A loss never takes any of it away (the brief:
// permanent progression isn't erased).

import { RETRY_EASE, UPGRADES, UpgradeKind } from './MobConfig';

const KEY = 'mob.save';

interface SaveData {
    coins: number;
    battle: number;
    /** The furthest battle reached (1-based; 0 = none yet): for the progress event, sent once per new best. */
    best: number;
    levels: Record<UpgradeKind, number>;
    /** Losses in a row on the next battle (each makes it RETRY_EASE.step easier); 0 once it's won. */
    retries: number;
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
        return { coins: Math.max(0, stored.coins ?? 0), battle: Math.max(0, stored.battle ?? 0), best: Math.max(0, stored.best ?? 0), levels, retries: Math.max(0, Math.floor(stored.retries ?? 0)) };
    } catch {
        return { coins: 0, battle: 0, best: 0, levels: freshLevels(), retries: 0 };
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
    /** The next battle to play (0-based, counting up forever: battleConfig() loops the presets). */
    get battle(): number { return data.battle; },
    get fireLevel(): number { return data.levels.fire; },
    get best(): number { return data.best; },
    /** How much easier the next battle is played (0 .. RETRY_EASE.most): RETRY_EASE.step a loss in a row on it. */
    get ease(): number { return Math.min(RETRY_EASE.most, data.retries * RETRY_EASE.step); },

    /** Lost the next battle: its next try is easier. */
    lost(): void {
        data.retries++;
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

    /** Debug: play battle `index` next (the level picker). */
    setBattle(index: number): void {
        data.battle = Math.max(0, Math.floor(index));
        data.retries = 0;
        save();
    },

    /** Won: on to the next battle. */
    nextBattle(): void {
        data.battle++;
        data.retries = 0;
        save();
    },

    /** Debug: back to a new player. */
    reset(): void {
        data.coins = 0;
        data.battle = 0;
        data.best = 0;
        data.levels = freshLevels();
        data.retries = 0;
        save();
    },
};
