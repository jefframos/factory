// ArenaRewards.ts
//
// What the player earns (games/mob/ui/arena-rewards.json): the card copies each card's next level needs (a level costs
// copies and gems), the copies a story level won gives, the chests an arena win gives (in a cycle: opened back on the
// main screen), the free chest there (ready every so often, opened by watching a video), what a chest holds, and the
// trophy road (a reward at each trophy count). The player's own state is in MobSave; this is the rules.
//
// No Vite or browser here beyond the JSON (the simulator may bundle it).

import file from '../../ui/arena-rewards.json';
import { CardKind } from './Settings';

export type ChestKind = 'wood' | 'gold' | 'gem';

export interface ChestSetting {
    name: string;
    icon: string;
    coins: [number, number];
    copies: number;
    gems: [number, number];
}

/** A reward: coins, gems, copies (of the player's own cards, spread among them), a chest, or a card (new to them). */
export interface Reward { coins?: number; gems?: number; copies?: number; chest?: ChestKind; card?: CardKind }

export interface RoadStep { trophies: number; reward: Reward }

export interface RewardsFile {
    copies: number[];
    story: { first: number; replay: number };
    cycle: ChestKind[];
    adChest: { kind: ChestKind; seconds: number };
    chests: Record<ChestKind, ChestSetting>;
    road: RoadStep[];
}

export const REWARDS = file as unknown as RewardsFile;
export const ROAD: RoadStep[] = [...REWARDS.road].sort((a, b) => a.trophies - b.trophies);

/** Copies `level`'s next level needs (past the list, its last). */
export function copiesFor(level: number): number {
    const list = REWARDS.copies;
    return list[Math.max(0, level - 1)] ?? list[list.length - 1] ?? 10;
}

/** What opening something gave: coins, gems, and copies of cards. */
export interface Loot { coins: number; gems: number; cards: Partial<Record<CardKind, number>> }

const between = (range: [number, number], random: () => number): number => Math.round(range[0] + (range[1] - range[0]) * random());

/** `count` copies spread over the cards `owned` (up to three of them, the first getting the most). */
export function spreadCopies(count: number, owned: readonly CardKind[], random: () => number = Math.random): Partial<Record<CardKind, number>> {
    const cards: Partial<Record<CardKind, number>> = {};
    if (count <= 0 || !owned.length) return cards;
    const pool = [...owned];
    for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const kinds = pool.slice(0, Math.min(3, pool.length, count));
    let left = count;
    kinds.forEach((kind, i) => {
        const share = i === kinds.length - 1 ? left : Math.max(1, Math.round(left * (0.5 + random() * 0.2)));
        cards[kind] = share;
        left -= share;
    });
    return cards;
}

/** A chest's contents, for a player with the cards `owned` (none: its copies come as coins). */
export function rollChest(kind: ChestKind, owned: readonly CardKind[], random: () => number = Math.random): Loot {
    const chest = REWARDS.chests[kind];
    const loot: Loot = { coins: between(chest.coins, random), gems: between(chest.gems, random), cards: spreadCopies(chest.copies, owned, random) };
    if (!owned.length) loot.coins += chest.copies * 5;
    return loot;
}

/** m:ss (or h:mm:ss) of `ms`. */
export function clockText(ms: number): string {
    const all = Math.max(0, Math.ceil(ms / 1000));
    const h = Math.floor(all / 3600);
    const m = Math.floor((all % 3600) / 60);
    const s = all % 60;
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

/** The road's next step past `trophies` (null: the end of it), and the one before (for a bar between them). */
export function roadAround(trophies: number): { from: number; next: RoadStep | null } {
    const next = ROAD.find((step) => step.trophies > trophies) ?? null;
    const before = [...ROAD].reverse().find((step) => step.trophies <= trophies);
    return { from: before?.trophies ?? 0, next };
}
