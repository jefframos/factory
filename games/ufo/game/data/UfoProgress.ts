// UfoProgress.ts
//
// What the player keeps between sessions: whether the tutorial's done, coins, the UFO styles and aliens they own, and which
// they're wearing. Styles come in two sections: classics, unlocked at random for watching a video, and specials (those with a
// `price`), bought with coins.

import { AVATARS, AvatarLook, usernameFrom } from './Profile';
import { LOOKS, currentMissionIndex, eraseMissionSave } from './UfoConfig';

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
    /** The ranking screen's been opened: no more pointing at it. */
    rankingSeen?: boolean;
    /** Made once, and can't be changed. */
    username?: string;
    avatar?: number;
    /** Stars this period, by daily/weekly: which period, and how many. */
    stars?: Record<string, { key: string; count: number }>;
    /** Which period each goal was last claimed in. */
    claimed?: Record<string, string>;
    /** How many story levels have been won (the next one's the one after). */
    levelsWon?: number;
    /** Versus: trophies now, the most ever (arenas and the road stay open by it), matches played and won. */
    trophies?: number;
    bestTrophies?: number;
    versusPlayed?: number;
    versusWins?: number;
    /** Arenas whose NEW ARENA moment has been shown; the trophy road's steps claimed (by trophies). */
    arenasSeen?: string[];
    road?: number[];
    /** The versus tutorial's been through (the VERSUS tab, then PLAY ONLINE pointed at). */
    versusTutorial?: boolean;
}

function load(): Saved {
    try {
        const saved = JSON.parse(window.localStorage.getItem(KEY) ?? '{}') as Partial<Saved>;
        return {
            coins: saved.coins ?? 0, ufos: saved.ufos ?? [], aliens: saved.aliens ?? [], ufo: saved.ufo, alien: saved.alien, tutorialDone: saved.tutorialDone, rankingSeen: saved.rankingSeen, username: saved.username, avatar: saved.avatar, stars: saved.stars, claimed: saved.claimed,
            levelsWon: saved.levelsWon, trophies: saved.trophies, bestTrophies: saved.bestTrophies, versusPlayed: saved.versusPlayed, versusWins: saved.versusWins, arenasSeen: saved.arenasSeen, road: saved.road, versusTutorial: saved.versusTutorial,
        };
    } catch {
        return { coins: 0, ufos: [], aliens: [] };
    }
}

const state = load();
// A save from before levels won were counted: the level it's up to says how many were.
state.levelsWon = Math.max(state.levelsWon ?? 0, currentMissionIndex());
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

    get username(): string {
        if (!state.username) {
            state.username = usernameFrom(Math.floor(Math.random() * 2 ** 32));
            save();
        }
        return state.username;
    },

    get avatar(): number {
        return Math.min(state.avatar ?? 0, AVATARS.length - 1);
    },

    get avatarLook(): AvatarLook {
        return AVATARS[this.avatar];
    },

    setAvatar(index: number): void {
        state.avatar = index;
        save();
    },

    get rankingSeen(): boolean {
        return state.rankingSeen === true;
    },

    markRankingSeen(): void {
        state.rankingSeen = true;
        save();
    },

    starsIn(period: string, key: string): number {
        const entry = state.stars?.[period];
        return entry?.key === key ? entry.count : 0;
    },

    addStars(period: string, key: string, stars: number): void {
        state.stars ??= {};
        state.stars[period] = { key, count: this.starsIn(period, key) + stars };
        save();
    },

    isGoalClaimed(id: string, key: string): boolean {
        return state.claimed?.[id] === key;
    },

    claimGoal(id: string, key: string): void {
        state.claimed ??= {};
        state.claimed[id] = key;
        save();
    },

    /** A round's just been played: the home screen opens on the ranking. */
    openRankingOnHome: false,

    /** A versus match has just been played: the home screen opens on VERSUS, the trophies counting from `trophiesBefore`. */
    openVersusOnHome: false,
    trophiesBefore: -1,

    get levelsWon(): number {
        return state.levelsWon ?? 0;
    },

    /** Story level `index` (0-based) won. */
    wonLevel(index: number): void {
        state.levelsWon = Math.max(state.levelsWon ?? 0, index + 1);
        save();
    },

    get trophies(): number {
        return state.trophies ?? 0;
    },

    get bestTrophies(): number {
        return state.bestTrophies ?? 0;
    },

    get versusPlayed(): number {
        return state.versusPlayed ?? 0;
    },

    get versusWins(): number {
        return state.versusWins ?? 0;
    },

    /** A match finished in `place`, worth `trophies` (+ or -) and `coins`. */
    versusResult(place: number, trophies: number, coins: number): void {
        state.trophies = Math.max(0, (state.trophies ?? 0) + trophies);
        state.bestTrophies = Math.max(state.bestTrophies ?? 0, state.trophies);
        state.versusPlayed = (state.versusPlayed ?? 0) + 1;
        if (place === 1) state.versusWins = (state.versusWins ?? 0) + 1;
        state.coins += coins;
        save();
    },

    /** Debug: trophies added (the arenas and the road open by them). */
    debugTrophies(amount: number): void {
        state.trophies = Math.max(0, (state.trophies ?? 0) + amount);
        state.bestTrophies = Math.max(state.bestTrophies ?? 0, state.trophies);
        save();
    },

    arenaSeen(id: string): boolean {
        return (state.arenasSeen ?? []).includes(id);
    },

    markArenaSeen(id: string): void {
        state.arenasSeen = [...new Set([...(state.arenasSeen ?? []), id])];
        save();
    },

    roadClaimed(trophies: number): boolean {
        return (state.road ?? []).includes(trophies);
    },

    /** A road step claimed: its coins, or its style (owned, and worn). */
    claimRoad(trophies: number, reward: { coins?: number; ufo?: string; alien?: string }): void {
        if (this.roadClaimed(trophies) || trophies > this.bestTrophies) return;
        state.road = [...(state.road ?? []), trophies];
        if (reward.coins) state.coins += reward.coins;
        for (const kind of ['ufo', 'alien'] as ShopKind[]) {
            const id = reward[kind];
            if (!id || !stylesOf(kind).some((style) => style.id === id)) continue;
            if (!ownedOf(kind).includes(id)) ownedOf(kind).push(id);
            this.wear(kind, id);
        }
        save();
    },

    get versusTutorial(): boolean {
        return state.versusTutorial === true;
    },

    finishVersusTutorial(): void {
        state.versusTutorial = true;
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
