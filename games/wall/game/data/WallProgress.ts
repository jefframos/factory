// WallProgress.ts
//
// The player's saved state: the wall they're at and the hole they've made in it (which cells are gone, so a reloaded wall has
// the same hole), their cash and bricks, PUNCH HARDER's level, the crew, the boosts, the medals; and what
// follows from them (the damage of a hit, the crew's a second). Kept in the platform's storage (SaveStorage, as YouTube throws
// the browser's away), shortly after any change and as the game's left.

import { SaveStorage } from 'core/platforms/SaveStorage';
import PlatformHandler from 'core/platforms/PlatformHandler';
import { AUTO, AWAY, BOOSTS, BoostDef, CREW, CREW_PER_RUN, CrewDef, HOLD, MAX_RANK, PRODUCTS, ProductDef, RANKS, RELICS, hatOf, rankCost, rankMult, gemsAt, ENEMIES, REWIND, RelicDef, RelicId, SHOWS, WEAK, bricksOf, relicCost, relicValue, crewCost, givenLevel, ToolDef, punchCost, punchDamage, toolAt, toolsUpTo, medalsOf, wallAt } from './WallConfig';

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
    /** Fights won (the first have circles on the minions). */
    fights: number;
    /** When it was last saved (ms since 1970). */
    at: number;
    /** Relics bought with medals: their levels, by id. */
    relics: Record<string, number>;
    /** The shop's one-time products had (bought, or restored from the store). */
    bought: string[];
    /** Gems (bosses drop them), and each crew kind's rank (bought with them): both for good. */
    gems: number;
    ranks: Record<string, number>;
    /** The gems of the bosses passed before there were gems have been given (once). */
    gemsBackPaid: boolean;
    /** How many of the crew a tap hires: 1, 10, or 0 for as many as there's cash for (MAX). */
    buyMode: BuyMode;
    /** The ranks are levels (1 to RANKS.max), not hats (1 to 3) as they were: old saves are moved over once. */
    rankLevels: boolean;
}

/** How many of the crew a tap hires: 1, 10, or 0 for MAX (as many as the cash buys). */
export type BuyMode = 1 | 10 | 0;
/** The modes, in the order the toggle goes round. */
export const BUY_MODES: BuyMode[] = [1, 10, 0];

const fresh = (): SaveData => ({ version: VERSION, wall: 1, cash: 0, punch: 0, best: 1, bricks: 0, crew: {}, boosts: [], medals: 0, runMedals: 0, rewinds: 0, steps: [], played: false, worn: {}, seen: {}, held: '', looks: [], fight: false, farming: false, offers: 0, playSec: 0, fights: 0, at: 0, relics: {}, bought: [], gems: 0, ranks: {}, gemsBackPaid: false, buyMode: 1, rankLevels: true });

function read(): SaveData {
    try {
        const saved = JSON.parse(SaveStorage.getItem(KEY) ?? 'null') as Partial<SaveData> | null;
        if (saved?.version !== VERSION) return fresh();
        // (Medals were trophies at first.)
        const { trophies, runTrophies } = saved as { trophies?: number; runTrophies?: number };
        const state = { ...fresh(), medals: trophies ?? 0, runMedals: runTrophies ?? 0, ...saved };
        // (A save from before gems: those of the bosses already passed on the way to its best wall, once.)
        if (!state.gemsBackPaid) {
            for (let n = ENEMIES.boss.from; n < state.best; n += ENEMIES.boss.every) state.gems += gemsAt(n);
            state.gemsBackPaid = true;
        }
        // (A save from when a rank was its hat, 1 to 3: the level that hat comes at now, so each keeps the hat it bought.)
        if (!saved.rankLevels) {
            for (const id of Object.keys(state.ranks)) state.ranks[id] = RANKS.hatAt[Math.min(RANKS.hatAt.length, state.ranks[id]) - 1] ?? 0;
            state.rankLevels = true;
        }
        return state;
    } catch {
        // A broken save starts fresh.
        return fresh();
    }
}

let state = fresh();
let ready = false;
/** The wall each boost was first there to be bought for them at (this session). */
const affordableSince = new Map<string, number>();
/** All damage, times this, for now (Frenzy). Not saved. */
let frenzy = 1;
/** CREW RUSH's speed while it's on (not saved). */
let crewRush = 1;
/** What the crew earned while they were away, till it's paid. */
let awayCash = 0;
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
        awayCash = this.earnedAway(state.at ? (Date.now() - state.at) / 1000 : 0);
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
        return punchDamage(state.punch) * punch * this.medalMult * this.relic('power') * frenzy + this.crewDps * punchFromCrew;
    },
    /** What a plain hit's made of: the tool's level, the boosts (times), the medals (times), the crew's share (added). */
    get damageParts(): { tool: number; boosts: number; medals: number; relics: number; crew: number } {
        const { punch, punchFromCrew } = boostTotals();
        return { tool: punchDamage(state.punch), boosts: punch, medals: this.medalMult, relics: this.relic('power'), crew: this.crewDps * punchFromCrew };
    },
    get frenzy(): number {
        return frenzy;
    },
    setFrenzy(mult: number): void {
        frenzy = mult;
        changed();
    },
    get cashMult(): number {
        return boostTotals().cash * this.relic('gold') * this.boughtMult('cash');
    },

    // ---------------------------------------------------------------- the shop

    /** A one-time product's had. */
    owns(id: string): boolean {
        return state.bought.includes(id);
    },
    /** What's had for good gives this (x, e.g. DOUBLE CASH's cash; 1: nothing). */
    boughtMult(what: 'cash'): number {
        return PRODUCTS.reduce((mult, def) => (this.owns(def.id) && def.give[what] ? mult * def.give[what]! : mult), 1);
    },
    /** NO ADS: no breaks (videos stay, for who wants their rewards). */
    get noAds(): boolean {
        return PRODUCTS.some((def) => def.give.noAds && this.owns(def.id));
    },
    /** AUTO HOLD: a tap on HOLD keeps it on. */
    get autoHold(): boolean {
        return PRODUCTS.some((def) => def.give.autoHold && this.owns(def.id));
    },
    /**
     * Paid for: what it gives, at once (`look`: picked by the shop, as Looks can't be read from here). A one-time one is had
     * from then on; given twice it isn't (a restore only marks it).
     */
    grant(def: ProductDef): void {
        if (def.kind === 'once') {
            if (this.owns(def.id)) return;
            state.bought.push(def.id);
        }
        const { levels, cashWalls, medals } = def.give;
        if (levels) state.punch += levels;
        if (cashWalls) state.cash += wallAt(state.wall).hp * cashWalls;
        if (medals) state.medals += medals;
        changed();
    },
    /** One-time products the store says are owned (a reinstall, another device): had, nothing given again. */
    restore(ids: string[]): void {
        const once = PRODUCTS.filter((def) => def.kind === 'once' && ids.includes(def.id) && !this.owns(def.id));
        if (!once.length) return;
        state.bought.push(...once.map((def) => def.id));
        changed();
    },

    // ---------------------------------------------------------------- relics

    relicLevel(id: RelicId): number {
        return state.relics[id] ?? 0;
    },
    /** What a relic does now (1 or 0 till it's bought: see relicValue). */
    relic(id: RelicId): number {
        const def = RELICS.find((r) => r.id === id);
        return def ? relicValue(def, this.relicLevel(id)) : 1;
    },
    /** Its next level: there to buy (not at its most), and the medals are there. */
    canBuyRelic(def: RelicDef): boolean {
        const level = this.relicLevel(def.id);
        return (def.max === undefined || level < def.max) && state.medals >= relicCost(def, level);
    },
    /** Any relic there is to buy now. */
    get relicToBuy(): boolean {
        return RELICS.some((def) => this.canBuyRelic(def));
    },
    /** Bought with medals (spent: they give no damage any more); false if it can't be. */
    buyRelic(def: RelicDef): boolean {
        if (!this.canBuyRelic(def)) return false;
        state.medals -= relicCost(def, this.relicLevel(def.id));
        state.relics[def.id] = this.relicLevel(def.id) + 1;
        changed();
        return true;
    },
    /** The crew's hits come this many times as often (STAMPEDE). */
    get crewSpeed(): number {
        return this.relic('stampede') * crewRush;
    },
    /** CREW RUSH (a power-up): the crew this many times as fast while it's on (1: off). */
    setCrewRush(mult: number): void {
        if (mult === crewRush) return;
        crewRush = mult;
        changed();
    },
    /** The HOLD button's there: from the first rewind on (a finger held on the wall punches from the start). */
    get holdButton(): boolean {
        return HOLD.on && state.rewinds > 0;
    },
    /** Hold to punch's punches a second (IRON GRIP adds). */
    get holdRate(): number {
        return HOLD.perSecond + this.relic('grip');
    },
    /** The power-ups' charging time, times this (QUICK CHARGE). */
    get chargeMult(): number {
        return this.relic('charge');
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

    // ---------------------------------------------------------------- away

    earnedAway(seconds: number): number {
        if (seconds < AWAY.after) return 0;
        const { hp, material } = wallAt(state.wall);
        return Math.floor(Math.min(this.crewDps * seconds * AWAY.share, hp * AWAY.mostWalls) * this.cashMult * (material.cash ?? 1));
    },
    /** What the crew earned meanwhile: once. */
    takeAway(): number {
        const earned = awayCash;
        awayCash = 0;
        this.addCash(earned);
        return earned;
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

    /** That kind can be hired: its wall reached in this run (each run brings them back one at a time; `crewPerRun`), or ever. */
    crewOpen(def: CrewDef): boolean {
        return (CREW_PER_RUN ? state.wall : state.best) >= def.wall;
    },

    /** The next kind still to come (shown locked, with its wall), if any. */
    get nextCrew(): CrewDef | undefined {
        return CREW.find((def) => !this.crewOpen(def));
    },

    get crewCount(): number {
        return Object.values(state.crew).reduce((sum, count) => sum + count, 0);
    },

    /** One of them's damage a second. */
    dpsEach(def: CrewDef): number {
        const { crewAll, crewOf } = boostTotals();
        return def.dps * crewAll * (crewOf[def.id] ?? 1) * rankMult(this.rankLevel(def.id)) * this.medalMult * this.relic('power') * this.relic('herd') * this.crewSpeed * frenzy;
    },

    /** All of the crew's damage a second. */
    get crewDps(): number {
        return CREW.reduce((sum, def) => sum + this.owned(def.id) * this.dpsEach(def), 0);
    },

    costOf(def: CrewDef): number {
        return crewCost(def, this.owned(def.id));
    },

    hire(def: CrewDef): boolean {
        return this.hireMany(def, 1);
    },

    /** `count` more of a kind at once (all or none): false if it's not there or the cash isn't. */
    hireMany(def: CrewDef, count: number): boolean {
        const cost = this.costOfMany(def, count);
        if (count < 1 || !this.crewOpen(def) || state.cash < cost) return false;
        state.cash -= cost;
        state.crew[def.id] = this.owned(def.id) + count;
        changed();
        return true;
    },

    /** What `count` more of a kind cost together (each one more ×crewGrowth). */
    costOfMany(def: CrewDef, count: number): number {
        let sum = 0;
        for (let i = 0; i < count; i++) sum += crewCost(def, this.owned(def.id) + i);
        return sum;
    },

    /** How many of a kind the cash buys now (MAX). */
    affordable(def: CrewDef): number {
        let count = 0;
        let sum = 0;
        for (;;) {
            sum += crewCost(def, this.owned(def.id) + count);
            if (sum > state.cash || count >= 1000) return count;
            count++;
        }
    },

    get buyMode(): BuyMode {
        return BUY_MODES.includes(state.buyMode) ? state.buyMode : 1;
    },

    /** A mode picked (the menu's tabs; kept). */
    setBuyMode(mode: BuyMode): void {
        if (!BUY_MODES.includes(mode) || mode === state.buyMode) return;
        state.buyMode = mode;
        changed();
    },

    /** The toggle: x1, x10, MAX, round again (kept). */
    nextBuyMode(): BuyMode {
        state.buyMode = BUY_MODES[(BUY_MODES.indexOf(this.buyMode) + 1) % BUY_MODES.length];
        changed();
        return state.buyMode;
    },

    /** How many a tap hires of a kind in the mode (MAX: what the cash buys, at least 1 so its price can be shown). */
    buyCount(def: CrewDef): number {
        return this.buyMode === 0 ? Math.max(1, this.affordable(def)) : this.buyMode;
    },

    /** One given (the first of the first kind, when it's there), if there's none yet; false if not. */
    giveFirst(def: CrewDef): boolean {
        if (state.wall < def.wall || this.owned(def.id) > 0) return false;
        state.crew[def.id] = 1;
        changed();
        return true;
    },

    /** One of the crew for those who haven't hired that kind by its wall (auto.crew): whose. */
    giveCrew(): CrewDef | undefined {
        if (state.rewinds > 0) return undefined;
        for (const { wall, id } of AUTO.crew) {
            const def = CREW.find((entry) => entry.id === id);
            if (def && state.wall >= wall && this.giveFirst(def)) return def;
        }
        return undefined;
    },

    /** Money lying about, spent for those who don't (auto.buys*): whether a tool's level was bought, and who was hired. */
    autoBuy(): { punch: boolean; hired: CrewDef[] } {
        const hired: CrewDef[] = [];
        if (state.wall > AUTO.buysUntil) return { punch: false, hired };
        const enough = (cost: number) => state.cash >= cost * AUTO.buysAfter;
        const punch = state.punch > 0 && enough(punchCost(state.punch)) && this.punchHarder();
        const best = [...CREW].reverse();
        while (hired.length < AUTO.hires) {
            const def = best.find((one) => this.crewOpen(one) && enough(this.costOf(one)));
            if (!def || !this.hire(def)) break;
            hired.push(def);
        }
        return { punch, hired };
    },

    /** A boost bought for those who leave their bricks (auto.boosts*): which. */
    autoBoost(): BoostDef | undefined {
        if (state.wall > AUTO.boostsUntil) return undefined;
        const boost = this.boostsThere[0];
        if (!boost || state.bricks < boost.bricks * AUTO.boostsAfter) return undefined;
        // (Theirs to pick for some walls first: one bought for them as it comes up would vanish under their finger.)
        const since = affordableSince.get(boost.id) ?? state.wall;
        affordableSince.set(boost.id, since);
        if (state.wall - since < AUTO.boostsWait) return undefined;
        return this.buyBoost(boost) ? boost : undefined;
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

    /** Back to wall 1: cash, bricks and crew gone, PUNCH HARDER at part of its level (`rewind.keep`); the boosts and the medals kept. */
    rewind(): boolean {
        if (!this.canRewind) return false;
        state.medals += state.runMedals;
        // (HEAD START: further on than wall 1.)
        Object.assign(state, { runMedals: 0, wall: 1 + this.relic('start'), punch: Math.max(1, Math.floor(state.punch * REWIND.keep)), held: '', cash: 0, bricks: 0, crew: {}, state: undefined, fight: false, farming: false, rewinds: state.rewinds + 1 });
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
        // (Only the first time up: after a rewind the medals make the going easy.)
        const level = state.rewinds > 0 ? 0 : givenLevel(state.wall);
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
    get fights(): number {
        return state.fights;
    },
    countFight(): void {
        state.fights++;
        changed();
    },
    /** A boss beaten: bricks more. */
    bossReward(bricks: number, gems = 0): void {
        state.bricks += bricks;
        state.gems += gems;
        changed();
    },

    // ---------------------------------------------------------------- the crew's ranks

    get gems(): number {
        return state.gems;
    },
    /** The hat a kind wears: 0 none, 1 hard hat, 2 viking, 3 crown (from its rank level). */
    rankOf(id: string): number {
        return hatOf(this.rankLevel(id));
    },
    /** A kind's rank level: 0 to MAX_RANK. */
    rankLevel(id: string): number {
        return state.ranks[id] ?? 0;
    },
    /** Gems got (a fight beaten): kept for good. */
    addGems(gems: number): void {
        if (gems <= 0) return;
        state.gems += gems;
        changed();
    },
    /** The first boss has been passed, or there are gems, or a rank's been bought: the crew's menu is there. */
    get ranksKnown(): boolean {
        return state.gems > 0 || state.best > ENEMIES.boss.from || Object.values(state.ranks).some((rank) => rank > 0);
    },
    canRank(def: CrewDef): boolean {
        const level = this.rankLevel(def.id);
        return level < MAX_RANK && state.best >= def.wall && state.gems >= rankCost(def, level);
    },
    /** A rank there to buy now (the crew's button is marked). */
    get rankToBuy(): boolean {
        return CREW.some((def) => this.canRank(def));
    },
    /** The next rank level of a kind, for gems; false if it can't be. */
    buyRank(def: CrewDef): boolean {
        if (!this.canRank(def)) return false;
        const level = this.rankLevel(def.id);
        state.gems -= rankCost(def, level);
        state.ranks[def.id] = level + 1;
        changed();
        return true;
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
            // (What's waiting to be paid isn't lost if they leave before the first click.)
            if (awayCash === 0) state.at = Date.now();
            SaveStorage.setItem(KEY, JSON.stringify(state));
        } catch (error) {
            console.warn('[WallProgress] could not save', error);
        }
    },

    /** RESET DATA (the settings): the save erased from the platform's storage, waited for, then the game starts over. */
    async wipe(): Promise<void> {
        ready = false;
        window.clearTimeout(timer);
        try {
            await PlatformHandler.instance.platform?.removeItem(KEY);
        } catch (error) {
            console.warn('[WallProgress] wipe failed', error);
        }
        SaveStorage.removeItem(KEY);
        window.location.reload();
    },

    /** Debug: a new game. */
    reset(): void {
        ready = false;
        window.clearTimeout(timer);
        SaveStorage.removeItem(KEY);
        window.location.reload();
    },
};
