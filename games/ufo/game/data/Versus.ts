// Versus.ts
//
// Versus mode (ui/versus.json): a fake multiplayer. A match is an arena's timed round — the biggest saucer when the
// clock runs out wins — against computer saucers given players' names, faces and trophies (the matchmaking window
// "finds" them). The player's finishing place wins or loses trophies (`places`); trophies pick a tier, and the tier how
// strong the rivals are; the first few matches are easy. Arenas open after a story level, then by the most trophies the
// player's had; the trophy road gives a reward at each trophy count. The player's own state is in UfoProgress.

import file from '../../ui/versus.json';
import { hashWords, usernameFrom } from './Profile';
import { UfoProgress } from './UfoProgress';

export interface VersusTier { from: number; name: string; badge: string; strength: number; speed: number }

export interface VersusArena {
    id: string;
    name: string;
    /** The level file it's played on. */
    level: string;
    rivals: number;
    seconds: number;
    /** It opens once this story level's been won (0: from the start). */
    afterLevel: number;
    /** And once the player's had this many trophies. */
    trophies: number;
    /** Coins by place, 1st first. */
    coins: number[];
    colours: { top: string; bottom: string };
}

/** A road reward: coins, or a spaceship or alien style (ui/saucers.json id). */
export interface VersusReward { coins?: number; ufo?: string; alien?: string }
export interface RoadStep { trophies: number; reward: VersusReward }

interface VersusFile {
    places: number[];
    firstMatches: { count: number; ratios: number[] };
    tiers: VersusTier[];
    arenas: VersusArena[];
    road: RoadStep[];
}

const DATA = file as unknown as VersusFile;

export const VERSUS = DATA;
export const ARENAS: VersusArena[] = DATA.arenas;
export const ROAD: RoadStep[] = [...DATA.road].sort((a, b) => a.trophies - b.trophies);

/** A colour from the file ("#rrggbb") as a number. */
export const colour = (hex: string): number => parseInt(hex.replace('#', ''), 16);

export const arenaById = (id: string): VersusArena | undefined => ARENAS.find((arena) => arena.id === id);

/** Whether `arena`'s open: its story level won (`won`: how many story levels are), and its trophies had. */
export function arenaOpen(arena: VersusArena, won: number, best: number): boolean {
    return won >= arena.afterLevel && best >= arena.trophies;
}

/** What an arena still needs (null: it's open). */
export function arenaNeeds(arena: VersusArena, won: number, best: number): { level?: number; trophies?: number } | null {
    if (won < arena.afterLevel) return { level: arena.afterLevel };
    if (best < arena.trophies) return { trophies: arena.trophies };
    return null;
}

/** Whether versus mode's open at all (its first arena is). */
export const versusOpen = (): boolean => !!ARENAS[0] && arenaOpen(ARENAS[0], UfoProgress.levelsWon, UfoProgress.bestTrophies);

/** The newest arena open (the one the VERSUS tab starts on), its index; 0 if none. */
export function newestOpen(): number {
    let index = 0;
    ARENAS.forEach((arena, i) => {
        if (arenaOpen(arena, UfoProgress.levelsWon, UfoProgress.bestTrophies)) index = i;
    });
    return index;
}

/** The tier for this many trophies, its index. */
export function tierFor(trophies: number): number {
    let index = 0;
    DATA.tiers.forEach((tier, i) => {
        if (trophies >= tier.from) index = i;
    });
    return index;
}

export const tierOf = (trophies: number): VersusTier => DATA.tiers[tierFor(trophies)];

/** Trophies for finishing in `place` (1-based). */
export const trophiesFor = (place: number): number => DATA.places[Math.min(place, DATA.places.length) - 1] ?? 0;

/** Coins for finishing in `place` in `arena`. */
export const coinsFor = (arena: VersusArena, place: number): number => arena.coins[place - 1] ?? 0;

/** How the rivals play a match now: their shares of the player's size and their speed (easy for the first few). */
export function rivalsNow(count: number, ratios: readonly number[]): { ratios: number[]; speed: number } {
    const tier = tierOf(UfoProgress.trophies);
    if (UfoProgress.versusPlayed < DATA.firstMatches.count) {
        const easy = DATA.firstMatches.ratios;
        return { ratios: Array.from({ length: count }, (_, i) => easy[i % easy.length]), speed: Math.min(tier.speed, 0.8) };
    }
    return { ratios: Array.from({ length: count }, (_, i) => ratios[i % ratios.length] * tier.strength), speed: tier.speed };
}

/** Someone in a match: the player or a made-up one. */
export interface VersusPlayer { name: string; face: string; color: number; trophies: number; you?: boolean }

const FACES = 8;
const COLORS = [0xff7ab8, 0x6fc3ff, 0xffb347, 0xb98cff, 0x4fe0d0, 0xff6b6b, 0xffe066, 0x5fe87a];

/** The made-up players a match "finds": names and faces, trophies near the player's. */
export function findPlayers(count: number): VersusPlayer[] {
    const players: VersusPlayer[] = [];
    const salt = Math.floor(Math.random() * 2 ** 31);
    for (let i = 0; players.length < count; i++) {
        const seed = hashWords(`versus:${salt}:${i}`);
        const name = usernameFrom(seed);
        if (name === UfoProgress.username || players.some((player) => player.name === name)) continue;
        const trophies = Math.max(0, UfoProgress.trophies + Math.round(((seed % 1000) / 1000 - 0.5) * 80));
        players.push({ name, face: `ProfileFace_s_0${seed % FACES}`, color: COLORS[(seed >>> 8) % COLORS.length], trophies });
    }
    return players;
}

/** The players the matchmaking found for the match about to start (the rivals take their names and faces). */
let matchPlayers: VersusPlayer[] = [];
export const setMatchPlayers = (players: VersusPlayer[]): void => { matchPlayers = players; };
export const currentMatchPlayers = (): VersusPlayer[] => matchPlayers;

/** The road's next step past `trophies` (null: the end), and the trophies of the one before. */
export function roadAround(trophies: number): { from: number; next: RoadStep | null } {
    const next = ROAD.find((step) => step.trophies > trophies) ?? null;
    const before = [...ROAD].reverse().find((step) => step.trophies <= trophies);
    return { from: before?.trophies ?? 0, next };
}

/** The trophies a style's road step needs, if it's one of the road's (then it's only had there, never bought). */
export function roadTrophiesFor(kind: 'ufo' | 'alien', id: string): number | null {
    return ROAD.find((step) => step.reward[kind] === id)?.trophies ?? null;
}

/** Road steps reached and not claimed yet. */
export const roadWaiting = (): RoadStep[] => ROAD.filter((step) => step.trophies <= UfoProgress.bestTrophies && !UfoProgress.roadClaimed(step.trophies));
