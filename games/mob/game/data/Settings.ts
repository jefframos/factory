// Settings.ts
//
// The game's global settings (ui/settings.json, the editor's Settings tab), read once:
//   retry            — each loss in a row makes the level's next try `step` easier, up to `most` (MobConfig RETRY_EASE);
//   loopHarder       — how much harder each loop through all the levels gets (LevelList);
//   startCoins       — a new player's coins (MobSave);
//   loseCoins        — the coins a lost battle still gives;
//   replayReward     — the share of a level's reward a win pays when it's replayed (one already beaten);
//   cards            — the units' cards (the bottom of the battle: each unlocked one charges, then a tap on it sends its
//                      unit out of the cannon), each with its own progression: how many levels, each level's price
//                      in gems (`cost[level - 1]` buys the next), and its stats at level 1 and at the top (in even steps between):
//                      `hp` (its hits; 0: it can't be destroyed), `damage` (the most it takes off a building), `seconds`
//                      (to charge); and how its picture sits on the card (`icon`: offset, a share of the picture, and
//                      zoom). The units the houses make are another thing: the Units tab's (ui/units.json);
//   housesBlockReds  — whether reds (and giants) bump into houses and go round them (true) or walk over them;
//   upgrades         — the cannon's three: each one's name, how many levels it has, what a level adds (`perLevel`: fire
//                      rate share, energy shots, recharge seconds off: TUNING.fireRatePerLevel / energyPerLevel /
//                      rechargePerLevel), and the price of each level after the first (`cost[level - 1]` buys the next).

import settingsFile from '../../ui/settings.json';

/** The units with a card (as the houses make them: MobConfig HouseKind). */
export type CardKind = 'giant' | 'truck' | 'saucer' | 'car';
export const CARD_KINDS: CardKind[] = ['giant', 'truck', 'saucer', 'car'];

/** A stat at level 1 and at the top level. */
export type StatRange = [number, number];
export interface CardSetting {
    maxLevel: number;
    cost: number[];
    hp?: StatRange;
    damage: StatRange;
    seconds: StatRange;
    icon: { x: number; y: number; zoom: number };
    /** Its main colour (#rrggbb): the card's frame, its bar and glow; its panel a lighter one. */
    colour: string;
}
export type CardStat = 'hp' | 'damage' | 'seconds';

/** `kind`'s card's top level. */
export const cardMaxLevel = (kind: CardKind): number => Math.max(1, Math.floor(SETTINGS.cards[kind].maxLevel));

/** `kind`'s card's `stat` at `level` (in even steps from level 1's to the top's; undefined if it hasn't that stat). */
export function cardStat(kind: CardKind, stat: CardStat, level: number): number | undefined {
    const range = SETTINGS.cards[kind][stat];
    if (!range) return undefined;
    const max = cardMaxLevel(kind);
    const t = max > 1 ? (Math.min(max, Math.max(1, level)) - 1) / (max - 1) : 0;
    const value = range[0] + (range[1] - range[0]) * t;
    return stat === 'seconds' ? Math.round(value * 10) / 10 : Math.round(value);
}

/** The price of `kind`'s card's next level from `level` (null at the top). Past the prices set, each one more by the last step. */
export function cardCost(kind: CardKind, level: number): number | null {
    if (level >= cardMaxLevel(kind)) return null;
    const cost = SETTINGS.cards[kind].cost;
    if (cost[level - 1] !== undefined) return cost[level - 1];
    const last = cost[cost.length - 1] ?? 100;
    const step = Math.max(1, last - (cost[cost.length - 2] ?? last / 2));
    return Math.round(last + step * (level - cost.length));
}

export interface UpgradeSetting { name: string; max: number; perLevel: number; cost: number[] }

export interface GameSettings {
    retry: { step: number; most: number };
    loopHarder: number;
    startCoins: number;
    loseCoins: number;
    replayReward: number;
    cards: Record<CardKind, CardSetting>;
    housesBlockReds: boolean;
    upgrades: { fire: UpgradeSetting; capacity: UpgradeSetting; recharge: UpgradeSetting };
}

export const SETTINGS: GameSettings = settingsFile as GameSettings;
