// AntSave.ts
//
// What the player keeps between sessions, in one small localStorage entry (if storage isn't available, it lasts the
// session): the furthest level reached (cleared levels are the ones before it), the levels won at least once, coins,
// how many of each power-up they have, and the deco (backgrounds, frames) they own and use. `selected` is the level the
// main screen shows and PLAY starts — the furthest, or an older one to replay (not saved).

import type { BoosterId } from '../ui/BoosterBelt';

const KEY = 'ant.save';

export type DecoKind = 'background' | 'frame';

interface SaveData {
    level: number;
    won: number[];
    coins: number;
    boosters: Record<BoosterId, number>;
    owned: Record<DecoKind, string[]>;
    using: Record<DecoKind, string>;
}

/** What a new player starts with: a few power-ups to try, the default background and frame. */
const START: SaveData = {
    level: 0,
    won: [],
    coins: 0,
    boosters: { slot: 3, shuffle: 1, hammer: 1, bomb: 1 },
    owned: { background: ['peach'], frame: ['wood'] },
    using: { background: 'peach', frame: 'wood' },
};

function load(): SaveData {
    try {
        const saved = JSON.parse(window.localStorage.getItem(KEY) ?? 'null') as Partial<SaveData> | null;
        return {
            level: Math.max(0, Math.floor(saved?.level ?? 0)),
            won: saved?.won ?? [],
            coins: Math.max(0, Math.floor(saved?.coins ?? 0)),
            boosters: { ...START.boosters, ...saved?.boosters },
            owned: { background: saved?.owned?.background ?? [...START.owned.background], frame: saved?.owned?.frame ?? [...START.owned.frame] },
            using: { ...START.using, ...saved?.using },
        };
    } catch {
        return structuredClone(START);
    }
}

const state = load();
let selected = state.level;

function save(): void {
    try {
        window.localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
        // No storage (private mode): it lasts this session only.
    }
}

export const AntSave = {
    get selected(): number {
        return Math.min(selected, state.level);
    },

    set selected(value: number) {
        selected = Math.max(0, Math.min(value, state.level));
    },

    /** A level reached (won the one before): progress only goes up — replaying an old level doesn't lower it. */
    reach(value: number): void {
        if (value > state.level) AntSave.level = value;
        selected = value;
    },

    get level(): number {
        return state.level;
    },

    set level(value: number) {
        state.level = value;
        selected = value;
        save();
    },

    /** Won before (a replay pays less). */
    hasWon(index: number): boolean {
        return state.won.includes(index);
    },

    markWon(index: number): void {
        if (state.won.includes(index)) return;
        state.won.push(index);
        save();
    },

    get coins(): number {
        return state.coins;
    },

    addCoins(amount: number): void {
        state.coins = Math.max(0, state.coins + amount);
        save();
    },

    /** Spends `amount` if there are that many coins; false (nothing spent) if not. */
    spend(amount: number): boolean {
        if (state.coins < amount) return false;
        state.coins -= amount;
        save();
        return true;
    },

    boosters(id: BoosterId): number {
        return state.boosters[id] ?? 0;
    },

    addBooster(id: BoosterId, amount: number): void {
        state.boosters[id] = Math.max(0, (state.boosters[id] ?? 0) + amount);
        save();
    },

    owns(kind: DecoKind, id: string): boolean {
        return state.owned[kind].includes(id);
    },

    own(kind: DecoKind, id: string): void {
        if (state.owned[kind].includes(id)) return;
        state.owned[kind].push(id);
        save();
    },

    using(kind: DecoKind): string {
        return state.using[kind];
    },

    use(kind: DecoKind, id: string): void {
        state.using[kind] = id;
        save();
    },
};
