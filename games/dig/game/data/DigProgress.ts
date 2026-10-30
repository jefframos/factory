// DigProgress.ts
//
// The player's saved state (GDD §15 persistence): money, tool and backpack levels, what's in the
// backpack, finds collected (and which the player has looked at in the collection), the deepest zone
// reached, the wardrobe (owned and worn looks), and which terrain cells have been dug. One localStorage entry, saved shortly after any
// change so a burst of digging writes once. Versioned (SAVE_VERSION): a save from another version starts a new game.

import { Signal } from 'signals';
import { AchievementDef, AchievementStat, BoostDef, BoostId, DIG, FindDef, MineTheme, ToolDef, WardrobeItem } from './DigConfig';

export type LookKind = 'colors' | 'faces' | 'hats';

/** What the miner wears. */
export interface Look {
    color: string;
    face: string;
    hat: string;
}

/** What addFind() reports, for the find banner. */
export interface FindResult {
    /** Never found one of these before. */
    first: boolean;
    /** This find completed the collection (its reward was just paid). */
    completed: boolean;
}

/**
 * One mine's own run: its cash, tools, backpacks (and what's in them), boosts, tunnels and its collection (every mine
 * has the same finds to dig up again). The mine being played keeps these in the top-level save fields; the others
 * wait here until the player travels back (travelTo()).
 */
export interface MineSnapshot {
    money: number;
    toolLevel: number;
    backpackLevel: number;
    backpack: Record<string, number>;
    boosts: Partial<Record<BoostId, number>>;
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
const SAVE_VERSION = 3;
const SAVE_DELAY_MS = 800;

interface SaveData {
    /** SAVE_VERSION when it was written. */
    version: number;
    money: number;
    toolLevel: number;
    backpackLevel: number;
    backpack: Record<string, number>;
    /** Finds collected, by id. */
    found: Record<string, number>;
    /** Finds the player has looked at in the collection (the totem shows "!" for the rest). */
    seen: string[];
    collectionDone: boolean;
    deepestZone: number;
    /** Bought wardrobe items, by kind. */
    owned: Record<LookKind, string[]>;
    look: Look;
    /** Money when the wardrobe was last opened: things that became affordable since get its "!". */
    wardrobeBudget: number;
    /** The wardrobe has been opened at least once (until then the guide leads the miner to it). */
    wardrobeVisited: boolean;
    dug: string;
    /** Hub buildables bought so far (levels/hub.json `buildables`), by id. */
    built: string[];
    /** Counters the achievements read (finds come from `found`). */
    stats: { blocks: number; ores: number; earned: number; sells: number };
    /** Total upgrades (tools + backpacks) bought when each hub area appeared — for 'upgradeAfter:<area>' reveals. */
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
}

/** The tier (1-based) that unlocks an achievement's hub decoration. */
const decorTier = (achievement: AchievementDef): number => achievement.decorAt ?? achievement.tiers.length;

/** A boost's definition (ui/dig.json boosts). */
const boostDef = (id: BoostId): BoostDef => DIG.boosts.find((b) => b.id === id)!;

/** A new miner: the first colour and face, and no hat (the first hat is the tutorial's first cosmetic buy). */
const starterLook = (): Look => ({ color: DIG.wardrobe.colors[0].id, face: DIG.wardrobe.faces[0].id, hat: '' });

const fresh = (): SaveData => ({
    version: SAVE_VERSION,
    money: 0, toolLevel: 0, backpackLevel: 0, backpack: {}, found: {}, seen: [], collectionDone: false, deepestZone: 0,
    owned: { colors: [], faces: [], hats: [] }, look: starterLook(), wardrobeBudget: 0, wardrobeVisited: false, dug: '', built: [],
    stats: { blocks: 0, ores: 0, earned: 0, sells: 0 }, achievements: {}, revealedAt: {}, sent: [],
    boosts: {}, prestige: 0, currentMine: 0, mines: [], crownEarned: false, unclaimed: {},
});

const freshMine = (): MineSnapshot => ({ money: 0, toolLevel: 0, backpackLevel: 0, backpack: {}, boosts: {}, dug: '', found: {}, seen: [], collectionDone: false, unclaimed: {} });

/**
 * The saved game, or a new one when there's none, it's broken, or it was written by another SAVE_VERSION (the
 * economy and layout changed too much for an old save to carry over: it's dropped, not migrated).
 */
function load(): SaveData {
    try {
        const raw = window.localStorage.getItem(SAVE_KEY);
        if (raw) {
            const saved = JSON.parse(raw) as Partial<SaveData>;
            if (saved.version !== SAVE_VERSION) {
                console.info(`[DigProgress] save version ${saved.version ?? 1} is not ${SAVE_VERSION}: starting a new game`);
                return fresh();
            }
            // Fields added within this version fill in from fresh().
            return { ...fresh(), ...saved, boosts: { ...saved.boosts }, unclaimed: { ...saved.unclaimed }, stats: { ...fresh().stats, ...saved.stats }, revealedAt: { ...saved.revealedAt }, look: { ...starterLook(), ...saved.look }, owned: { ...fresh().owned, ...saved.owned } };
        }
    } catch {
        // A broken save starts fresh.
    }
    return fresh();
}

const state = load();
let saveTimer: number | undefined;
/** Set once the data is wiped: nothing may be saved again before the page reloads. */
let wiped = false;
let dugProvider: (() => string) | undefined;

export const DigProgress = {
    /** Fires after any change to money, tools, backpack levels or contents. */
    onChange: new Signal(),

    get money(): number {
        return state.money;
    },
    get tool(): ToolDef {
        return DIG.tools[Math.min(state.toolLevel, DIG.tools.length - 1)];
    },
    get toolLevel(): number {
        return state.toolLevel;
    },
    get nextTool(): ToolDef | undefined {
        return DIG.tools[state.toolLevel + 1];
    },
    get backpackLevel(): number {
        return state.backpackLevel;
    },
    get capacity(): number {
        return DIG.backpack[Math.min(state.backpackLevel, DIG.backpack.length - 1)].capacity;
    },
    get nextBackpack(): { capacity: number; price: number } | undefined {
        return DIG.backpack[state.backpackLevel + 1];
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
        const tool = this.nextTool;
        const bag = this.nextBackpack;
        return (!!tool && state.money >= tool.price) || (!!bag && state.money >= bag.price);
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
        for (const [id, count] of Object.entries(state.backpack)) {
            earned += (DIG.materials.find((m) => m.id === id)?.value ?? 0) * count;
        }
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
        const raw = rules.rarity[find.rarity] * (1 + rules.perZone * zone);
        let amount = Math.max(rules.roundTo, Math.round(raw / rules.roundTo) * rules.roundTo);
        if (this.collectedCount === 0) {
            const next = Math.min(this.nextTool?.price ?? Infinity, this.nextBackpack?.price ?? Infinity);
            if (Number.isFinite(next)) amount = Math.max(amount, next);
        }
        return amount;
    },

    /**
     * A find was dug up: it joins the collection, and its `amount` (findPayout) waits in the Trophy Room to be claimed
     * (claimReward) — as does the collection reward when it was the last one missing.
     */
    addFind(find: FindDef, amount: number): FindResult {
        const first = !state.found[find.id];
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

    /** Anything waiting to be claimed in this mine's Trophy Room (the totem's "!"). */
    get hasUnclaimed(): boolean {
        return Object.values(state.unclaimed).some((amount) => amount > 0);
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

    /** Something in the wardrobe became affordable (or was unlocked) since it was last opened. */
    get wardrobeHasNews(): boolean {
        return (Object.keys(DIG.wardrobe) as LookKind[]).some((kind) => DIG.wardrobe[kind].some((item) => {
            if (this.ownsLook(kind, item) && !item.unlock) return false;
            if (item.unlock) return this.ownsLook(kind, item) && !state.owned[kind].includes(item.id);
            return item.price <= state.money && item.price > state.wardrobeBudget;
        }));
    },

    /** The wardrobe was opened: everything affordable now has been seen. */
    get wardrobeVisited(): boolean {
        return state.wardrobeVisited;
    },

    markWardrobeSeen(): void {
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
            if (item.unlock || state.money < item.price) return false;
            state.money -= item.price;
            state.owned[kind].push(item.id);
        }
        if (kind === 'colors') state.look.color = item.id;
        else if (kind === 'faces') state.look.face = item.id;
        else state.look.hat = item.id;
        this.changed();
        return true;
    },

    /** Tool and backpack upgrades bought, together, in every mine (the hub's reveal areas count them). */
    get upgradesBought(): number {
        let total = 0;
        for (let i = 0; i <= state.prestige; i++) {
            const mine = this.mine(i);
            total += mine.toolLevel + mine.backpackLevel;
        }
        return total;
    },

    // ---------------------------------------------------------------- boosts and new mines

    /** New mines opened so far (0 = still the first). */
    get prestige(): number {
        return state.prestige;
    },

    /** The BOOSTS tab is open: enough tool upgrades, or any new mine opened. */
    get boostsUnlocked(): boolean {
        return state.toolLevel >= DIG.boostsUnlockToolLevel || state.prestige > 0;
    },

    boostLevel(id: BoostId): number {
        return state.boosts[id] ?? 0;
    },

    /** The next level's price, or undefined at the top. */
    boostPrice(boost: BoostDef): number | undefined {
        const level = this.boostLevel(boost.id);
        if (level >= boost.maxLevel) return undefined;
        return Math.round(boost.basePrice * Math.pow(boost.growth, level) / 5) * 5;
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
        return boost.id === 'digSpeed' ? 1 - Math.pow(1 - boost.perLevel, at) : boost.perLevel * at;
    },

    /** Multiplier on everything sold: the Sell Price boost and every new mine opened. */
    get sellMultiplier(): number {
        return (1 + this.boostEffect(boostDef('sellPrice'))) * (1 + DIG.prestige.sellBonus * state.prestige);
    },

    /** Seconds between hits with the current tool: the Dig Speed boost and every new mine opened make it shorter. */
    get hitInterval(): number {
        return this.tool.hitInterval * (1 - this.boostEffect(boostDef('digSpeed'))) / (1 + DIG.prestige.digBonus * state.prestige);
    },

    /** Chance an ore block drops one more item (the Ore Luck boost). */
    get oreLuck(): number {
        return this.boostEffect(boostDef('oreLuck'));
    },

    /** Multiplier on walking (and riding) speed: the Move Speed boost. */
    get moveMultiplier(): number {
        return 1 + this.boostEffect(boostDef('moveSpeed'));
    },

    /** The current mine's terrain seed: every mine has its own layout. */
    get mineSeed(): number {
        return DIG.terrain.seed + DIG.prestige.seedStep * state.currentMine;
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

    /** A new mine can be opened: the newest mine has its last tool (the Tractor). */
    get canOpenNewMine(): boolean {
        return this.mine(state.prestige).toolLevel >= DIG.tools.length - 1;
    },

    /** The current mine's run, as saved for later: its tunnels read from the terrain (not cheap: on leaving only). */
    snapshot(): MineSnapshot {
        return this.liveRun(dugProvider ? dugProvider() : state.dug);
    },

    liveRun(dug: string): MineSnapshot {
        return {
            money: state.money, toolLevel: state.toolLevel, backpackLevel: state.backpackLevel,
            backpack: { ...state.backpack }, boosts: { ...state.boosts }, dug,
            found: { ...state.found }, seen: [...state.seen], collectionDone: state.collectionDone,
            unclaimed: { ...state.unclaimed },
        };
    },

    /** Leaves the current mine for mine `index` (its run goes back into the live fields); the scene then rebuilds. */
    switchMine(index: number): void {
        state.mines[state.currentMine] = this.snapshot();
        state.currentMine = index;
        const mine = state.mines[index] ?? freshMine();
        state.money = mine.money;
        state.toolLevel = mine.toolLevel;
        state.backpackLevel = mine.backpackLevel;
        state.backpack = { ...mine.backpack };
        state.boosts = { ...mine.boosts };
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

    /**
     * Opens a new mine (prestige) and goes there: a fresh run (no cash, the shovel, the smallest backpack, no boosts,
     * no tunnels) in a new layout, and every mine's bonus goes up. The mines left behind stay as they are (travelTo());
     * the looks, hub pieces, collection, achievements and stats are shared by all.
     */
    openNewMine(): boolean {
        if (!this.canOpenNewMine) return false;
        state.prestige++;
        state.mines[state.prestige] = freshMine();
        this.switchMine(state.prestige);
        return true;
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

    /** Kinds of find collected, added up over every mine (each mine has its own collection). */
    get totalFinds(): number {
        let total = 0;
        for (let i = 0; i <= state.prestige; i++) {
            const found = i === state.currentMine ? state.found : state.mines[i]?.found ?? {};
            total += DIG.finds.filter((find) => found[find.id]).length;
        }
        return total;
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

    /** Achievements with a tier ready to claim (the HUD button's "!"). */
    get claimableAchievements(): number {
        return DIG.achievements.filter((a) => this.canClaim(a.id)).length;
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

    /** Records reaching a zone; returns true when it's deeper than ever before. */
    reachZone(zone: number): boolean {
        if (zone <= state.deepestZone) return false;
        state.deepestZone = zone;
        this.changed();
        return true;
    },

    buyTool(): boolean {
        const next = this.nextTool;
        if (!next || state.money < next.price) return false;
        state.money -= next.price;
        state.toolLevel++;
        this.changed();
        return true;
    },

    buyBackpack(): boolean {
        const next = this.nextBackpack;
        if (!next || state.money < next.price) return false;
        state.money -= next.price;
        state.backpackLevel++;
        this.changed();
        return true;
    },

    addMoney(amount: number): void {
        state.money += amount;
        this.changed();
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
        saveTimer = window.setTimeout(() => this.saveNow(), SAVE_DELAY_MS);
    },

    saveNow(): void {
        if (wiped) return;
        if (dugProvider) {
            state.dug = dugProvider();
        }
        try {
            window.localStorage.setItem(SAVE_KEY, JSON.stringify(state));
        } catch {
            // Storage full or blocked: keep playing unsaved.
        }
    },

    /** Debug: wipes the save and reloads. */
    reset(): void {
        window.clearTimeout(saveTimer);
        wiped = true;
        window.localStorage.removeItem(SAVE_KEY);
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
