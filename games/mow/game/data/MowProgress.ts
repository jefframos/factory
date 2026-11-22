// MowProgress.ts
//
// The player's saved state: money, the tool owned, upgrade levels, the clippings in the container, which grass has
// been cut (from the grass field, as a compact string), which districts are restored, and the wardrobe (owned and worn
// looks). Two localStorage entries, saved shortly after any change: the city's own (`mow.save.<city>`: its gear,
// money, grass, areas, trophies and secrets — each city is played from scratch, prestige-style) and the player's
// (`mow.global`: the wardrobe, the cities finished — their bonus — and the one-time analytics). Versioned
// (SAVE_VERSION): a save from another version starts a new game. Fields added later get their defaults (load()).

import { Signal } from 'signals';
import { MOW, CITY, CITIES, CityDef, CURRENT_CITY_KEY, PRESTIGE_BONUS, ToolDef, UpgradeDef, UpgradeId, WardrobeItem, setCity, grassFor, farmTest, nicePrice } from './MowConfig';

/** The farm test's upgrade pads (UpgradePads): the next mower, the next bag size, the next blades. */
export type PadKind = 'tool' | 'capacity' | 'blades';

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
const GLOBAL_KEY = 'mow.global';
/** Bump when a change can't carry old saves over: a save from another version starts a new game. */
const SAVE_VERSION = 7;
/** What's the player's, not the city's (kept across cities: the wardrobe, the cities finished, the analytics). */
const GLOBAL_FIELDS = ['owned', 'look', 'freeLooksOffered', 'sent', 'completed', 'carried', 'allCitiesOpen'] as const;
/** The claim key of the rewards left unclaimed in cities travelled from (SaveData.carried). */
export const CARRIED_KEY = 'carried';
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
    /** Trophy rewards left unclaimed in the cities travelled from: still claimable (CARRIED_KEY) in any city. */
    carried: number;
    /** Debug: every playable city can be travelled to (without their bonus: `completed` is untouched). */
    allCitiesOpen: boolean;
    /** Farm test: grass already poured into each upgrade pad toward its next upgrade. */
    padPaid: Partial<Record<PadKind, number>>;
    /** Farm test: dens reached (ids). */
    densFound: string[];
    /** Farm test: the player's experience (their level follows from it: levelFor()). */
    xp: number;
    /**
     * Where the player last stood somewhere stable, once past the tutorial (the first area restored and left): the game
     * starts them there again. None: the level's start.
     */
    lastPosition?: { x: number; z: number };
    /** Money already poured into things bought a bit at a time (a hen, the conveyor, the dock, an area), by key. */
    paid?: Record<string, number>;
    /** Areas bought (DistrictDef.unlock), by id. */
    bought?: string[];
    /** Farm test: den goods in the backpack. */
    goods: { eggs: number; trays: number; goldTrays?: number };
    /** Farm test: the chicken den — hens owned, eggs on each nest's floor, eggs in the machine, trays on its grid, cash on its square. */
    den: { hens: number; floor: number[]; machine: number; trays: number; cash: number; dock?: boolean; truckCash?: number; belt?: boolean; helper?: boolean; truckHelper?: boolean; gold?: boolean; goldBelt?: boolean; goldMachine?: number; goldTrays?: number; tutorial?: boolean };
}

/** The claim key of an area's bonus (all its treasures found). */
export const areaBonusKey = (areaId: string): string => `area:${areaId}`;

/** A new player: the first colour and face, no hat. */
const starterLook = (): Look => ({ color: MOW.wardrobe.colors[0].id, face: MOW.wardrobe.faces[0].id, hat: '' });

const fresh = (): SaveData => ({
    version: SAVE_VERSION, money: 0, toolLevel: 0, upgrades: {}, clippings: 0, cut: '',
    stats: { cells: 0, earned: 0, sells: 0 }, sent: [],
    owned: { colors: [], faces: [], hats: [] }, look: starterLook(), wardrobeBudget: 0, freeLooksOffered: false,
    treasuresFound: [], treasuresClaimed: [], secretsFound: [], completed: [], carried: 0, allCitiesOpen: false,
    padPaid: {}, densFound: [], xp: 0, goods: { eggs: 0, trays: 0 }, den: { hens: 0, floor: [], machine: 0, trays: 0, cash: 0 },
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
    const city = read(cityKey(CITY.id)) ?? {};
    const global = read(GLOBAL_KEY) ?? {};
    const own = Object.fromEntries(GLOBAL_FIELDS.filter((field) => field in global).map((field) => [field, global[field]]));
    const saved = { ...city, ...own } as Partial<SaveData>;
    return {
        ...fresh(), ...saved, upgrades: { ...saved.upgrades }, padPaid: { ...saved.padPaid }, goods: { ...fresh().goods, ...saved.goods },
        den: { ...fresh().den, ...saved.den }, stats: { ...fresh().stats, ...saved.stats },
        owned: { ...fresh().owned, ...saved.owned }, look: { ...starterLook(), ...saved.look },
    };
}

let state = load();
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
        const listed = upgrade.prices?.[level];
        if (listed !== undefined) return nicePrice(listed);
        return nicePrice(upgrade.basePrice * Math.pow(upgrade.growth, level));
    },

    /** Cutting width: the tool's plus the Cutting Width upgrade. */
    get width(): number {
        return this.tool.width + upgradeDef('width').perLevel * this.upgradeLevel('width');
    },
    /** Walking speed: the tool's, times the Speed upgrade. */
    get speed(): number {
        return this.tool.speed * (1 + upgradeDef('speed').perLevel * this.upgradeLevel('speed'));
    },
    /**
     * Cutting power: the mower's own plus the blades' level (README_PROGRESSION.md: the blades are what cut tougher
     * grass; the mower is how wide, fast and big).
     */
    get power(): number {
        return this.tool.power + this.upgradeLevel('blades');
    },
    /** The Blades upgrade's level (the blades under the mower: MowerBlades). */
    get bladesLevel(): number {
        return this.upgradeLevel('blades');
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

    // ---------------------------------------------------------------- upgrade pads (farm test)

    /** The grass a pad's next upgrade takes in all, or undefined when there's nothing left to buy there. */
    padCost(kind: PadKind): number | undefined {
        if (kind === 'tool') {
            const next = this.nextTool;
            return next ? nicePrice(grassFor(next.price)) : undefined;
        }
        const price = this.upgradePrice(upgradeDef(kind));
        return price === undefined ? undefined : nicePrice(grassFor(price));
    },

    /** Grass already in a pad toward its next upgrade. */
    padPaid(kind: PadKind): number {
        return state.padPaid[kind] ?? 0;
    },

    /**
     * Pours up to `amount` of the bag's grass into a pad. Returns how much went in, and whether that paid the upgrade
     * in full (it's applied then: the next mower, or a bag level, the pad starting over on the one after).
     */
    deposit(kind: PadKind, amount: number): { used: number; upgraded: boolean } {
        const cost = this.padCost(kind);
        if (cost === undefined) return { used: 0, upgraded: false };
        const used = Math.max(0, Math.min(amount, state.clippings, cost - this.padPaid(kind)));
        state.clippings -= used;
        state.padPaid[kind] = this.padPaid(kind) + used;
        const upgraded = state.padPaid[kind]! >= cost;
        if (upgraded) {
            state.padPaid[kind] = 0;
            if (kind === 'tool') state.toolLevel++;
            else state.upgrades[kind] = this.upgradeLevel(kind) + 1;
        }
        if (used > 0 || upgraded) this.changed();
        return { used, upgraded };
    },

    /** Where the player last stood somewhere stable (past the tutorial), or undefined. */
    get lastPosition(): { x: number; z: number } | undefined {
        return state.lastPosition;
    },

    /** Remembers where the player stands (saved with the rest, a moment later). */
    setLastPosition(x: number, z: number): void {
        const at = { x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100 };
        if (state.lastPosition && state.lastPosition.x === at.x && state.lastPosition.z === at.z) return;
        state.lastPosition = at;
        this.changed();
    },

    /** Debug: a pad's next upgrade for free (the next mower, blades or bag). Whether there was one. */
    grant(kind: PadKind): boolean {
        if (this.padCost(kind) === undefined) return false;
        state.padPaid[kind] = 0;
        if (kind === 'tool') state.toolLevel++;
        else state.upgrades[kind] = this.upgradeLevel(kind) + 1;
        this.changed();
        return true;
    },

    /** A visit to a pad that took grass counts as a sale (what the wardrobe waits for: appearsAfterSales). */
    countPadVisit(): void {
        state.stats.sells++;
        this.changed();
    },

    // ---------------------------------------------------------------- levels and the den's goods (farm test)

    /** Called with the new level when the player levels up. */
    levelUpListeners: [] as ((level: number) => void)[],

    get xp(): number {
        return state.xp;
    },

    /** The level `xp` reaches (1 from the start), the XP into it and the XP that level takes. */
    levelFor(xp: number): { level: number; into: number; need: number } {
        const levels = farmTest()?.levels;
        if (!levels) return { level: 1, into: 0, need: 1 };
        let level = 1;
        let left = xp;
        for (;;) {
            const index = level - 1;
            const need = index < levels.next.length ? levels.next[index]
                : Math.round(levels.next[levels.next.length - 1] * Math.pow(levels.growth, index - levels.next.length + 1));
            if (left < need) return { level, into: left, need };
            left -= need;
            level++;
        }
    },

    get level(): number {
        return this.levelFor(state.xp).level;
    },

    /** Adds experience (rounded down as it builds up); a level reached fires onLevelUp. */
    addXp(amount: number): void {
        if (amount <= 0 || !farmTest()) return;
        const before = this.level;
        state.xp += amount;
        this.changed();
        const after = this.level;
        if (after > before) this.levelUpListeners.forEach((listener) => listener(after));
    },

    get goods(): Readonly<{ eggs: number; trays: number; goldTrays?: number }> {
        return state.goods;
    },

    /** Den goods in the backpack (eggs and trays together). */
    get goodsCount(): number {
        return state.goods.eggs + state.goods.trays + (state.goods.goldTrays ?? 0);
    },

    /** Puts den goods in (or, negative, takes them out of) the backpack. */
    carry(kind: 'eggs' | 'trays' | 'goldTrays', amount: number): void {
        state.goods[kind] = Math.max(0, (state.goods[kind] ?? 0) + amount);
        this.changed();
    },

    /** The chicken den's state (changed through denChanged()). */
    get den(): { hens: number; floor: number[]; machine: number; trays: number; cash: number; dock?: boolean; truckCash?: number; belt?: boolean; helper?: boolean; truckHelper?: boolean; gold?: boolean; goldBelt?: boolean; goldMachine?: number; goldTrays?: number; tutorial?: boolean } {
        return state.den;
    },

    denChanged(): void {
        this.scheduleSave();
    },

    /** Pays money out (a hen bought); false if there isn't enough. */
    spend(amount: number): boolean {
        if (state.money < amount) return false;
        state.money -= amount;
        this.changed();
        return true;
    },

    /** All the money that can pay for things: carried first, then the den's cash piles (customers', trucks'). */
    get payable(): number {
        return state.money + state.den.cash + (state.den.truckCash ?? 0);
    },

    /** Takes up to `amount` to pay with: from the money carried first, then the den's piles. Returns what it took. */
    takePayment(amount: number): number {
        let left = Math.max(0, amount);
        const from = (have: number, take: (n: number) => void) => {
            const n = Math.min(have, left);
            if (n > 0) take(n);
            left -= n;
        };
        from(state.money, (n) => (state.money -= n));
        from(state.den.cash, (n) => (state.den.cash -= n));
        from(state.den.truckCash ?? 0, (n) => (state.den.truckCash = (state.den.truckCash ?? 0) - n));
        const taken = amount - left;
        if (taken > 0) this.changed();
        return taken;
    },

    /** Money already poured into `key` (a hen, the conveyor, the dock, an area). */
    paid(key: string): number {
        return state.paid?.[key] ?? 0;
    },

    /** Pours `amount` more into `key`. */
    addPaid(key: string, amount: number): void {
        state.paid ??= {};
        state.paid[key] = (state.paid[key] ?? 0) + amount;
        this.changed();
    },

    /** `key` is bought: what was poured into it goes. */
    clearPaid(key: string): void {
        if (state.paid) delete state.paid[key];
        this.changed();
    },

    /** Whether an area that's bought to open (DistrictDef.unlock) has been bought. */
    areaBought(id: string): boolean {
        return state.bought?.includes(id) ?? false;
    },

    buyArea(id: string): void {
        state.bought ??= [];
        if (!state.bought.includes(id)) state.bought.push(id);
        this.changed();
    },

    denFound(id: string): boolean {
        return state.densFound.includes(id);
    },

    /** A den reached; false if it already was. */
    findDen(id: string): boolean {
        if (state.densFound.includes(id)) return false;
        state.densFound.push(id);
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
        if (key === CARRIED_KEY) return state.carried;
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
        return state.carried > 0 || MOW.treasures.items.some((i) => this.unclaimedFor(i.id) > 0)
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
        if (key === CARRIED_KEY) {
            state.carried = 0;
            state.money += amount;
            this.changed();
            return amount;
        }
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

    /** This city is done (every area restored): marked, its next city unlocked. */
    completeCity(): void {
        if (state.completed.includes(CITY.id)) return;
        state.completed.push(CITY.id);
        this.changed();
    },

    /** Whether `city` can be played: the first, any finished, or the one after a finished one (not "coming soon"). */
    cityUnlocked(city: CityDef): boolean {
        if (city.comingSoon || !city.level) return false;
        const index = CITIES.indexOf(city);
        return index === 0 || state.allCitiesOpen || state.completed.includes(city.id) || state.completed.includes(CITIES[index - 1]?.id);
    },

    /**
     * Leaves for `city` (the city selector): its own save is played as it was left, or — never played — started: with
     * this city's gear if this one keeps it (the tutorial into the next), else from scratch (prestige: its bonus the
     * reward). Rewards not claimed here aren't lost: they move to the claimable pile every city shows (carried).
     * Saves, and switches over (setCity(), its save loaded): the caller rebuilds the scene.
     */
    travel(city: CityDef): void {
        const keys = [...MOW.treasures.items.map((item) => item.id), ...MOW.districts.map((district) => areaBonusKey(district.id))];
        for (const key of keys) {
            const left = this.unclaimedFor(key);
            if (left <= 0) continue;
            state.carried += left;
            state.treasuresClaimed.push(key);
        }
        this.saveNow();
        try {
            if (!window.localStorage.getItem(cityKey(city.id)) && CITY.keepGear && city === CITIES[CITIES.indexOf(CITY) + 1]) {
                const carried: Partial<SaveData> = { version: SAVE_VERSION, money: state.money, toolLevel: state.toolLevel, upgrades: state.upgrades };
                window.localStorage.setItem(cityKey(city.id), JSON.stringify(carried));
            }
            window.localStorage.setItem(CURRENT_CITY_KEY, city.id);
        } catch {
            // No storage: played unsaved.
        }
        window.clearTimeout(saveTimer);
        cutProvider = undefined;
        setCity(city);
        state = load();
    },

    /** True the first time `key` is passed, ever (saved): one-time analytics events. */
    /** Whether `once(key)` already happened (without marking it). */
    sentBefore(key: string): boolean {
        return state.sent.includes(key);
    },

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
            window.localStorage.setItem(cityKey(CITY.id), JSON.stringify(city));
            window.localStorage.setItem(GLOBAL_KEY, JSON.stringify(global));
        } catch {
            // Storage full or blocked: keep playing unsaved.
        }
    },

    /** Debug: every playable city can be travelled to. */
    openAllCities(): void {
        state.allCitiesOpen = true;
        this.changed();
    },

    /**
     * Debug: this city from scratch (its save gone, and no longer counted as finished); the wardrobe and the other
     * cities stay. The caller rebuilds the scene.
     */
    resetCity(): void {
        window.clearTimeout(saveTimer);
        cutProvider = undefined;
        try {
            window.localStorage.removeItem(cityKey(CITY.id));
        } catch {
            // No storage: nothing saved to remove.
        }
        state = load();
        state.completed = state.completed.filter((id) => id !== CITY.id);
        this.saveNow();
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
