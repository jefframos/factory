// WallProgress.ts
//
// The player's saved state: the wall they're at and the hole they've made in it (which cells are gone, so a reloaded wall has
// the same hole), their cash and bricks, PUNCH HARDER's level, the crew, the boosts, the medals; and what
// follows from them (the damage of a hit, the crew's a second). Kept in the platform's storage (SaveStorage, as YouTube throws
// the browser's away), shortly after any change and as the game's left.

import { SaveStorage } from 'core/platforms/SaveStorage';
import { BOOSTS, BoostDef, CREW, CrewDef, REWIND, SHOWS, WEAK, bricksOf, crewCost, givenLevel, ToolDef, punchCost, punchDamage, toolAt, toolsUpTo, medalsOf } from './WallConfig';

const KEY = 'wall.save';
const VERSION = 1;
const SAVE_DELAY_MS = 2000;

/** The wall as it stands. */
export interface WallState {
    seed: number;
    /** The cells gone, a bit each (base64). */
    gone: string;
}

interface SaveData {
    version: number;
    wall: number;
    cash: number;
    punch: number;
    state?: WallState;
    /** The furthest wall ever reached. */
    best: number;
    bricks: number;
    /** Copies owned, by id. */
    crew: Record<string, number>;
    boosts: string[];
    /** Medals cashed in (all damage up, for good), those of this run, and how many times they've rewound. */
    medals: number;
    runMedals: number;
    rewinds: number;
    /** Funnel steps done (WallAnalytics), and what's been shown once. */
    steps: string[];
    played: boolean;
    /** What's worn, by slot (data/Looks), the walls each slot's things had been seen up to, and the tool held ('': the newest). */
    worn: Record<string, string>;
    seen: Record<string, number>;
    held: string;
    /** Looks got other than with a wall (`slot:id`), offers shown, and seconds played. */
    looks: string[];
    /** The wall's down and what's behind it isn't; the boss got away (its minions are there). */
    fight: boolean;
    farming: boolean;
    offers: number;
    playSec: number;
}

const fresh = (): SaveData => ({ version: VERSION, wall: 1, cash: 0, punch: 0, best: 1, bricks: 0, crew: {}, boosts: [], medals: 0, runMedals: 0, rewinds: 0, steps: [], played: false, worn: {}, seen: {}, held: '', looks: [], fight: false, farming: false, offers: 0, playSec: 0 });

function read(): SaveData {
    try {
        const saved = JSON.parse(SaveStorage.getItem(KEY) ?? 'null') as Partial<SaveData> | null;
        if (saved?.version !== VERSION) return fresh();
        // (Medals were trophies at first.)
        const { trophies, runTrophies } = saved as { trophies?: number; runTrophies?: number };
        return { ...fresh(), medals: trophies ?? 0, runMedals: runTrophies ?? 0, ...saved };
    } catch {
        // A broken save starts fresh.
        return fresh();
    }
}

let state = fresh();
let ready = false;
let timer: number | undefined;
let wallState: (() => WallState | undefined) | undefined;
const listeners = new Set<() => void>();

/** What the boosts owned come to. */
interface Totals {
    crewAll: number;
    crewOf: Record<string, number>;
    punch: number;
    punchFromCrew: number;
    cash: number;
    weak: number;
    combo: number;
}

let totals: Totals | undefined;

function boostTotals(): Totals {
    if (totals) return totals;
    totals = { crewAll: 1, crewOf: {}, punch: 1, punchFromCrew: 0, cash: 1, weak: 1, combo: 0 };
    for (const { id, effect } of BOOSTS) {
        if (!state.boosts.includes(id)) continue;
        if (effect.crewId) totals.crewOf[effect.crewId] = (totals.crewOf[effect.crewId] ?? 1) * (effect.crew ?? 1);
        else totals.crewAll *= effect.crew ?? 1;
        totals.punch *= effect.punch ?? 1;
        totals.punchFromCrew += effect.punchFromCrew ?? 0;
        totals.cash *= effect.cash ?? 1;
        totals.weak *= effect.weak ?? 1;
        totals.combo += effect.combo ?? 0;
    }
    return totals;
}

function changed(): void {
    listeners.forEach((listener) => listener());
    if (timer === undefined) timer = window.setTimeout(() => WallProgress.saveNow(), SAVE_DELAY_MS);
}

export const WallProgress = {
    saveKeys: [KEY],

    /** At boot, the platform's storage read. */
    begin(): void {
        state = read();
        totals = undefined;
        ready = true;
        SaveStorage.saveOnLeave(() => this.saveNow());
    },

    /** Called after any change; returns how to stop. */
    onChange(listener: () => void): () => void {
        listeners.add(listener);
        return () => listeners.delete(listener);
    },

    /** Where a save gets the wall as it stands (undefined: it's between walls). */
    setWallState(provider: (() => WallState | undefined) | undefined): void {
        wallState = provider;
    },

    get wall(): number {
        return state.wall;
    },
    get cash(): number {
        return state.cash;
    },
    get punchLevel(): number {
        return state.punch;
    },
    // ---------------------------------------------------------------- what's worn and held

    worn(slot: string): string | undefined {
        return state.worn[slot];
    },
    wear(slot: string, id: string): void {
        state.worn[slot] = id;
        changed();
    },
    seenLooks(slot: string): number {
        return state.seen[slot] ?? 0;
    },
    markLooksSeen(slot: string): void {
        if (state.seen[slot] === state.best) return;
        state.seen[slot] = state.best;
        changed();
    },
    hasLook(slot: string, id: string): boolean {
        return state.looks.includes(`${slot}:${id}`);
    },
    addLook(slot: string, id: string): void {
        if (this.hasLook(slot, id)) return;
        state.looks.push(`${slot}:${id}`);
        changed();
    },
    /** Money spent on one; false if there isn't enough. */
    spend(cash: number): boolean {
        if (state.cash < cash) return false;
        state.cash -= cash;
        changed();
        return true;
    },
    get offers(): number {
        return state.offers;
    },
    countOffer(): void {
        state.offers++;
        changed();
    },
    get playSec(): number {
        return state.playSec;
    },
    /** (Saved with whatever's next.) */
    addPlayed(seconds: number): void {
        state.playSec += seconds;
    },
    /** The tool in hand: the one picked, or the newest. */
    get tool(): ToolDef {
        const newest = toolAt(state.punch);
        return state.held ? (toolsUpTo(state.punch).find(({ id }) => id === state.held) ?? newest) : newest;
    },
    get heldPick(): string {
        return state.held;
    },
    hold(id: string): void {
        state.held = id;
        changed();
    },

    // ---------------------------------------------------------------- damage

    /** What a plain hit does. */
    get damage(): number {
        const { punch, punchFromCrew } = boostTotals();
        return punchDamage(state.punch) * punch * this.medalMult + this.crewDps * punchFromCrew;
    },
    /** What a plain hit's made of: the tool's level, the boosts (times), the medals (times), the crew's share (added). */
    get damageParts(): { tool: number; boosts: number; medals: number; crew: number } {
        const { punch, punchFromCrew } = boostTotals();
        return { tool: punchDamage(state.punch), boosts: punch, medals: this.medalMult, crew: this.crewDps * punchFromCrew };
    },
    get cashMult(): number {
        return boostTotals().cash;
    },
    get weakMult(): number {
        return WEAK.mult * boostTotals().weak;
    },
    /** A combo's factor at a step (0: none). */
    comboMult(step: number): number {
        return WEAK.combo[Math.min(step, this.comboSteps, WEAK.combo.length - 1)];
    },
    get comboSteps(): number {
        return WEAK.comboSteps + boostTotals().combo;
    },
    get best(): number {
        return state.best;
    },
    get bricks(): number {
        return state.bricks;
    },
    get medals(): number {
        return state.medals;
    },
    get rewinds(): number {
        return state.rewinds;
    },
    get played(): boolean {
        return state.played;
    },
    markPlayed(): void {
        state.played = true;
    },
    get savedWall(): WallState | undefined {
        return state.state;
    },

    addCash(amount: number): void {
        if (amount <= 0) return;
        state.cash += amount;
        changed();
    },

    /** Debug. */
    addBricks(amount: number): void {
        state.bricks += amount;
        changed();
    },
    skipTo(wall: number): void {
        state.wall = wall;
        state.fight = state.farming = false;
        state.best = Math.max(state.best, wall);
        state.state = undefined;
        state.runMedals = 0;
        for (let n = 1; n < wall; n++) state.runMedals += medalsOf(n);
        changed();
    },

    // ---------------------------------------------------------------- the crew

    owned(id: string): number {
        return state.crew[id] ?? 0;
    },

    get crewCount(): number {
        return Object.values(state.crew).reduce((sum, count) => sum + count, 0);
    },

    /** One of them's damage a second. */
    dpsEach(def: CrewDef): number {
        const { crewAll, crewOf } = boostTotals();
        return def.dps * crewAll * (crewOf[def.id] ?? 1) * this.medalMult;
    },

    /** All of the crew's damage a second. */
    get crewDps(): number {
        return CREW.reduce((sum, def) => sum + this.owned(def.id) * this.dpsEach(def), 0);
    },

    costOf(def: CrewDef): number {
        return crewCost(def, this.owned(def.id));
    },

    hire(def: CrewDef): boolean {
        const cost = this.costOf(def);
        if (state.best < def.wall || state.cash < cost) return false;
        state.cash -= cost;
        state.crew[def.id] = this.owned(def.id) + 1;
        changed();
        return true;
    },

    /** One given (the first of the first kind, when it's there), if there's none yet; false if not. */
    giveFirst(def: CrewDef): boolean {
        if (state.wall < def.wall || this.owned(def.id) > 0) return false;
        state.crew[def.id] = 1;
        changed();
        return true;
    },

    // ---------------------------------------------------------------- boosts

    /** Those there to buy, the cheapest first. */
    get boostsThere(): BoostDef[] {
        if (state.best < SHOWS.boosts) return [];
        return BOOSTS.filter((boost) => !state.boosts.includes(boost.id) && (boost.wall !== undefined ? state.best >= boost.wall : this.owned(boost.crew!) >= boost.count!))
            .sort((a, b) => a.bricks - b.bricks);
    },

    buyBoost(boost: BoostDef): boolean {
        if (state.bricks < boost.bricks || state.boosts.includes(boost.id)) return false;
        state.bricks -= boost.bricks;
        state.boosts.push(boost.id);
        totals = undefined;
        changed();
        return true;
    },

    // ---------------------------------------------------------------- rewinding

    /** All damage, for the medals cashed in. */
    get medalMult(): number {
        return 1 + state.medals * REWIND.perMedal;
    },
    /** What rewinding now would bring, and all damage after it. */
    get runMedals(): number {
        return state.runMedals;
    },
    get multAfterRewind(): number {
        return 1 + (state.medals + state.runMedals) * REWIND.perMedal;
    },
    get canRewind(): boolean {
        return state.wall >= REWIND.wall;
    },

    /** Back to wall 1: cash, bricks and crew gone; PUNCH HARDER, the boosts and the medals kept. */
    rewind(): boolean {
        if (!this.canRewind) return false;
        state.medals += state.runMedals;
        Object.assign(state, { runMedals: 0, wall: 1, cash: 0, bricks: 0, crew: {}, state: undefined, fight: false, farming: false, rewinds: state.rewinds + 1 });
        changed();
        return true;
    },

    /** Marks a funnel step; false if it's done already. */
    markStep(step: string): boolean {
        if (state.steps.includes(step)) return false;
        state.steps.push(step);
        changed();
        return true;
    },
    stepDone(step: string): boolean {
        return state.steps.includes(step);
    },

    // ---------------------------------------------------------------- PUNCH HARDER

    /** The free first level's there to take (once a wall's come down). */
    get giftWaiting(): boolean {
        return state.punch === 0 && state.wall > 1;
    },

    get canPunchHarder(): boolean {
        return state.punch === 0 ? state.wall > 1 : state.cash >= punchCost(state.punch);
    },

    /** Buys the next level (the first is a gift); false if it can't be had. */
    punchHarder(): boolean {
        if (!this.canPunchHarder) return false;
        state.cash -= punchCost(state.punch);
        state.punch++;
        // (A new tool's held at once; bare hands are kept if they're wanted.)
        if (state.held !== 'fists') state.held = '';
        changed();
        return true;
    },

    /** The next tool, if it hasn't been bought by the wall it's given at; false if not. */
    giveTool(): boolean {
        const level = givenLevel(state.wall);
        if (state.punch >= level) return false;
        state.punch = level;
        if (state.held !== 'fists') state.held = '';
        changed();
        return true;
    },

    /** The wall's down, and something's behind it: it's still that wall's till that's beaten. */
    startFight(): void {
        state.fight = true;
        state.state = undefined;
        changed();
    },
    get fighting(): boolean {
        return state.fight;
    },
    get farming(): boolean {
        return state.farming;
    },
    setFarming(on: boolean): void {
        state.farming = on;
        changed();
    },
    /** A boss beaten: bricks and medals more. */
    bossReward(bricks: number, medals: number): void {
        state.bricks += bricks;
        state.runMedals += medals;
        changed();
    },

    /** On to the next wall, with this one's bricks (how many: the answer). */
    nextWall(): number {
        const bricks = bricksOf(state.wall);
        state.bricks += bricks;
        state.runMedals += medalsOf(state.wall);
        state.wall++;
        state.fight = state.farming = false;
        state.best = Math.max(state.best, state.wall);
        state.state = undefined;
        changed();
        return bricks;
    },

    saveNow(): void {
        window.clearTimeout(timer);
        timer = undefined;
        if (!ready) return;
        try {
            state.state = wallState?.() ?? state.state;
            SaveStorage.setItem(KEY, JSON.stringify(state));
        } catch (error) {
            console.warn('[WallProgress] could not save', error);
        }
    },

    /** Debug: a new game. */
    reset(): void {
        ready = false;
        window.clearTimeout(timer);
        SaveStorage.removeItem(KEY);
        window.location.reload();
    },
};
