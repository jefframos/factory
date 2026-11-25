// Looks.ts
//
// What the hands can wear (ui/looks.json), typed, and how each is got: with a wall reached, bought, or for a video (and any
// of them from an offer while playing).

import data from '../../ui/looks.json';
import { wallAt } from './WallConfig';
import { WallProgress } from './WallProgress';

export type SlotId = 'skin' | 'sleeve' | 'gloves' | 'rings' | 'wrist';
export type Pattern = 'plain' | 'stripes' | 'hoops' | 'checks' | 'dots' | 'stars' | 'flames' | 'camo' | 'bare' | 'ink' | 'hearts' | 'zigzag' | 'leopard' | 'tiger' | 'bolts' | 'plaid' | 'scales' | 'rainbow' | 'space';

export interface LookItem {
    id: string;
    name: string;
    /** From this wall on: it's theirs, it's for sale, or it's for a video. */
    wall?: number;
    buy?: number;
    video?: number;
    color?: string;
    second?: string;
    pattern?: Pattern;
    colors?: string[];
    cuff?: string;
    palm?: string;
    fingers?: string;
    tips?: string;
    nails?: string;
    rough?: number;
    /** Boxing gloves over the hands (the tool: the scene's), and their cuffs. */
    boxing?: string;
    band?: string;
    kind?: string;
}

export interface LookTab {
    id: SlotId;
    name: string;
    items: LookItem[];
}

export type Look = Record<SlotId, LookItem>;

export const LOOK_TABS = data.tabs as unknown as LookTab[];
export const OFFERS = data.offers;

const tabOf = (slot: SlotId): LookTab => LOOK_TABS.find(({ id }) => id === slot)!;

/** The wall it comes with (0: from the start). */
export const lookWall = (item: LookItem): number => item.wall ?? item.buy ?? item.video ?? 0;

/** Had: from the start, with its wall, or got. */
export function ownsLook(slot: SlotId, item: LookItem): boolean {
    if (lookWall(item) === 0 || WallProgress.hasLook(slot, item.id)) return true;
    return item.wall !== undefined && WallProgress.best >= item.wall;
}

/** What it costs (a share of its wall's HP, as a round number). */
export function lookPrice(item: LookItem, share = 1): number {
    const price = wallAt(Math.max(2, lookWall(item))).hp * data.priceShare * share;
    const unit = Math.pow(10, Math.max(0, Math.floor(Math.log10(price)) - 1));
    return Math.max(10, Math.round(price / unit) * unit);
}

/** How it's to be got now: it's had, for money, for a video, or with a wall not reached yet. */
export function lookState(slot: SlotId, item: LookItem): 'had' | 'buy' | 'video' | 'wall' {
    if (ownsLook(slot, item)) return 'had';
    if (WallProgress.best < lookWall(item)) return 'wall';
    return item.buy !== undefined ? 'buy' : 'video';
}

/** Got: theirs, and worn. */
export function gainLook(slot: SlotId, item: LookItem): void {
    WallProgress.addLook(slot, item.id);
    WallProgress.wear(slot, item.id);
}

/** Something not had yet, for an offer: any that comes up to a few walls on. */
export function lookToOffer(not?: LookItem): { slot: SlotId; item: LookItem } | undefined {
    const there = LOOK_TABS.flatMap(({ id, items }) => items.filter((item) => item !== not && !ownsLook(id, item) && lookWall(item) <= WallProgress.best + OFFERS.ahead).map((item) => ({ slot: id, item })));
    return there[Math.floor(Math.random() * there.length)];
}

/** What's worn in a slot. */
export function wornIn(slot: SlotId): LookItem {
    const { items } = tabOf(slot);
    const worn = items.find(({ id }) => id === WallProgress.worn(slot));
    return worn && ownsLook(slot, worn) ? worn : items[0];
}

/** All that's worn. */
export function wornLook(): Look {
    return Object.fromEntries(LOOK_TABS.map(({ id }) => [id, wornIn(id)])) as Look;
}

/** Things got since a tab was last looked at (one not worn from the start). */
export function newLooks(slot?: SlotId): number {
    return LOOK_TABS.filter(({ id }) => !slot || id === slot)
        .reduce((sum, { id, items }) => sum + items.filter((item) => item.wall && ownsLook(id, item) && item.wall > WallProgress.seenLooks(id)).length, 0);
}
