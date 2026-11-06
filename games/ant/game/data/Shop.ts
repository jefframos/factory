// Shop.ts
//
// The game's economy: the coins a level pays, the power-ups' prices, and the deco — backgrounds (the floor's two checker
// colours) and frames (the picture's tray: its board and its border) — with their prices. The free ones are what a new
// player has (AntSave). The shops (ui/ShopPanel.ts) sell from here; the scenes dress themselves with what's in use.

import { AntSave, DecoKind } from './AntSave';
import type { BoosterId } from '../ui/BoosterBelt';

/** A level's coins: more for later ones; a replay of a level already won pays REPLAY of that. */
const REWARD = { base: 20, perLevel: 3, replay: 0.25 };

export function levelReward(index: number, replay: boolean): number {
    const full = REWARD.base + REWARD.perLevel * index;
    return replay ? Math.max(1, Math.round(full * REWARD.replay)) : full;
}

/** One more of a power-up, for this many coins. */
export const BOOSTER_PRICES: Record<BoosterId, number> = { slot: 60, shuffle: 80, hammer: 100, bomb: 120 };

export interface Background {
    id: string;
    name: string;
    /** The floor's checker: its two colours. */
    light: number;
    dark: number;
    price: number;
}

export interface Frame {
    id: string;
    name: string;
    /** The tray: where the picture sits, and its border. */
    board: number;
    border: number;
    price: number;
}

export const BACKGROUNDS: Background[] = [
    { id: 'peach', name: 'Peach', light: 0xf5c294, dark: 0xf2b583, price: 0 },
    { id: 'mint', name: 'Mint', light: 0xbfe6cf, dark: 0xaedcc1, price: 150 },
    { id: 'sky', name: 'Sky', light: 0xbcdaf2, dark: 0xaacfed, price: 150 },
    { id: 'lavender', name: 'Lavender', light: 0xd8cbef, dark: 0xcbbbe8, price: 200 },
    { id: 'lemon', name: 'Lemon', light: 0xf6e3a2, dark: 0xf1d98a, price: 200 },
    { id: 'rose', name: 'Rose', light: 0xf6c6d0, dark: 0xf0b4c2, price: 250 },
    { id: 'cocoa', name: 'Cocoa', light: 0xc9a487, dark: 0xbb9475, price: 300 },
    { id: 'coral', name: 'Coral', light: 0xf9c2b2, dark: 0xf4ad99, price: 250 },
    { id: 'sage', name: 'Sage', light: 0xd6e0bd, dark: 0xc8d5aa, price: 250 },
    { id: 'ocean', name: 'Ocean', light: 0x9fd4dd, dark: 0x8bc8d3, price: 300 },
    { id: 'berry', name: 'Berry', light: 0xe2b3d3, dark: 0xd7a0c6, price: 300 },
    { id: 'night', name: 'Night', light: 0x5d6390, dark: 0x515783, price: 400 },
];

export const FRAMES: Frame[] = [
    { id: 'wood', name: 'Wood', board: 0xf3dcc3, border: 0xe9c49c, price: 0 },
    { id: 'cream', name: 'Cream', board: 0xfbf3e6, border: 0xeadcc6, price: 120 },
    { id: 'mint', name: 'Mint', board: 0xe8f6ec, border: 0x9fd5b2, price: 180 },
    { id: 'berry', name: 'Berry', board: 0xfbe8ee, border: 0xe59ab0, price: 180 },
    { id: 'sky', name: 'Sky', board: 0xe9f2fb, border: 0x93bfe6, price: 220 },
    { id: 'gold', name: 'Gold', board: 0xfdf3d6, border: 0xe9be4f, price: 350 },
    { id: 'lilac', name: 'Lilac', board: 0xf3ecfb, border: 0xb79be0, price: 220 },
    { id: 'peach', name: 'Peach', board: 0xfff0e4, border: 0xf2a37c, price: 220 },
    { id: 'forest', name: 'Forest', board: 0xeef6e6, border: 0x5f9c5a, price: 300 },
    { id: 'cherry', name: 'Cherry', board: 0xfdeaea, border: 0xd9485f, price: 300 },
    { id: 'slate', name: 'Slate', board: 0xeceff3, border: 0x6b7280, price: 350 },
    { id: 'navy', name: 'Navy', board: 0xe6e8f4, border: 0x4f5a8c, price: 400 },
];

export function decoOf(kind: DecoKind): (Background | Frame)[] {
    return kind === 'background' ? BACKGROUNDS : FRAMES;
}

/** The background and frame in use (the first, if the saved one's gone). */
export function currentBackground(): Background {
    return BACKGROUNDS.find((b) => b.id === AntSave.using('background')) ?? BACKGROUNDS[0];
}

export function currentFrame(): Frame {
    return FRAMES.find((f) => f.id === AntSave.using('frame')) ?? FRAMES[0];
}
