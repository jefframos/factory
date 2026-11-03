// MowProgress.ts
//
// The player's saved state: money, the tool owned, upgrade levels, the clippings in the container, which grass has
// been cut (from the grass field, as a compact string), which districts are restored, and the wardrobe (owned and worn
// looks). Two localStorage entries, saved shortly after any change: the city's own (`mow.save.<city>`: its gear,
// money, grass, areas, trophies and secrets — each city is played from scratch, prestige-style) and the player's
// (`mow.global`: the wardrobe, the cities finished — their bonus — and the one-time analytics). Versioned
// (SAVE_VERSION): a save from another version starts a new game. Fields added later get their defaults (load()).

import { Signal } from 'signals';
import { MOW, CITY, CITIES, CityDef, CURRENT_CITY_KEY, PRESTIGE_BONUS, ToolDef, UpgradeDef, UpgradeId, WardrobeItem } from './MowConfig';

export type LookKind = 'colors' | 'faces' | 'hats';
/** The wardrobe's kinds (its section in ui/mow.json also has a $comment: never walk its keys). */
export const LOOK_KINDS: LookKind[] = ['colors', 'faces', 'hats'];

/** What the player wears. */
export interface Look {
    color: string;
    face: string;
    hat: string;
}

const cityKey = (city: string): string => `mow.save.${city}`;
const SAVE_KEY = cityKey(CITY.id);
const GLOBAL_KEY = 'mow.global';
/** Bump when a change can't carry old saves over: a save from another version starts a new game. */
const SAVE_VERSION = 4;
/** What's the player's, not the city's (kept across cities: the wardrobe, the cities finished, the analytics). */
const GLOBAL_FIELDS = ['owned', 'look', 'freeLooksOffered', 'sent', 'completed'] as const;
const SAVE_DELAY_MS = 800;

interface SaveData {
    version: number;
    money: number;
    toolLevel: number;
    upgrades: Partial<Record<UpgradeId, number>>;
    /** Clippings in the container now. */
    clippings: number;
    /** Cut grass cells (GrassField.save()). */
    cut: string;
    /** Districts restored, by id. */
    restored: string[];
    stats: { cells: number; earned: number; sells: number };
    /** One-time analytics events already sent, by key. */
    sent: string[];
    /** Bought wardrobe items, by kind. */
    owned: Record<LookKind, string[]>;
    look: Look;
    /** Money when the wardrobe was last opened: things that became affordable since get its "!". */
    wardrobeBudget: number;
    /** The wardrobe was opened again after the first hat: an unclaimed gift (free colour / face) now shows its FREE badge. */
    freeLooksOffered: boolean;
    /** Treasures found (ids), and rewards claimed (treasure ids, and `area:<section id>` for an area's bonus). */
    treasuresFound: string[];
    treasuresClaimed: string[];
    /** Secret patches mowed through (ids): their chest found and paid. */
    secretsFound: string[];
    /** Cities finished (ids): each (not the tutorial) adds PRESTIGE_BONUS to sales. */
    completed: string[];
}

/** The claim key of an area's bonus (all its treasures found). */
export const areaBonusKey = (areaId: string): string => `area:${areaId}`;

/** A new player: the first colour and face, no hat. */
const starterLook = (): Look => ({ color: MOW.wardrobe.colors[0].id, face: MOW.wardrobe.faces[0].id, hat: '' });

const fresh = (): SaveData => ({
    version: SAVE_VERSION, money: 0, toolLevel: 0, upgrades: {}, clippings: 0, cut: '',
    stats: { cells: 0, earned: 0, sells: 0 }, sent: [],
    owned: { colors: [], faces: [], hats: [] }, look: starterLook(), wardrobeBudget: 0, freeLooksOffered: false,
    treasuresFound: [], treasuresClaimed: [], secretsFound: [], completed: [],
    // The city's areas the tutorial already did (startRestored).
    restored: MOW.districts.filter((district) => district.startRestored).map((district) => district.id),
});

function read(key: string): Partial<SaveData> | undefined {
    try {
        const raw = window.localStorage.getItem(key);
        const saved = raw ? (JSON.parse(raw) as Partial<SaveData>) : undefined;
        return saved?.version === SAVE_VERSION ? saved : undefined;
    } catch {
        // A broken save starts fresh.
        return undefined;
    }
}

function load(): SaveData {
    const city = read(SAVE_KEY) ?? {};
    const global = read(GLOBAL_KEY) ?? {};
    const own = Object.fromEntries(GLOBAL_FIELDS.filter((field) => field in global).map((field) => [field, global[field]]));
    const saved = { ...city, ...own } as Partial<SaveData>;
    return {
        ...fresh(), ...saved, upgrades: { ...saved.upgrades }, stats: { ...fresh().stats, ...saved.stats },
        owned: { ...fresh().owned, ...saved.owned }, look: { ...starterLook(), ...saved.look },
    };
}

const state = load();
let saveTimer: number | undefined;
let wiped = false;
let cutProvider: (() => string) | undefined;

const upgradeDef = (id: UpgradeId): UpgradeDef => MOW.upgrades.find((u) => u.id === id)!;

export const MowProgress = {
    /** Fires after any change to money, tools, upgrades or the container. */
    onChange: new Signal(),

    get money(): number {
        return state.money;
    },
    get toolLevel(): number {
        return state.toolLevel;
    },
    get tool(): ToolDef {
        return MOW.tools[Math.min(state.toolLevel, MOW.tools.length - 1)];
    },
    get nextTool(): ToolDef | undefined {
        return MOW.tools[state.toolLevel + 1];
    },
    get clippings(): number {
        return state.clippings;
    },
    get savedCut(): string {
        return state.cut;
    },

    upgradeLevel(id: UpgradeId): number {
        return state.upgrades[id] ?? 0;
    },

    /** The next level's price, or undefined at the top. */
    upgradePrice(upgrade: UpgradeDef): number | undefined {
        const level = this.upgradeLevel(upgrade.id);
        if (level >= upgrade.maxLevel) return undefined;
        return Math.round(upgrade.basePrice * Math.pow(upgrade.growth, level) / 5) * 5;
    },

    /** Cutting width: the tool's plus the Cutting Width upgrade. */
    get width(): number {
        return this.tool.width + upgradeDef('width').perLevel * this.upgradeLevel('width');
    },
    /** Walking speed: the tool's, times the Speed upgrade. */
    get speed(): number {
        return this.tool.speed * (1 + upgradeDef('speed').perLevel * this.upgradeLevel('speed'));
    },
    get power(): number {
        return this.tool.power;
    },
    /** Share added to every sale (the Money Gain boost). */
    get moneyBonus(): number {
        return upgradeDef('money').perLevel * this.upgradeLevel('money');
    },
    /** How fast tough grass is chewed through (1 = base; the Sharp Blades boost). */
    get chewRate(): number {
        return 1 + upgradeDef('blades').perLevel * this.upgradeLevel('blades');
    },
    /** Whether the shop's BOOSTS tab is open (with the mower that unlocks it). */
    get boostsUnlocked(): boolean {
        return state.toolLevel >= MOW.boostsUnlockToolLevel;
    },
    /** A boost the money covers (the BOOSTS tab's "!"). */
    get canAffordBoost(): boolean {
        return this.boostsUnlocked && MOW.upgrades.some((u) => u.tab === 'boosts' && state.money >= (this.upgradePrice(u) ?? Infinity));
    },
    /** Container size: the tool's plus the Capacity upgrade. */
    get capacity(): number {
        return this.tool.capacity + upgradeDef('capacity').perLevel * this.upgradeLevel('capacity');
    },
    get full(): boolean {
        return state.clippings >= this.capacity;
    },

    /** Something in the shop is affordable now (the shop's "!"). */
    get canAffordSomething(): boolean {
        const tool = this.nextTool;
        if (tool && state.money >= tool.price) return true;
        return MOW.upgrades.some((u) => state.money >= (this.upgradePrice(u) ?? Infinity));
    },

    /** Adds up to `amount` clippings; returns how many fitted. */
    addClippings(amount: number): number {
        const fits = Math.max(0, Math.min(amount, this.capacity - state.clippings));
        if (fits > 0) {
            state.clippings += fits;
            this.changed();
        }
        return fits;
    },

    /** A grass cell was cut (the counter only: its clippings go through addClippings). */
    recordCut(): void {
        state.stats.cells++;
    },

    /** Sells the container; returns the money earned. */
    sell(): number {
        const earned = Math.round(state.clippings * MOW.clippingPrice * (1 + this.moneyBonus) * (1 + this.prestige));
        if (state.clippings <= 0) return 0;
        state.clippings = 0;
        state.money += earned;
        state.stats.earned += earned;
        state.stats.sells++;
        this.changed();
        return earned;
    },

    buyTool(): boolean {
        const next = this.nextTool;
        if (!next || state.money < next.price) return false;
        state.money -= next.price;
        state.toolLevel++;
        this.changed();
        return true;
    },

    buyUpgrade(upgrade: UpgradeDef): boolean {
        const price = this.upgradePrice(upgrade);
        if (price === undefined || state.money < price) return false;
        state.money -= price;
        state.upgrades[upgrade.id] = this.upgradeLevel(upgrade.id) + 1;
        this.changed();
        return true;
    },

    // ---------------------------------------------------------------- wardrobe

    get look(): Readonly<Look> {
        return state.look;
    },

    /** Something in the wardrobe became affordable since it was last opened (its "!"), or a gift waits there after the first hat. */
    get wardrobeHasNews(): boolean {
        if (this.boughtFirstHat && LOOK_KINDS.some((kind) => this.unclaimedFreeLook(kind))) return true;
        return LOOK_KINDS.some((kind) => MOW.wardrobe[kind].some((item) =>
            !item.free && !this.ownsLook(kind, item) && item.price <= state.money && item.price > state.wardrobeBudget));
    },

    /** The kind's free look, while it's still unclaimed. */
    unclaimedFreeLook(kind: LookKind): WardrobeItem | undefined {
        return MOW.wardrobe[kind].find((item) => item.free && !this.ownsLook(kind, item));
    },

    /**
     * Whether the kind's unclaimed free look shows its FREE badge: only from a wardrobe visit after the one where the
     * first hat was bought — a gift claimed on that first visit never gets one.
     */
    freeLookBadge(kind: LookKind): boolean {
        return state.freeLooksOffered && !!this.unclaimedFreeLook(kind);
    },

    /** The wardrobe was opened: everything affordable now has been seen. */
    markWardrobeSeen(): void {
        // Opened (again) with the first hat already bought: a return visit, so unclaimed gifts get badged.
        if (this.boughtFirstHat) state.freeLooksOffered = true;
        state.wardrobeBudget = state.money;
        this.scheduleSave();
    },

    /** The cheapest hat for sale: the first cosmetic, whose purchase the tutorial forces (MowScene). */
    get starterHat(): WardrobeItem | undefined {
        return MOW.wardrobe.hats.filter((h) => h.price > 0).reduce<WardrobeItem | undefined>((best, h) => (!best || h.price < best.price ? h : best), undefined);
    },

    /** A hat has been bought (the tutorial's first cosmetic). */
    get boughtFirstHat(): boolean {
        return MOW.wardrobe.hats.some((h) => h.price > 0 && state.owned.hats.includes(h.id));
    },

    /** Starter looks (price 0) are free. */
    ownsLook(kind: LookKind, item: WardrobeItem): boolean {
        return item.price === 0 || state.owned[kind].includes(item.id);
    },

    /** Buys (if needed) and wears a look; false when it costs more than the money there is. Gifts (`free`) cost nothing. */
    wearLook(kind: LookKind, item: WardrobeItem): boolean {
        if (!this.ownsLook(kind, item)) {
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

    // ---------------------------------------------------------------- treasures

    treasureFound(id: string): boolean {
        return state.treasuresFound.includes(id);
    },

    /** A treasure was found; false if it already had been. */
    findTreasure(id: string): boolean {
        if (state.treasuresFound.includes(id)) return false;
        state.treasuresFound.push(id);
        this.changed();
        return true;
    },

    /** The treasures of an area (a section id), and how many of them are found. */
    areaTreasures(areaId: string): { total: number; found: number } {
        const items = MOW.treasures.items.filter((item) => item.area === areaId);
        return { total: items.length, found: items.filter((item) => state.treasuresFound.includes(item.id)).length };
    },

    /** Cash waiting to be claimed for a key (a treasure id, or areaBonusKey(area)); 0 if nothing (or claimed). */
    unclaimedFor(key: string): number {
        if (state.treasuresClaimed.includes(key)) return 0;
        if (key.startsWith('area:')) {
            const area = key.slice('area:'.length);
            const { total, found } = this.areaTreasures(area);
            return total > 0 && found === total ? MOW.treasures.areaBonus[area] ?? 0 : 0;
        }
        const item = MOW.treasures.items.find((i) => i.id === key);
        return item && state.treasuresFound.includes(key) ? item.reward : 0;
    },

    /** Anything waiting in the Trophies panel (its button's "!"). */
    get hasUnclaimedTreasure(): boolean {
        return MOW.treasures.items.some((i) => this.unclaimedFor(i.id) > 0)
            || MOW.districts.some((d) => this.unclaimedFor(areaBonusKey(d.id)) > 0);
    },

    /** A treasure reward (or an area's bonus) has ever been claimed (the hand stops pointing at the Trophies button). */
    get claimedAnyTreasure(): boolean {
        return state.treasuresClaimed.length > 0;
    },

    /** A secret patch's chest was found (its patch stays mowed). */
    secretFound(id: string): boolean {
        return state.secretsFound.includes(id);
    },

    /** Pays a secret patch's chest (once); returns how much (0 = already found). */
    claimSecret(id: string, reward: number): number {
        if (state.secretsFound.includes(id)) return 0;
        state.secretsFound.push(id);
        state.money += reward;
        state.stats.earned += reward;
        this.changed();
        return reward;
    },

    /** Pays a waiting reward (a treasure id, or an area's bonus); returns how much (0 = nothing waiting). */
    claimTreasure(key: string): number {
        const amount = this.unclaimedFor(key);
        if (amount <= 0) return 0;
        state.treasuresClaimed.push(key);
        state.money += amount;
        state.stats.earned += amount;
        this.changed();
        return amount;
    },

    isRestored(districtId: string): boolean {
        return state.restored.includes(districtId);
    },

    /** A district reached its restoration goal: records it and pays its bonus; false if it already was. */
    restore(districtId: string, bonus: number): boolean {
        if (state.restored.includes(districtId)) return false;
        state.restored.push(districtId);
        state.money += bonus;
        state.stats.earned += bonus;
        this.changed();
        return true;
    },

    get timesSold(): number {
        return state.stats.sells;
    },
    /** All the money ever earned (sales, bonuses, rewards). */
    get earned(): number {
        return state.stats.earned;
    },
    get cellsCut(): number {
        return state.stats.cells;
    },

    addMoney(amount: number): void {
        state.money += amount;
        this.changed();
    },

    // ---------------------------------------------------------------- cities

    /** Cities finished (ids). */
    get completedCities(): readonly string[] {
        return state.completed;
    },

    /** The finished cities' bonus on every sale (PRESTIGE_BONUS each; the tutorial and its like don't count). */
    get prestige(): number {
        return PRESTIGE_BONUS * CITIES.filter((city) => !city.keepGear && state.completed.includes(city.id)).length;
    },

    /**
     * This city's done: marks it and moves to `next` — kept (a city that keeps the gear: the tutorial) or sold off (any
     * other: the next starts from scratch, its bonus the reward). Saves both; the caller reloads the game into it.
     */
    travel(next: CityDef): void {
        if (!state.completed.includes(CITY.id)) state.completed.push(CITY.id);
        this.saveNow();
        try {
            window.localStorage.removeItem(cityKey(next.id));
            if (CITY.keepGear) {
                const carried: Partial<SaveData> = { version: SAVE_VERSION, money: state.money, toolLevel: state.toolLevel, upgrades: state.upgrades };
                window.localStorage.setItem(cityKey(next.id), JSON.stringify(carried));
            }
            window.localStorage.setItem(CURRENT_CITY_KEY, next.id);
        } catch {
            // No storage: the reload starts the first city again.
        }
        window.clearTimeout(saveTimer);
        wiped = true;
    },

    /** True the first time `key` is passed, ever (saved): one-time analytics events. */
    once(key: string): boolean {
        if (state.sent.includes(key)) return false;
        state.sent.push(key);
        this.scheduleSave();
        return true;
    },

    /** Where the cut grass comes from when saving (the grass field). */
    setCutProvider(provider: () => string): void {
        cutProvider = provider;
    },

    /** Grass was cut: included in the next save. */
    grassChanged(): void {
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
        if (cutProvider) state.cut = cutProvider();
        try {
            const city: Partial<SaveData> = { ...state };
            const global: Partial<SaveData> = { version: SAVE_VERSION };
            for (const field of GLOBAL_FIELDS) {
                (global as Record<string, unknown>)[field] = state[field];
                delete (city as Record<string, unknown>)[field];
            }
            window.localStorage.setItem(SAVE_KEY, JSON.stringify(city));
            window.localStorage.setItem(GLOBAL_KEY, JSON.stringify(global));
        } catch {
            // Storage full or blocked: keep playing unsaved.
        }
    },

    /** Debug: wipes the save and reloads. */
    reset(): void {
        window.clearTimeout(saveTimer);
        wiped = true;
        // Every city and the player's own (debug: a brand-new game, from the tutorial).
        for (const city of CITIES) window.localStorage.removeItem(cityKey(city.id));
        window.localStorage.removeItem(GLOBAL_KEY);
        window.localStorage.removeItem(CURRENT_CITY_KEY);
        window.location.reload();
    },
};
