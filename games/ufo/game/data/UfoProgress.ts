// UfoProgress.ts
//
// What the player keeps between sessions: whether the tutorial's done, coins, the UFO styles and aliens they own, and which
// they're wearing. Styles come in two sections: classics, unlocked at random for watching a video, and specials (those with a
// `price`), bought with coins.

import { LOOKS, eraseMissionSave } from './UfoConfig';

export type ShopKind = 'ufo' | 'alien';
export type ShopSection = 'classics' | 'specials';

const KEY = 'ufo.progress';

interface Saved {
    coins: number;
    ufos: string[];
    aliens: string[];
    ufo?: string;
    alien?: string;
    tutorialDone?: boolean;
}

function load(): Saved {
    try {
        const saved = JSON.parse(window.localStorage.getItem(KEY) ?? '{}') as Partial<Saved>;
        return { coins: saved.coins ?? 0, ufos: saved.ufos ?? [], aliens: saved.aliens ?? [], ufo: saved.ufo, alien: saved.alien, tutorialDone: saved.tutorialDone };
    } catch {
        return { coins: 0, ufos: [], aliens: [] };
    }
}

const state = load();
// What's in the data as worn at the start is owned from the start.
if (!state.ufos.includes(LOOKS.ufo)) state.ufos.push(LOOKS.ufo);
if (!state.aliens.includes(LOOKS.alien)) state.aliens.push(LOOKS.alien);
if (state.ufo && LOOKS.ufos.some((style) => style.id === state.ufo)) LOOKS.ufo = state.ufo;
if (state.alien && LOOKS.aliens.some((style) => style.id === state.alien)) LOOKS.alien = state.alien;

function save(): void {
    try {
        window.localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
        // No storage: it lasts this session.
    }
}

const ownedOf = (kind: ShopKind): string[] => (kind === 'ufo' ? state.ufos : state.aliens);
const stylesOf = (kind: ShopKind) => (kind === 'ufo' ? LOOKS.ufos : LOOKS.aliens);

export const UfoProgress = {
    get coins(): number {
        return state.coins;
    },

    get tutorialDone(): boolean {
        return state.tutorialDone === true;
    },

    finishTutorial(): void {
        state.tutorialDone = true;
        save();
    },

    /** Forgets everything and starts over, from the tutorial (the debug panel's). */
    eraseAndRestart(): void {
        try {
            window.localStorage.removeItem(KEY);
        } catch {
            // No storage: nothing was kept.
        }
        eraseMissionSave();
        const url = new URL(window.location.href);
        url.searchParams.delete('city');
        window.location.href = url.toString();
    },

    addCoins(amount: number): void {
        state.coins += amount;
        save();
    },

    /** A section's styles, in the order they're listed. */
    inSection(kind: ShopKind, section: ShopSection) {
        return stylesOf(kind).filter((style) => (section === 'specials') === Boolean(style.price));
    },

    priceOf(kind: ShopKind, id: string): number {
        return stylesOf(kind).find((style) => style.id === id)?.price ?? 0;
    },

    isOwned(kind: ShopKind, id: string): boolean {
        return ownedOf(kind).includes(id);
    },

    ownedCount(kind: ShopKind, section: ShopSection): number {
        return this.inSection(kind, section).filter((style) => this.isOwned(kind, style.id)).length;
    },

    worn(kind: ShopKind): string {
        return kind === 'ufo' ? LOOKS.ufo : LOOKS.alien;
    },

    wear(kind: ShopKind, id: string): void {
        if (kind === 'ufo') {
            LOOKS.ufo = id;
            state.ufo = id;
        } else {
            LOOKS.alien = id;
            state.alien = id;
        }
        save();
    },

    /** Whether there's a classic left to unlock. */
    anyClassicLocked(kind: ShopKind): boolean {
        return this.inSection(kind, 'classics').some((style) => !this.isOwned(kind, style.id));
    },

    /** Unlocks a random locked classic (the video's been watched) and wears it; its id, or null if there's none left. */
    unlockRandom(kind: ShopKind): string | null {
        const locked = this.inSection(kind, 'classics').filter((style) => !this.isOwned(kind, style.id));
        if (!locked.length) return null;
        const { id } = locked[Math.floor(Math.random() * locked.length)];
        ownedOf(kind).push(id);
        this.wear(kind, id);
        return id;
    },

    /** Buys a special and wears it; whether it could be paid for. */
    buy(kind: ShopKind, id: string): boolean {
        const price = this.priceOf(kind, id);
        if (this.isOwned(kind, id) || state.coins < price) return false;
        state.coins -= price;
        ownedOf(kind).push(id);
        this.wear(kind, id);
        return true;
    },
};
