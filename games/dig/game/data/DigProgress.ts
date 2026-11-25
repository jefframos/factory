// DigProgress.ts
//
// The player's saved state (GDD §15 persistence): money, tool and backpack levels, what's in the
// backpack, finds collected (and which the player has looked at in the collection), the deepest zone
// reached, the wardrobe (owned and worn looks), and which terrain cells have been dug. One entry in the platform's storage
// (SaveStorage: YouTube throws localStorage away), saved shortly after any
// change so a burst of digging writes once. Versioned (SAVE_VERSION): a save from another version starts a new game.

import { Signal } from 'signals';
import { SaveStorage } from 'core/platforms/SaveStorage';
import { HUB, hubBonus, type HubStat } from './HubData';
import { AchievementDef, AchievementStat, BoostDef, BoostId, DIG, MaterialDef, PadKind, PerkDef, PerkId, FindDef, MineTheme, ToolDef, WardrobeItem, animalKind, toolAt } from './DigConfig';
import { NO_TRACTOR_LOOK, TRACTOR_ITEMS, TRACTOR_KINDS, TractorItem, TractorKind, TractorLook } from './TractorSkins';

export type LookKind = 'colors' | 'faces' | 'hats';

/** What the miner wears. */
export interface Look {
    color: string;
    face: string;
    hat: string;
}

/** Something to wear, out of a chest: the miner's or their tractor's. */
export type Cosmetic = { who: 'miner'; kind: LookKind; item: WardrobeItem } | { who: 'tractor'; kind: TractorKind; item: TractorItem };

/** What addFind() reports. */
export interface FindResult {
    /** Never found one of these before. */
    first: boolean;
    /** This find completed the collection (its reward was just paid). */
    completed: boolean;
}

/**
 * What's a dungeon's own: its tunnels and its collection (every one has the same finds to dig up again). The one being
 * played keeps these in the top-level save fields; the others wait here until the player travels back (travelTo()). The gear
 * and the money go along with the player.
 */
export interface MineSnapshot {
    dug: string;
    /** Finds collected in this mine, by id (missing in saves from before collections were per mine). */
    found?: Record<string, number>;
    seen?: string[];
    collectionDone?: boolean;
    /** Rewards waiting in this mine's Trophy Room, by find id (COLLECTION_REWARD = the completed collection's). */
    unclaimed?: Record<string, number>;
}

/** The unclaimed-rewards key of a completed collection's reward (no find has this id). */
export const COLLECTION_REWARD = '__collection';

const SAVE_KEY = 'dig.save';
/**
 * The save format's version: a save written by any other version (or none — every save before versioning) is
 * dropped and the player starts a new game (load()). Bump it when a change can't carry old saves over.
 */
const SAVE_VERSION = 5;
const SAVE_DELAY_MS = 800;
/** Saved at least this often while things keep changing (a tractor never stops digging). */
const SAVE_AT_MOST_MS = 5000;
/** A chest's cosmetic is one of this many cheapest not owned yet. */
const GIFT_FROM = 8;
/** The phone's first sales are free (the first with the hand on it); after these it asks for a rewarded video. */
const PHONE_FREE_SELLS = 2;

interface SaveData {
    /** SAVE_VERSION when it was written. */
    version: number;
    money: number;
    toolLevel: number;
    backpackLevel: number;
    bladesLevel: number;
    padPaid: Partial<Record<PadKind, number>>;
    /** Animals called so far this run. */
    animals: number;
    /** Rebirths; medals to spend and ever; the perks' levels. */
    rebirths: number;
    medals: number;
    medalsEver: number;
    perks: Partial<Record<PerkId, number>>;
    /** The player's experience (their level follows: levelFor), shared by every mine. */
    xp: number;
    /** The tractor's skins: owned (`paints:bee`), worn, and the money when its panel was last opened. */
    tractorOwned: string[];
    tractorLook: TractorLook;
    tractorBudget?: number;
    backpack: Record<string, number>;
    /** Finds collected, by id. */
    found: Record<string, number>;
    /** Finds the player has looked at in the collection (the totem shows "!" for the rest). */
    seen: string[];
    collectionDone: boolean;
    /** The deepest zone reached this run, counting every dungeon's (rebirth.zones each). */
    deepestZone: number;
    /** Bought wardrobe items, by kind. */
    owned: Record<LookKind, string[]>;
    look: Look;
    /** Money when the wardrobe was last opened: things that became affordable since get its "!". */
    wardrobeBudget: number;
    /** The wardrobe has been opened at least once (until then the guide leads the miner to it). */
    wardrobeVisited: boolean;
    /** The wardrobe was opened again after the first hat: unclaimed free looks get their FREE badge from then on. */
    freeLooksOffered: boolean;
    /** Phone sales taken for free so far (the first PHONE_FREE_SELLS skip the video). */
    freeSells: number;
    dug: string;
    /** Hub buildables bought so far (levels/hub.json `buildables`), by id. */
    built: string[];
    /** Counters the achievements read (finds come from `found`). */
    stats: { blocks: number; ores: number; earned: number; sells: number; finds: number };
    /** Total upgrades (tools + backpacks + blades) bought when each hub area appeared — for 'upgradeAfter:<area>' reveals. */
    revealedAt: Record<string, number>;
    /** Achievement tiers claimed, by achievement id. */
    achievements: Record<string, number>;
    /** One-time analytics events already sent (GameAnalytics: tutorial steps, ...), by key. */
    sent: string[];
    /** Boost track levels (ui/dig.json boosts), by id. */
    boosts: Partial<Record<BoostId, number>>;
    /** New mines opened (prestige): each adds a lasting sell / dig bonus (in every mine) and has its own layout. */
    prestige: number;
    /** The mine being played (0 = the first .. prestige = the newest). */
    currentMine: number;
    /** A collection was ever completed, in any mine: the reward hat (the Crown) is owned for good. */
    crownEarned: boolean;
    /**
     * The current mine's rewards dug up but not yet claimed in the Trophy Room, by find id (COLLECTION_REWARD for a
     * completed collection): finds pay out there, so players come back to the hub to collect.
     */
    unclaimed: Record<string, number>;
    /** Every mine's run, by index; the current one's entry is stale (its live values are the fields above). */
    mines: MineSnapshot[];
    /** Seconds of active play, all sessions together (the analytics' time stamps: GameAnalytics). */
    playSeconds: number;
}

/** A price rounded to look like one: to $1 under $100, then to two figures or so. */
function tidyPrice(price: number): number {
    const step = price < 100 ? 1 : 5 * Math.pow(10, Math.floor(Math.log10(price)) - 2);
    return Math.round(price / step) * step;
}

/** The tier (1-based) that unlocks an achievement's hub decoration. */
const decorTier = (achievement: AchievementDef): number => achievement.decorAt ?? achievement.tiers.length;

export const PAD_KINDS: PadKind[] = ['tool', 'capacity', 'blades', 'animals', 'portal'];
/** The pads the early find's pay covers one of. */
const GEAR_PADS: PadKind[] = ['tool', 'capacity', 'blades'];
const perkDef = (id: PerkId): PerkDef => DIG.rebirth.perks.find((perk) => perk.id === id)!;
const materials = new Map<string, MaterialDef>(DIG.materials.map((material) => [material.id, material]));

/** A boost's definition (ui/dig.json boosts). */
const boostDef = (id: BoostId): BoostDef => DIG.boosts.find((b) => b.id === id)!;

/** A new miner: the first colour and face, and no hat (the first hat is the tutorial's first cosmetic buy). */
const starterLook = (): Look => ({ color: DIG.wardrobe.colors[0].id, face: DIG.wardrobe.faces[0].id, hat: '' });

const fresh = (): SaveData => ({
    version: SAVE_VERSION,
    money: 0, toolLevel: 0, backpackLevel: 0, bladesLevel: 0, padPaid: {}, animals: 0, rebirths: 0, medals: 0, medalsEver: 0, perks: {}, xp: 0, tractorOwned: [], tractorLook: { ...NO_TRACTOR_LOOK },
    backpack: {}, found: {}, seen: [], collectionDone: false, deepestZone: 0,
    owned: { colors: [], faces: [], hats: [] }, look: starterLook(), wardrobeBudget: 0, wardrobeVisited: false, freeLooksOffered: false, freeSells: 0, dug: '', built: [],
    stats: { blocks: 0, ores: 0, earned: 0, sells: 0, finds: 0 }, achievements: {}, revealedAt: {}, sent: [],
    boosts: {}, prestige: 0, currentMine: 0, mines: [], crownEarned: false, unclaimed: {}, playSeconds: 0,
});

const freshMine = (): MineSnapshot => ({ dug: '', found: {}, seen: [], collectionDone: false, unclaimed: {} });

/**
 * The saved game, or a new one when there's none, it's broken, or it was written by another SAVE_VERSION (the
 * economy and layout changed too much for an old save to carry over: it's dropped, not migrated).
 */
function load(): SaveData {
    try {
        const raw = SaveStorage.getItem(SAVE_KEY);
        if (raw) {
            const saved = JSON.parse(raw) as Partial<SaveData>;
            if (saved.version !== SAVE_VERSION) {
                console.info(`[DigProgress] save version ${saved.version ?? 1} is not ${SAVE_VERSION}: starting a new game`);
                return fresh();
            }
            // Fields added within this version fill in from fresh().
            return { ...fresh(), ...saved, boosts: { ...saved.boosts }, unclaimed: { ...saved.unclaimed }, stats: { ...fresh().stats, ...saved.stats }, tractorLook: { ...NO_TRACTOR_LOOK, ...saved.tractorLook }, revealedAt: { ...saved.revealedAt }, look: { ...starterLook(), ...saved.look }, owned: { ...fresh().owned, ...saved.owned } };
        }
    } catch {
        // A broken save starts fresh.
    }
    return fresh();
}

const state = load();
let saveTimer: number | undefined;
let lastSave = 0;
/** Set once the data is wiped: nothing may be saved again before the page reloads. */
let wiped = false;
/** The save's been read from the platform (begin()): till then nothing's written, or a new game would go over it. */
let ready = false;
let dugProvider: (() => string) | undefined;

export const DigProgress = {
    /** Every key the save's in (SaveStorage.load() at boot). */
    saveKeys: [SAVE_KEY],

    /** Reads the save again, now that the platform's storage is in (boot, before anything's built); saved as the game's left. */
    begin(): void {
        Object.assign(state, load());
        ready = true;
        // (Rewards that waited to be claimed, in an older save: paid.)
        for (const mine of [state, ...state.mines.filter((one) => one)]) {
            state.money += Object.values(mine.unclaimed ?? {}).reduce((sum, amount) => sum + amount, 0);
            mine.unclaimed = {};
        }
        SaveStorage.saveOnLeave(() => this.saveNow());
    },

    /** Fires after any change to money, tools, backpack levels or contents. */
    onChange: new Signal(),

    get money(): number {
        return state.money;
    },
    get tool(): ToolDef {
        return toolAt(state.toolLevel);
    },
    get toolLevel(): number {
        return state.toolLevel;
    },
    get nextTool(): ToolDef {
        return toolAt(state.toolLevel + 1);
    },
    get backpackLevel(): number {
        return state.backpackLevel;
    },
    get capacity(): number {
        return this.capacityAt(state.toolLevel, state.backpackLevel);
    },
    /** The bag with a tool and a Bigger Bag level (the Bag Size boost counted). */
    capacityAt(toolLevel: number, bagLevel: number): number {
        return Math.round(toolAt(toolLevel).capacity * (1 + DIG.upgrades.capacity.perLevel * bagLevel) * (1 + this.boostEffect(boostDef('bagSize'))) * this.perkFactor('bag'));
    },
    /** What the next Bigger Bag level adds to the bag. */
    get capacityStep(): number {
        return this.capacityAt(state.toolLevel, state.backpackLevel + 1) - this.capacity;
    },
    /** The blades' level (under the tractor), and the digging power: the tool's own plus the blades'. */
    get bladesLevel(): number {
        return state.bladesLevel;
    },
    get power(): number {
        return this.tool.power + (this.tool.vehicle ? state.bladesLevel : 0);
    },
    /** World units across the tractor digs (the boost counted). */
    get width(): number {
        return this.tool.width * (1 + this.boostEffect(boostDef('width')));
    },
    /** What a swing's speed is worth to the tractor's blades: the boost and the perk. */
    get digRate(): number {
        return (this.tool.rate ?? 1) / (1 - this.boostEffect(boostDef('digSpeed'))) * this.perkFactor('dig');
    },
    get backpackCount(): number {
        return Object.values(state.backpack).reduce((sum, count) => sum + count, 0);
    },
    get backpack(): Readonly<Record<string, number>> {
        return state.backpack;
    },
    get found(): Readonly<Record<string, number>> {
        return state.found;
    },
    get deepestZone(): number {
        return state.deepestZone;
    },
    get look(): Readonly<Look> {
        return state.look;
    },
    get collectionDone(): boolean {
        return state.collectionDone;
    },
    /** Kinds of find collected. */
    get collectedCount(): number {
        return DIG.finds.filter((find) => state.found[find.id]).length;
    },
    /** Finds collected but not yet looked at in the collection. */
    get unseenFinds(): string[] {
        return DIG.finds.filter((find) => state.found[find.id] && !state.seen.includes(find.id)).map((find) => find.id);
    },
    /** A boost level is affordable (the BOOSTS tab and the ATM show "!"), once boosts are unlocked. */
    get canAffordBoost(): boolean {
        return this.boostsUnlocked && DIG.boosts.some((boost) => state.money >= (this.boostPrice(boost) ?? Infinity));
    },

    /** True when the next tool or backpack is affordable (the ATM shows "!"). */
    get canAffordUpgrade(): boolean {
        return PAD_KINDS.some((kind) => this.padThere(kind) && this.padLeft(kind) <= state.money);
    },

    // ---------------------------------------------------------------- the pads

    /** A pad is there: from its tool level, or player level, on. */
    padThere(kind: PadKind): boolean {
        const pad = HUB.pads.find((entry) => entry.kind === kind);
        return !!pad && state.toolLevel >= (pad.afterTool ?? 0) && this.level >= (pad.level ?? 0);
    },

    /** What a pad's next upgrade costs (undefined at the top). */
    padCost(kind: PadKind): number | undefined {
        if (kind === 'tool') return this.nextTool.price;
        if (kind === 'blades') {
            const { prices, growth: more } = DIG.upgrades.blades;
            const past = state.bladesLevel - (prices.length - 1);
            return past <= 0 ? prices[state.bladesLevel] : tidyPrice(prices[prices.length - 1] * Math.pow(more, past));
        }
        if (kind === 'animals') return tidyPrice(DIG.animals.price * Math.pow(DIG.animals.growth, state.animals));
        if (kind === 'portal') {
            // (Open already, from a dungeon that isn't the last reached.)
            if (state.currentMine < state.prestige) return undefined;
            const { price, growth: more } = DIG.dungeons.portal;
            return tidyPrice(price * Math.pow(more, state.prestige) * this.perkFactor('portal'));
        }
        const { maxLevel, basePrice, growth } = DIG.upgrades.capacity;
        if (state.backpackLevel >= maxLevel) return undefined;
        return tidyPrice(basePrice * Math.pow(growth, state.backpackLevel));
    },

    /** Money already in a pad toward its next upgrade; what's still needed (Infinity at the top). */
    padPaid(kind: PadKind): number {
        return state.padPaid[kind] ?? 0;
    },
    padLeft(kind: PadKind): number {
        const cost = this.padCost(kind);
        return cost === undefined ? Infinity : cost - this.padPaid(kind);
    },

    /** The bag's worth as sold now; everything that can be poured into a pad: the bag and the money. */
    get bagValue(): number {
        return Math.floor(Object.entries(state.backpack).reduce((sum, [id, count]) => sum + this.itemValue(id) * count, 0) * this.sellMultiplier);
    },
    get pourable(): number {
        return this.bagValue + state.money;
    },

    /**
     * Pours up to `amount` (money) into a pad: the bag first, item by item at its value (change goes to the money), then the
     * money. How much went in, and whether that paid the upgrade in full (it's applied then).
     */
    deposit(kind: PadKind, amount: number): { used: number; upgraded: boolean } {
        const cost = this.padCost(kind);
        if (cost === undefined) return { used: 0, upgraded: false };
        const wanted = Math.max(0, Math.min(Math.ceil(amount), cost - this.padPaid(kind)));
        this.cashItems(wanted);
        const used = Math.min(wanted, Math.floor(state.money));
        state.money -= used;
        state.padPaid[kind] = this.padPaid(kind) + used;
        const upgraded = state.padPaid[kind]! >= cost;
        if (upgraded) this.applyPad(kind);
        if (used > 0 || upgraded) this.changed();
        return { used, upgraded };
    },

    /** Items out of the bag worth `amount` at least (cheapest first), turned to money. */
    cashItems(amount: number): void {
        let worth = 0;
        const held = Object.keys(state.backpack).filter((id) => state.backpack[id] > 0).sort((a, b) => this.itemValue(a) - this.itemValue(b));
        for (const id of held) {
            if (worth >= amount) break;
            const each = this.itemValue(id) * this.sellMultiplier;
            const count = Math.min(state.backpack[id], each > 0 ? Math.ceil((amount - worth) / each) : state.backpack[id]);
            worth += each * count;
            state.backpack[id] -= count;
            if (state.backpack[id] <= 0) delete state.backpack[id];
        }
        const earned = Math.round(worth);
        state.money += earned;
        state.stats.earned += earned;
    },

    applyPad(kind: PadKind): void {
        state.padPaid[kind] = 0;
        if (kind === 'tool') state.toolLevel++;
        else if (kind === 'blades') state.bladesLevel++;
        else if (kind === 'animals') state.animals++;
        else if (kind === 'portal') this.openDungeon();
        else state.backpackLevel++;
    },

    /** Debug: a pad's next upgrade for nothing. */
    grant(kind: PadKind): boolean {
        if (this.padCost(kind) === undefined) return false;
        this.applyPad(kind);
        this.changed();
        return true;
    },

    /** A visit to a pad that took something counts as a sale. */
    countPadVisit(): void {
        state.stats.sells++;
        this.changed();
    },

    // ---------------------------------------------------------------- the player's level

    /** Called with the new level and what it paid. */
    levelUpListeners: [] as ((level: number, cash: number) => void)[],

    /** The level `xp` reaches (1 from the start), the XP into it and the XP it takes. */
    levelFor(xp: number): { level: number; into: number; need: number } {
        const { next, growth } = DIG.levels;
        let left = xp;
        for (let level = 1; ; level++) {
            const need = level <= next.length ? next[level - 1] : Math.round(next[next.length - 1] * Math.pow(growth, level - next.length));
            if (left < need) return { level, into: left, need };
            left -= need;
        }
    },
    get levelNow(): { level: number; into: number; need: number } {
        return this.levelFor(state.xp);
    },
    get level(): number {
        return this.levelNow.level;
    },

    /** Adds experience; each level reached pays its cash (levels.cash). */
    addXp(amount: number): void {
        if (amount <= 0) return;
        const before = this.level;
        state.xp += amount * (1 + this.boostEffect(boostDef('xpGain'))) * this.perkFactor('xp');
        const after = this.level;
        for (let level = before + 1; level <= after; level++) {
            const cash = tidyPrice(DIG.levels.cash.base * Math.pow(level, DIG.levels.cash.power) * this.valueFactor);
            state.money += cash;
            state.stats.earned += cash;
            this.levelUpListeners.forEach((listener) => listener(level, cash));
        }
        if (after > before) this.changed();
        else this.scheduleSave();
    },

    // ---------------------------------------------------------------- the tractor's skins

    get tractorLook(): Readonly<TractorLook> {
        return state.tractorLook;
    },
    ownsTractor(kind: TractorKind, item: TractorItem): boolean {
        return !item.id || state.tractorOwned.includes(`${kind}:${item.id}`);
    },
    /** Puts a skin on, bought first if it has to be; false when the money isn't there (or a video's needed). */
    wearTractor(kind: TractorKind, item: TractorItem): boolean {
        if (!this.ownsTractor(kind, item)) {
            if (item.video) return false;
            if (!item.free) {
                if (state.money < item.price) return false;
                state.money -= item.price;
            }
            this.ownTractor(kind, item);
        }
        // (A plain colour's seen: no pattern over it.)
        state.tractorLook = { ...state.tractorLook, ...(kind === 'colors' ? { paints: '' } : {}), [kind]: item.id };
        this.changed();
        return true;
    },
    unlockTractor(kind: TractorKind, item: TractorItem): void {
        this.ownTractor(kind, item);
        this.wearTractor(kind, item);
    },
    ownTractor(kind: TractorKind, item: TractorItem): void {
        if (!this.ownsTractor(kind, item)) state.tractorOwned.push(`${kind}:${item.id}`);
    },
    /** A free skin not claimed yet. */
    tractorGift(): Cosmetic | undefined {
        for (const kind of TRACTOR_KINDS) {
            const item = TRACTOR_ITEMS[kind].find((entry) => entry.free && !this.ownsTractor(kind, entry));
            if (item) return { who: 'tractor', kind, item };
        }
        return undefined;
    },
    /** A cosmetic not owned, for a video: the tractor's or the miner's (the other's, if there's none left of those). */
    cosmeticToOffer(who: Cosmetic['who']): Cosmetic | undefined {
        const miner: Cosmetic[] = (Object.keys(DIG.wardrobe) as LookKind[]).flatMap((kind) => DIG.wardrobe[kind]
            .filter((item) => !item.free && !item.unlock && !this.ownsLook(kind, item)).map((item) => ({ who: 'miner' as const, kind, item })));
        const tractor: Cosmetic[] = this.hasTractor ? TRACTOR_KINDS.flatMap((kind) => TRACTOR_ITEMS[kind]
            .filter((item) => !item.free && !this.ownsTractor(kind, item)).map((item) => ({ who: 'tractor' as const, kind, item }))) : [];
        const list = who === 'tractor' ? (tractor.length ? tractor : miner) : miner.length ? miner : tractor;
        return list[Math.floor(Math.random() * list.length)];
    },
    /** It's theirs already. */
    ownsCosmetic(gift: Cosmetic): boolean {
        return gift.who === 'tractor' ? this.ownsTractor(gift.kind, gift.item) : this.ownsLook(gift.kind, gift.item);
    },
    /** A cosmetic for a chest to give, not owned yet: the miner's or (once there's one) the tractor's, one of the cheaper ones; none left: undefined. */
    cosmeticToGive(): Cosmetic | undefined {
        const pick = <T extends Cosmetic>(list: T[]): T | undefined => {
            const cheapest = list.sort((a, b) => a.item.price - b.item.price).slice(0, GIFT_FROM);
            return cheapest[Math.floor(Math.random() * cheapest.length)];
        };
        // (Not what's a gift already, earned, or a video's.)
        const miner = pick((Object.keys(DIG.wardrobe) as LookKind[]).flatMap((kind) => DIG.wardrobe[kind]
            .filter((item) => item.price > 0 && !item.free && !item.unlock && !this.ownsLook(kind, item)).map((item) => ({ who: 'miner' as const, kind, item }))));
        const tractor = this.hasTractor ? pick(TRACTOR_KINDS.flatMap((kind) => TRACTOR_ITEMS[kind]
            .filter((item) => !item.free && !item.video && !this.ownsTractor(kind, item)).map((item) => ({ who: 'tractor' as const, kind, item })))) : undefined;
        return Math.random() < 0.5 ? tractor ?? miner : miner ?? tractor;
    },

    /** Gives a chest's cosmetic, and puts it on if `wear`. */
    giveCosmetic(gift: Cosmetic, wear: boolean): void {
        if (gift.who === 'tractor') {
            this.ownTractor(gift.kind, gift.item);
            if (wear) this.wearTractor(gift.kind, gift.item);
        } else {
            if (!this.ownsLook(gift.kind, gift.item)) state.owned[gift.kind].push(gift.item.id);
            if (wear) this.wearLook(gift.kind, gift.item);
        }
        this.changed();
    },

    /** Something for it became affordable since its panel was last opened (or it never was). */
    get tractorHasNews(): boolean {
        const budget = state.tractorBudget;
        if (budget === undefined) return true;
        return TRACTOR_KINDS.some((kind) => TRACTOR_ITEMS[kind].some((item) => !this.ownsTractor(kind, item)
            && (item.free || (!item.video && item.price <= state.money && item.price > budget))));
    },
    markTractorSeen(): void {
        state.tractorBudget = state.money;
        this.scheduleSave();
    },

    /** Debug: experience enough for the next level. */
    levelUp(): void {
        const { into, need } = this.levelNow;
        this.addXp(need - into);
    },
    /** The current tool is a vehicle (the Digger or the Tractor): ridden outside the hub. */
    get hasTractor(): boolean {
        return this.tool.vehicle === true;
    },
    get savedDug(): string {
        return state.dug;
    },

    /** Where the terrain's dug cells come from when saving. */
    setDugProvider(provider: () => string): void {
        dugProvider = provider;
    },

    /** Adds up to `count` items; returns how many fitted. */
    addItems(materialId: string, count: number): number {
        const fits = Math.max(0, Math.min(count, this.capacity - this.backpackCount));
        if (fits > 0) {
            state.backpack[materialId] = (state.backpack[materialId] ?? 0) + fits;
            this.changed();
        }
        return fits;
    },

    /**
     * Sells everything in the backpack, each item's value x `multiplier` (the phone's x2) x sellMultiplier (boost,
     * new mines); returns the money earned.
     */
    sellAll(multiplier = 1): number {
        let earned = 0;
        for (const [id, count] of Object.entries(state.backpack)) earned += this.itemValue(id) * count;
        earned = Math.round(earned * multiplier * this.sellMultiplier);
        state.backpack = {};
        state.money += earned;
        if (earned > 0) state.stats.sells++;
        state.stats.earned += earned;
        this.changed();
        return earned;
    },

    /**
     * What a find pays, dug up in zone `zone` (ui/dig.json findPayout): rarer and deeper pays more. The very first
     * find pays at least the cheapest next upgrade, so it always buys one.
     */
    findPayout(find: FindDef, zone: number): number {
        const rules = DIG.findPayout;
        const raw = rules.rarity[find.rarity] * (1 + rules.perZone * zone) * this.valueFactor;
        let amount = Math.max(rules.roundTo, Math.round(raw / rules.roundTo) * rules.roundTo);
        if (this.collectedCount === 0) {
            const next = Math.min(...GEAR_PADS.map((kind) => this.padCost(kind) ?? Infinity));
            if (Number.isFinite(next)) amount = Math.max(amount, next);
        }
        return amount;
    },

    /**
     * A find was dug up: it joins the collection, and its `amount` (findPayout) is there to be paid (claimReward, at once: the
     * HUD) — as is the collection reward when it was the last one missing.
     */
    addFind(find: FindDef, amount: number): FindResult {
        const first = !state.found[find.id];
        state.stats.finds++;
        state.found[find.id] = (state.found[find.id] ?? 0) + 1;
        state.unclaimed[find.id] = (state.unclaimed[find.id] ?? 0) + amount;
        const completed = !state.collectionDone && this.collectedCount === DIG.finds.length;
        if (completed) {
            state.collectionDone = true;
            state.unclaimed[COLLECTION_REWARD] = (state.unclaimed[COLLECTION_REWARD] ?? 0) + DIG.collectionReward.money;
        }
        this.changed();
        return { first, completed };
    },

    /** A reward waiting in this mine's Trophy Room (a find id or COLLECTION_REWARD); 0 when there's none. */
    unclaimedFor(id: string): number {
        return state.unclaimed[id] ?? 0;
    },


    /** Pays a waiting reward (a find id or COLLECTION_REWARD); returns what it paid (0 if nothing was waiting). */
    claimReward(id: string): number {
        const amount = state.unclaimed[id] ?? 0;
        if (amount <= 0) return 0;
        delete state.unclaimed[id];
        state.money += amount;
        state.stats.earned += amount;
        this.changed();
        return amount;
    },

    /** The collection was opened: every find so far has been seen. */
    markFindsSeen(): void {
        const unseen = this.unseenFinds;
        if (unseen.length === 0) return;
        state.seen.push(...unseen);
        this.changed();
    },

    /** Something in the wardrobe became affordable (or was unlocked) since it was last opened, or a gift waits there. */
    get wardrobeHasNews(): boolean {
        if (this.boughtFirstHat && (Object.keys(DIG.wardrobe) as LookKind[]).some((kind) => this.unclaimedFreeLook(kind))) return true;
        return (Object.keys(DIG.wardrobe) as LookKind[]).some((kind) => DIG.wardrobe[kind].some((item) => {
            if (this.ownsLook(kind, item) && !item.unlock) return false;
            if (item.unlock) return this.ownsLook(kind, item) && !state.owned[kind].includes(item.id);
            if (item.free) return false;
            return item.price <= state.money && item.price > state.wardrobeBudget;
        }));
    },

    /** The kind's free look, while it's still unclaimed. */
    unclaimedFreeLook(kind: LookKind): WardrobeItem | undefined {
        return DIG.wardrobe[kind].find((item) => item.free && !this.ownsLook(kind, item));
    },

    /**
     * Whether the kind's unclaimed free look shows its FREE badge: only from a wardrobe visit after the one where the
     * first hat was bought — a gift claimed on that first visit never gets one.
     */
    freeLookBadge(kind: LookKind): boolean {
        return state.freeLooksOffered && !!this.unclaimedFreeLook(kind);
    },

    /** Phone sales still free (no video): PHONE_FREE_SELLS down to 0. */
    get freeSellsLeft(): number {
        return Math.max(0, PHONE_FREE_SELLS - state.freeSells);
    },

    /** The phone's very first sale: free, and the hand points at it. */
    get firstPhoneSell(): boolean {
        return state.freeSells === 0;
    },

    /** One free phone sale used up. */
    useFreeSell(): void {
        state.freeSells++;
        this.scheduleSave();
    },

    /** The wardrobe was opened: everything affordable now has been seen. */
    get wardrobeVisited(): boolean {
        return state.wardrobeVisited;
    },

    markWardrobeSeen(): void {
        // Opened (again) with the first hat already bought: this is a return visit, so unclaimed gifts get badged.
        if (this.boughtFirstHat) state.freeLooksOffered = true;
        state.wardrobeVisited = true;
        state.wardrobeBudget = state.money;
        for (const kind of Object.keys(DIG.wardrobe) as LookKind[]) {
            for (const item of DIG.wardrobe[kind]) {
                if (item.unlock && this.ownsLook(kind, item) && !state.owned[kind].includes(item.id)) state.owned[kind].push(item.id);
            }
        }
        this.scheduleSave();
    },

    /** The cheapest hat for sale: the first cosmetic, whose purchase the tutorial forces (DigScene). */
    get starterHat(): WardrobeItem | undefined {
        return DIG.wardrobe.hats.filter((h) => h.price > 0 && !h.unlock).reduce<WardrobeItem | undefined>((best, h) => (!best || h.price < best.price ? h : best), undefined);
    },

    /** A hat has been bought (the tutorial's first cosmetic; the first artifact turns up after it). */
    get boughtFirstHat(): boolean {
        return DIG.wardrobe.hats.some((h) => h.price > 0 && state.owned.hats.includes(h.id));
    },

    /** Starter looks are free; the collection-reward hat comes with completing the collection. */
    ownsLook(kind: LookKind, item: WardrobeItem): boolean {
        if (item.unlock === 'achievement') return state.crownEarned;
        return item.price === 0 || state.owned[kind].includes(item.id);
    },

    /** Buys (if needed) and wears a look; false when it costs more than the money there is, or is still locked. */
    wearLook(kind: LookKind, item: WardrobeItem): boolean {
        if (!this.ownsLook(kind, item)) {
            if (item.unlock) return false;
            if (!item.free) {
                if (state.money < item.price) return false;
                state.money -= item.price;
            }
            state.owned[kind].push(item.id);
        }
        if (kind === 'colors') state.look.color = item.id;
        else if (kind === 'faces') state.look.face = item.id;
        else state.look.hat = item.id;
        this.changed();
        return true;
    },

    /** Upgrades bought on the pads this run, together. */
    get upgradesBought(): number {
        return state.toolLevel + state.backpackLevel + state.bladesLevel + state.animals;
    },

    // ---------------------------------------------------------------- boosts and new mines

    /** New mines opened so far (0 = still the first). */
    get prestige(): number {
        return state.prestige;
    },

    /** POWER-UPS is there (the HUD's button): from a player level on. */
    get boostsUnlocked(): boolean {
        return this.level >= DIG.levels.powerUps;
    },

    boostLevel(id: BoostId): number {
        return state.boosts[id] ?? 0;
    },

    /** The next level's price, or undefined at the top. */
    boostPrice(boost: BoostDef): number | undefined {
        const level = this.boostLevel(boost.id);
        if (level >= boost.maxLevel) return undefined;
        return tidyPrice(boost.basePrice * Math.pow(boost.growth, level));
    },

    buyBoost(boost: BoostDef): boolean {
        const price = this.boostPrice(boost);
        if (price === undefined || state.money < price) return false;
        state.money -= price;
        state.boosts[boost.id] = this.boostLevel(boost.id) + 1;
        this.changed();
        return true;
    },

    /** A boost's effect at `level` (default: its current one), as the fraction the HUD shows (0.18 = +18%). */
    boostEffect(boost: BoostDef, level?: number): number {
        const at = level ?? this.boostLevel(boost.id);
        if (boost.id === 'digSpeed') return 1 - Math.pow(1 - boost.perLevel, at);
        const doubled = (boost.milestones ?? []).filter((milestone) => at >= milestone).length;
        return (1 + boost.perLevel * at) * Math.pow(2, doubled) - 1;
    },

    /** The hub's bonus to a stat (HubData.hubBonus): its pieces' perks and finished sets, shared by every mine. */
    hubBonus(stat: HubStat): number {
        return hubBonus(stat, (id) => state.built.includes(id));
    },

    /** Multiplier on everything sold: the Sell Price boost and the perk. */
    get sellMultiplier(): number {
        return (1 + this.boostEffect(boostDef('sellPrice'))) * this.perkFactor('cash');
    },

    /** Seconds between hits with the current tool: the Dig Speed boost and the perk make it shorter. */
    get hitInterval(): number {
        return this.tool.hitInterval * (1 - this.boostEffect(boostDef('digSpeed'))) / this.perkFactor('dig');
    },

    /** Chance an ore block drops one more item (the Ore Luck boost). */
    get oreLuck(): number {
        return this.boostEffect(boostDef('oreLuck')) + this.perkSum('luck');
    },

    /** Multiplier on walking (and riding) speed: the Move Speed boost and the hub. */
    get moveMultiplier(): number {
        return (1 + this.boostEffect(boostDef('moveSpeed'))) * (1 + this.perkSum('speed'));
    },

    /** Blocks around the miner where buried treasure shows its beam: chests.beaconRange, plus the hub's. */
    get beaconRange(): number {
        return DIG.chests.beaconRange + this.hubBonus('beam');
    },

    /** The current mine's terrain seed: every mine has its own layout. */
    get mineSeed(): number {
        return DIG.terrain.seed + DIG.prestige.seedStep * (state.currentMine + state.rebirths * 101);
    },

    /** The current mine's colours: the first theme for the first mine, then the others in turn. */
    get mineTheme(): MineTheme {
        return this.themeFor(state.currentMine);
    },

    /** Mine `index`'s colours (and name). */
    themeFor(index: number): MineTheme {
        const themes = DIG.mineThemes;
        if (index === 0 || themes.length < 2) return themes[0] ?? { name: '' };
        return themes[1 + ((index - 1) % (themes.length - 1))];
    },

    /** The mine being played (0 = the first). */
    get currentMine(): number {
        return state.currentMine;
    },

    /** Mines there are (the first plus every one opened). */
    get mineCount(): number {
        return state.prestige + 1;
    },

    /** A mine's run as it stands (the current one live; its `dug` is only written when leaving it: snapshot()). */
    mine(index: number): MineSnapshot {
        if (index === state.currentMine) return this.liveRun(state.dug);
        return state.mines[index] ?? freshMine();
    },

    /** The current mine's run, as saved for later: its tunnels read from the terrain (not cheap: on leaving only). */
    snapshot(): MineSnapshot {
        return this.liveRun(dugProvider ? dugProvider() : state.dug);
    },

    liveRun(dug: string): MineSnapshot {
        return {
            dug,
            found: { ...state.found }, seen: [...state.seen], collectionDone: state.collectionDone,
            unclaimed: { ...state.unclaimed },
        };
    },

    /** Leaves the current mine for mine `index` (what's its own goes back into the live fields); the scene then rebuilds. */
    switchMine(index: number): void {
        // (The bag's sold at what it's worth here.)
        if (this.backpackCount > 0) this.sellAll();
        state.mines[state.currentMine] = this.snapshot();
        state.currentMine = index;
        const mine = state.mines[index] ?? freshMine();
        state.dug = mine.dug;
        state.found = { ...mine.found };
        state.seen = [...(mine.seen ?? [])];
        state.collectionDone = mine.collectionDone ?? false;
        state.unclaimed = { ...mine.unclaimed };
        // The old mine's tunnels must not be written over the new one before the scene is rebuilt.
        dugProvider = undefined;
        this.changed();
        this.saveNow();
    },

    /** Travels to another mine already opened (its run as it was left); false for the current one or one not open. */
    travelTo(index: number): boolean {
        if (index === state.currentMine || index < 0 || index > state.prestige) return false;
        this.switchMine(index);
        return true;
    },

    /** The portal's paid: the next dungeon's open (the way there, through it: travelTo). */
    openDungeon(): void {
        state.prestige++;
        state.mines[state.prestige] = freshMine();
    },

    // ---------------------------------------------------------------- dungeons, animals, rebirth

    /** How many times the first dungeon's everything's worth here. */
    get valueFactor(): number {
        return Math.pow(DIG.dungeons.value, state.currentMine);
    },
    /** What an item sells for here (before the bonuses). */
    itemValue(id: string): number {
        return (materials.get(id)?.value ?? 0) * this.valueFactor;
    },
    /** The digging power a rock takes here. */
    rockPower(material: MaterialDef): number {
        return material.minPower + DIG.dungeons.power * state.currentMine;
    },
    /** How much more XP blocks give here. */
    get xpFactor(): number {
        return Math.pow(DIG.dungeons.xp, state.currentMine);
    },

    /** Animals called so far. */
    get animals(): number {
        return state.animals;
    },
    /** Seconds of a tractor's chewing all of them do in one hit each, shared among those shown. */
    get animalBite(): number {
        const { bite, biteGrowth, kinds, shown } = DIG.animals;
        let total = 0;
        for (let n = 0; n < state.animals; n++) total += bite * Math.pow(biteGrowth, kinds.indexOf(animalKind(n)));
        return (total / Math.max(1, Math.min(shown, state.animals))) * (1 + this.boostEffect(boostDef('animalPower'))) * this.perkFactor('animals');
    },

    /** The first minutes' teaching is over: an animal's been called (or it's been through it all before). */
    get tutorialOver(): boolean {
        return state.animals > 0 || state.rebirths > 0;
    },

    perkLevel(id: PerkId): number {
        return state.perks[id] ?? 0;
    },
    /** A perk's effect, compounding (x) or added up. */
    perkFactor(id: PerkId): number {
        return Math.pow(perkDef(id).per, this.perkLevel(id));
    },
    perkSum(id: PerkId): number {
        return perkDef(id).per * this.perkLevel(id);
    },
    /** A perk's next level's price in medals (undefined at the top). */
    perkCost(perk: PerkDef): number | undefined {
        const level = this.perkLevel(perk.id);
        return level >= perk.max ? undefined : Math.round(perk.cost * Math.pow(perk.growth, level));
    },
    buyPerk(perk: PerkDef): boolean {
        const cost = this.perkCost(perk);
        if (cost === undefined || state.medals < cost) return false;
        state.medals -= cost;
        state.perks[perk.id] = this.perkLevel(perk.id) + 1;
        this.changed();
        return true;
    },
    get canAffordPerk(): boolean {
        return DIG.rebirth.perks.some((perk) => state.medals >= (this.perkCost(perk) ?? Infinity));
    },

    get medals(): number {
        return state.medals;
    },
    get medalsEver(): number {
        return state.medalsEver;
    },
    get rebirths(): number {
        return state.rebirths;
    },
    /** What a rebirth would pay now. */
    get runMedals(): number {
        const { from, div, power } = DIG.rebirth;
        return Math.max(0, Math.floor(Math.pow(Math.max(0, state.deepestZone - from) / div, power)));
    },
    /** Rebirth's there: a second dungeon's been opened this run, and it pays. */
    get canRebirth(): boolean {
        return state.prestige > 0 && this.runMedals > 0;
    },

    /** Back to the first dungeon with nothing but what's kept (the level, the looks, the medals and their perks). */
    rebirth(): number {
        if (!this.canRebirth) return 0;
        const paid = this.runMedals;
        state.medals += paid;
        state.medalsEver += paid;
        state.rebirths++;
        state.money = 0;
        state.toolLevel = this.perkLevel('tools');
        state.bladesLevel = this.perkLevel('blades');
        state.animals = this.perkLevel('crew');
        state.backpackLevel = 0;
        state.backpack = {};
        state.boosts = {};
        state.padPaid = {};
        state.prestige = 0;
        state.currentMine = 0;
        state.mines = [];
        state.deepestZone = 0;
        state.dug = '';
        state.found = {};
        state.seen = [];
        state.collectionDone = false;
        state.unclaimed = {};
        // (Each run's own layouts; the old tunnels mustn't be written over them before the scene's rebuilt.)
        dugProvider = undefined;
        this.changed();
        this.saveNow();
        return paid;
    },

    get timesSold(): number {
        return state.stats.sells;
    },
    /** Upgrades bought when an area appeared (undefined: not yet). */
    areaRevealedAt(id: string): number | undefined {
        return state.revealedAt[id];
    },
    /** Notes when an area first appeared (saved quietly: no change signal, the hub is what's calling). */
    markAreaRevealed(id: string): void {
        if (state.revealedAt[id] !== undefined) return;
        state.revealedAt[id] = this.upgradesBought;
        this.scheduleSave();
    },

    /** True the first time `key` is passed, ever (saved): one-time analytics events (GameAnalytics). */
    once(key: string): boolean {
        if (state.sent.includes(key)) return false;
        state.sent.push(key);
        this.scheduleSave();
        return true;
    },

    /** Whether once(`key`) was ever passed (without passing it). */
    hasOnce(key: string): boolean {
        return state.sent.includes(key);
    },

    /** Debug: forgets a once(`key`) flag so it can pass again. */
    clearOnce(key: string): void {
        const index = state.sent.indexOf(key);
        if (index < 0) return;
        state.sent.splice(index, 1);
        this.scheduleSave();
    },

    /** A block was dug (the Digger / Ore Hunter achievements count them). */
    recordBlock(ore: boolean): void {
        state.stats.blocks++;
        if (ore) state.stats.ores++;
    },

    achievementStat(stat: AchievementStat): number {
        if (stat === 'finds') return this.totalFinds;
        // Levels claimed in every other achievement (the Champion counts them).
        if (stat === 'claims') return DIG.achievements.filter((a) => a.stat !== 'claims').reduce((sum, a) => sum + this.achievementLevel(a.id), 0);
        return state.stats[stat];
    },

    /** Finds dug up, ever. */
    get totalFinds(): number {
        return state.stats.finds;
    },

    /** Tiers claimed so far (= the tier being worked on; tiers.length when complete). */
    achievementLevel(id: string): number {
        return state.achievements[id] ?? 0;
    },

    canClaim(id: string): boolean {
        const achievement = DIG.achievements.find((a) => a.id === id);
        const level = this.achievementLevel(id);
        return !!achievement && level < achievement.tiers.length && this.achievementStat(achievement.stat) >= achievement.tiers[level].goal;
    },

    /** The last tier was claimed: its decoration stands in the hub. */
    hasAchievementDecor(id: string): boolean {
        const achievement = DIG.achievements.find((a) => a.id === id);
        return !!achievement?.decor && this.achievementLevel(id) >= decorTier(achievement);
    },

    /**
     * Pays the current tier and moves on; `decor` when that tier unlocks the hub decoration, `hat` the wardrobe hat
     * the last tier unlocks (the Crown). Undefined when not ready.
     */
    claimAchievement(id: string): { reward: number; decor: boolean; hat?: string } | undefined {
        if (!this.canClaim(id)) return undefined;
        const achievement = DIG.achievements.find((a) => a.id === id)!;
        const level = this.achievementLevel(id);
        const reward = achievement.tiers[level].reward;
        state.money += reward;
        state.achievements[id] = level + 1;
        const last = level + 1 >= achievement.tiers.length;
        if (last && achievement.hat) state.crownEarned = true;
        this.changed();
        return { reward, decor: !!achievement.decor && level + 1 === decorTier(achievement), hat: last ? achievement.hat : undefined };
    },

    isBuilt(id: string): boolean {
        return state.built.includes(id);
    },

    /** Pays for a hub buildable; false when it's already built or costs more than the money there is. */
    build(id: string, price: number): boolean {
        if (state.built.includes(id) || state.money < price) return false;
        state.money -= price;
        state.built.push(id);
        this.changed();
        return true;
    },

    /** Records reaching a zone here; returns true when it's deeper than any this run. */
    reachZone(zone: number): boolean {
        const step = state.currentMine * DIG.rebirth.zones + zone;
        if (step <= state.deepestZone) return false;
        state.deepestZone = step;
        this.changed();
        return true;
    },

    addMoney(amount: number): void {
        state.money += amount;
        this.changed();
    },

    /** Cash the miner earned outside a sale (a cash chest, a power surge's drops): counts for the Tycoon achievement too. */
    addEarned(amount: number): void {
        state.money += amount;
        state.stats.earned += amount;
        this.changed();
    },

    /** What a cash chest dug up in zone `zone` pays (ui/dig.json chests.cash): its zone's reward, give or take, x the sell bonus. */
    chestPayout(zone: number): number {
        const cash = DIG.chests.cash;
        const base = cash.reward[Math.min(zone, cash.reward.length - 1)] ?? 0;
        const roll = 1 + (Math.random() * 2 - 1) * cash.spread;
        return Math.max(5, Math.round((base * roll * this.valueFactor * this.sellMultiplier) / 5) * 5);
    },

    /** Seconds of active play, all sessions together. */
    get playSeconds(): number {
        return state.playSeconds;
    },

    /** Adds active play time (every frame: saved along with the next change, not on its own). */
    addPlayTime(delta: number): void {
        state.playSeconds += delta;
    },

    /** Marks the terrain changed (a block dug) so it's included in the next save. */
    terrainChanged(): void {
        this.scheduleSave();
    },

    changed(): void {
        this.onChange.dispatch();
        this.scheduleSave();
    },

    scheduleSave(): void {
        window.clearTimeout(saveTimer);
        if (performance.now() - lastSave > SAVE_AT_MOST_MS) {
            this.saveNow();
            return;
        }
        saveTimer = window.setTimeout(() => this.saveNow(), SAVE_DELAY_MS);
    },

    saveNow(): void {
        if (wiped || !ready) return;
        lastSave = performance.now();
        if (dugProvider) {
            state.dug = dugProvider();
        }
        try {
            SaveStorage.setItem(SAVE_KEY, JSON.stringify(state));
        } catch {
            // Storage full or blocked: keep playing unsaved.
        }
    },

    /** Debug: wipes the save and reloads. */
    reset(): void {
        window.clearTimeout(saveTimer);
        wiped = true;
        SaveStorage.removeItem(SAVE_KEY);
        window.location.reload();
    },

    /**
     * Debug: wipes everything this origin keeps in the browser — the save, the debug overlay's saved tweaks and
     * layout (localStorage + cookies), session storage — and reloads into a brand-new game.
     */
    wipeAllData(): void {
        window.clearTimeout(saveTimer);
        wiped = true;
        try {
            window.localStorage.clear();
            window.sessionStorage.clear();
        } catch {
            // Storage blocked: nothing to clear.
        }
        for (const cookie of document.cookie.split(';')) {
            const name = cookie.split('=')[0].trim();
            if (name) document.cookie = `${name}=; path=/; max-age=0`;
        }
        window.location.reload();
    },
};
