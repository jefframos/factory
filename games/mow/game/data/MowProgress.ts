// MowProgress.ts
//
// The player's saved state: money, the tool owned, upgrade levels, the clippings in the container, which grass has
// been cut (from the grass field, as a compact string), which districts are restored, and the wardrobe (owned and worn
// looks). Two entries in the platform's storage (SaveStorage), saved shortly after any change and as the game's left: the city's own (`mow.save.<city>`: its gear,
// money, grass, areas, trophies and secrets — each city is played from scratch, prestige-style) and the player's
// (`mow.global`: the wardrobe, the cities finished — their bonus — and the one-time analytics). Versioned
// (SAVE_VERSION): a save from another version starts a new game. Fields added later get their defaults (load()).

import { Signal } from 'signals';
import { SaveStorage } from 'core/platforms/SaveStorage';
import { MOW, CITY, CITIES, CityDef, CURRENT_CITY_KEY, PRESTIGE_BONUS, ToolDef, UpgradeDef, UpgradeId, WardrobeItem, currentCity, setCity, grassFor, farmTest, nicePrice } from './MowConfig';
import { TRACTOR_ITEMS, TRACTOR_KINDS, TractorItem, TractorKind, TractorLook } from './TractorSkins';

/** The farm test's upgrade pads (UpgradePads): the next mower, the next bag size, the next blades. */
export type PadKind = 'tool' | 'capacity' | 'blades';

export type LookKind = 'colors' | 'faces' | 'hats' | 'bottoms' | 'patterns';
/** The wardrobe's kinds (its section in ui/mow.json also has a $comment: never walk its keys). */
export const LOOK_KINDS: LookKind[] = ['colors', 'faces', 'hats', 'bottoms', 'patterns'];

/** What the player wears. */
export interface Look {
    color: string;
    face: string;
    hat: string;
    /** Skin tone (colour hex; unset: the player's own). */
    skin?: string;
    /** Trousers colour (unset: the player's own), and the top's pattern (`kind:#hex`; unset or '': plain). */
    bottom?: string;
    pattern?: string;
}

const cityKey = (city: string): string => `mow.save.${city}`;
const GLOBAL_KEY = 'mow.global';
/** Bump when a change can't carry old saves over: a save from another version starts a new game. */
const SAVE_VERSION = 9;
/** What's the player's, not the city's (kept across cities: the wardrobe, the cities finished, the analytics). */
const GLOBAL_FIELDS = ['owned', 'look', 'tractorOwned', 'tractorLook', 'freeLooksOffered', 'sent', 'completed', 'carried', 'allCitiesOpen'] as const;
/** The claim key of the rewards left unclaimed in cities travelled from (SaveData.carried). */
export const CARRIED_KEY = 'carried';
const SAVE_DELAY_MS = 2000;

/** The cow barn (CowDen): what's kept of it. */
/** A crop farm's state (CropFarm). */
export interface CropFarmState {
    /** Plots owned (the first free). */
    plots: number;
    /** Each plot: seconds grown toward ripe, and the ripe fruit left on it (0: still growing). */
    grown: number[];
    left: number[];
    /** Fresh fruit in the crate, fruit in the machine, products on its grid. */
    fresh: number;
    machineIn: number;
    made: number;
    /** Cash on its customers' square, and on its harbour's. */
    cash: number;
    boatCash: number;
    dock?: boolean;
    picker?: boolean;
    helper?: boolean;
    boatHelper?: boolean;
    tutorial?: boolean;
}

export interface BarnState {
    cows: number;
    /** Milk on each stall's spot. */
    floor: number[];
    /** Milk in the butter churn and the cheese press, and what's out on their grids. */
    butterIn: number;
    cheeseIn: number;
    butter: number;
    cheese: number;
    /** Cash on its customers' square, and on its trucks' square. */
    cash: number;
    truckCash: number;
    /** Its belt and its truck dock bought, its first visit's lesson done. */
    belt?: boolean;
    dock?: boolean;
    tutorial?: boolean;
    /** Its counter helper and its trucks' helper hired. */
    helper?: boolean;
    truckHelper?: boolean;
}

/** Running on foot, at most this fast (world units a second; the boost on top counts half: footSpeed). */
const FOOT_SPEED = 4.6;

/** SELL x2 (the dig game's phone): its first sales are free, then each takes a rewarded video. */
const SELL_X2_FREE = 2;

const freshBarn = (): BarnState => ({ cows: 0, floor: [], butterIn: 0, cheeseIn: 0, butter: 0, cheese: 0, cash: 0, truckCash: 0 });

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
    /** The tractor's skins: owned (`paints:bee`), worn, and the money when its panel was last opened (undefined: never). */
    tractorOwned?: string[];
    tractorLook?: TractorLook;
    tractorBudget?: number;
    /** Money when the wardrobe was last opened: things that became affordable since get its "!". */
    wardrobeBudget: number;
    /** The wardrobe was opened again after the first hat: an unclaimed gift (free colour / face) now shows its FREE badge. */
    freeLooksOffered: boolean;
    /** Treasures found (ids), and rewards claimed (treasure ids, and `area:<section id>` for an area's bonus). */
    treasuresFound: string[];
    /** Special skin tones unlocked by a video (ids). */
    skinsUnlocked?: string[];
    /** Locked chests found and not opened yet (the farm test): what each holds. */
    lockedChests?: { id: string; reward: number }[];
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
    /** Bushes and trees cleared (Growth's ids). */
    growthCleared: number[];
    /** SELL x2 sales taken for free so far (the first SELL_X2_FREE skip the video). */
    freeSells: number;
    /** What the bag's clippings are worth (money, before boosts): each area's grass at its own value. */
    bagWorth?: number;
    /** Seconds of play toward the next regrow of restored areas (TOWN.farm.regrow). */
    regrowClock?: number;
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
    goods: { eggs: number; trays: number; goldTrays?: number; milk?: number; butter?: number; cheese?: number; crops?: Record<string, number> };
    /** Farm test: the crop farms (CropFarm), by id. */
    cropFarms?: Record<string, CropFarmState>;
    /** Farm test: the cow barn (CowDen) — cows owned, milk on each stall's spot, in each machine, out on each grid, cash. */
    barn: BarnState;
    /** Farm test: the chicken den — hens owned, eggs on each nest's floor, eggs in the machine, trays on its grid, cash on its square. */
    den: { hens: number; floor: number[]; machine: number; trays: number; cash: number; dock?: boolean; truckCash?: number; belt?: boolean; helper?: boolean; truckHelper?: boolean; gold?: boolean; goldBelt?: boolean; goldMachine?: number; goldTrays?: number; tutorial?: boolean };
}

/** The claim key of an area's bonus (all its treasures found). */
export const areaBonusKey = (areaId: string): string => `area:${areaId}`;

const NO_TRACTOR_LOOK: TractorLook = { paints: '', parts: '' };

/** A new player: the first colour and face, no hat. */
const starterLook = (): Look => ({ color: MOW.wardrobe.colors[0].id, face: MOW.wardrobe.faces[0].id, hat: '' });

const fresh = (): SaveData => ({
    version: SAVE_VERSION, money: 0, toolLevel: 0, upgrades: {}, clippings: 0, cut: '',
    stats: { cells: 0, earned: 0, sells: 0 }, sent: [],
    owned: { colors: [], faces: [], hats: [], bottoms: [], patterns: [] }, look: starterLook(), wardrobeBudget: 0, freeLooksOffered: false,
    treasuresFound: [], treasuresClaimed: [], secretsFound: [], completed: [], carried: 0, allCitiesOpen: false,
    padPaid: {}, densFound: [], growthCleared: [], freeSells: 0, barn: freshBarn(), xp: 0, goods: { eggs: 0, trays: 0 }, den: { hens: 0, floor: [], machine: 0, trays: 0, cash: 0 },
    // The city's areas the tutorial already did (startRestored).
    restored: MOW.districts.filter((district) => district.startRestored).map((district) => district.id),
});

function read(key: string): Partial<SaveData> | undefined {
    try {
        const raw = SaveStorage.getItem(key);
        const saved = raw ? (JSON.parse(raw) as Partial<SaveData>) : undefined;
        // Version 8 still had the Reel Mower as the first: every mower's one lower now.
        if (saved?.version === 8) return { ...saved, version: SAVE_VERSION, ...(saved.toolLevel === undefined ? {} : { toolLevel: Math.max(0, saved.toolLevel - 1) }) };
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
        ...fresh(), ...saved, upgrades: { ...saved.upgrades }, padPaid: { ...saved.padPaid }, goods: { ...fresh().goods, ...saved.goods }, barn: { ...freshBarn(), ...saved.barn },
        den: { ...fresh().den, ...saved.den }, stats: { ...fresh().stats, ...saved.stats },
        owned: { ...fresh().owned, ...saved.owned }, look: { ...starterLook(), ...saved.look },
    };
}

let state = load();
// (Older saves could hold a fraction of a dollar.)
state.money = Math.round(state.money);
let saveTimer: number | undefined;
let wiped = false;
/** The save's been read from the platform (begin()): till then nothing's written, or a new game's would go over it. */
let ready = false;
let cutProvider: (() => string) | undefined;

const upgradeDef = (id: UpgradeId): UpgradeDef => MOW.upgrades.find((u) => u.id === id)!;

export const MowProgress = {
    /** Every key the save's in (SaveStorage.load() at boot). */
    saveKeys: [GLOBAL_KEY, CURRENT_CITY_KEY, ...CITIES.map((city) => cityKey(city.id))],

    /** At boot, the platform's storage read: the save, as it is there, and from now on it's kept (as the game's left too). */
    begin(): void {
        setCity(currentCity());
        state = load();
        state.money = Math.round(state.money);
        ready = true;
        SaveStorage.saveOnLeave(() => this.saveNow());
    },

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

    /**
     * A boost's whole effect as a multiplier: 1 + perLevel x level, doubled at each milestone reached (POWER-UPS'
     * money tracks).
     */
    boostFactor(id: UpgradeId): number {
        const def = upgradeDef(id);
        const level = this.upgradeLevel(id);
        return MowProgress.factorAt(def, level);
    },

    /** A boost's multiplier at `level` (what boostFactor() is at that level). */
    factorAt(def: UpgradeDef, level: number): number {
        const doubled = (def.milestones ?? []).filter((m) => level >= m).length;
        return (1 + def.perLevel * level) * Math.pow(2, doubled);
    },

    /** Cutting width: the tool's plus the Cutting Width upgrade. */
    get width(): number {
        return this.tool.width + upgradeDef('width').perLevel * this.upgradeLevel('width');
    },
    /** Walking speed: the tool's, times the Speed upgrade. */
    get speed(): number {
        return this.tool.speed * this.boostFactor('speed');
    },
    /**
     * On foot (the mower parked: dens, farms, the harbour): a running pace, not the tractor's. At most FOOT_SPEED, and
     * the Speed boost counts half.
     */
    get footSpeed(): number {
        return Math.min(this.tool.speed, FOOT_SPEED) * (1 + (this.boostFactor('speed') - 1) * 0.5);
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
        return this.boostFactor('money') - 1;
    },
    /** How fast tough grass (and growth) is chewed through (1 = base; the blades' level and the Sharp Edge boost). */
    get chewRate(): number {
        return (1 + upgradeDef('blades').perLevel * this.upgradeLevel('blades')) * this.boostFactor('chew');
    },
    /** Clippings per cut, as a multiplier (1 = base; the Grass Gain boost). */
    get grassGain(): number {
        return this.boostFactor('grass');
    },
    /** How fast the dens work: laying, milking, packing, making (1 = base; the Farm Speed boost). */
    get farmSpeed(): number {
        return this.boostFactor('farm');
    },
    /** A den's payout with the Money Gain boost on it. */
    farmPay(amount: number): number {
        return Math.round(amount * (1 + this.moneyBonus));
    },
    /** A power-up the money covers (the POWER-UPS button's "!"): `ids` are the ones on offer. */
    canAffordAny(ids: readonly UpgradeId[]): boolean {
        return ids.some((id) => state.money >= (this.upgradePrice(upgradeDef(id)) ?? Infinity));
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
        const def = upgradeDef('capacity');
        const level = this.upgradeLevel('capacity');
        // The station's levels, times the Bag Size power-up.
        const base = def.share ? this.tool.capacity * (1 + def.perLevel * level) : this.tool.capacity + def.perLevel * level;
        return Math.round(base * this.boostFactor('bag'));
    },
    /** What the next Capacity level adds to the bag now. */
    get capacityStep(): number {
        const def = upgradeDef('capacity');
        return Math.round((def.share ? this.tool.capacity * def.perLevel : def.perLevel) * this.boostFactor('bag'));
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

    /**
     * Adds up to `amount` clippings worth `worth` in all (money before boosts; by default at the plain selling price);
     * returns how many fitted (the worth taken in the same share).
     */
    addClippings(amount: number, worth = amount * MOW.clippingPrice): number {
        const fits = Math.max(0, Math.min(amount, this.capacity - state.clippings));
        if (fits > 0) {
            state.clippings += fits;
            state.bagWorth = this.bagWorth + (amount > 0 ? worth * (fits / amount) : 0);
            this.changed();
        }
        return fits;
    },

    /** What the bag's clippings are worth before boosts (older saves: at the plain selling price). */
    get bagWorth(): number {
        return state.bagWorth ?? state.clippings * MOW.clippingPrice;
    },

    /** What the bag sells for (boosts on), and what it counts for poured into a station. */
    get bagValue(): number {
        return this.bagWorth * (1 + this.moneyBonus) * (1 + this.prestige);
    },

    /** Money a station can take right now: the bag at its value, then the money carried. */
    get pourable(): number {
        return this.bagValue + state.money;
    },

    /** A grass cell was cut (the counter only: its clippings go through addClippings). */
    recordCut(): void {
        state.stats.cells++;
    },

    /** Sells the container (at `multiplier`: SELL x2's double); returns the money earned. */
    sell(multiplier = 1): number {
        const earned = Math.round(this.bagValue * multiplier);
        if (state.clippings <= 0) return 0;
        state.clippings = 0;
        state.bagWorth = 0;
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

    /** The money a pad's next upgrade takes in all, or undefined when there's nothing left to buy there. */
    padCost(kind: PadKind): number | undefined {
        if (kind === 'tool') {
            const next = this.nextTool;
            return next ? nicePrice(next.price) : undefined;
        }
        return this.upgradePrice(upgradeDef(kind));
    },

    /** Money already in a pad toward its next upgrade. */
    padPaid(kind: PadKind): number {
        return state.padPaid[kind] ?? 0;
    },

    /**
     * Pours up to `amount` (money) into a pad: the bag's grass first, at its value, then the money carried. Returns how
     * much went in, and whether that paid the upgrade in full (it's applied then: the next mower, or a bag level, the
     * pad starting over on the one after).
     */
    deposit(kind: PadKind, amount: number): { used: number; upgraded: boolean } {
        const cost = this.padCost(kind);
        if (cost === undefined) return { used: 0, upgraded: false };
        const wanted = Math.max(0, Math.min(amount, cost - this.padPaid(kind)));
        const value = this.bagValue;
        const fromBag = Math.min(wanted, value);
        if (fromBag > 0) {
            // The bag's grass goes in the same share as its value.
            const keep = value - fromBag > 1e-6 ? 1 - fromBag / value : 0;
            state.clippings *= keep;
            state.bagWorth = this.bagWorth * keep;
        }
        // (Whole dollars: a fraction left over goes in as a dollar.)
        const fromMoney = Math.min(Math.ceil(Math.max(0, wanted - fromBag) - 1e-9), Math.floor(state.money));
        state.money -= fromMoney;
        const used = fromBag + fromMoney;
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

    get goods(): Readonly<{ eggs: number; trays: number; goldTrays?: number; milk?: number; butter?: number; cheese?: number }> {
        return state.goods;
    },

    /** Den goods in the backpack (eggs and trays together). */
    get goodsCount(): number {
        return state.goods.eggs + state.goods.trays + (state.goods.goldTrays ?? 0);
    },

    /** Puts den goods in (or, negative, takes them out of) the backpack. */
    carry(kind: 'eggs' | 'trays' | 'goldTrays' | 'milk' | 'butter' | 'cheese', amount: number): void {
        state.goods[kind] = Math.max(0, (state.goods[kind] ?? 0) + amount);
        this.changed();
    },

    /** A crop farm's state (made on first use; changed through denChanged()). */
    cropFarm(id: string): CropFarmState {
        state.cropFarms ??= {};
        return (state.cropFarms[id] ??= { plots: 0, grown: [], left: [], fresh: 0, machineIn: 0, made: 0, cash: 0, boatCash: 0 });
    },

    /** How many of a crop farm's goods (`crop:<id>`, `product:<id>`) the player carries. */
    carried(kind: string): number {
        return state.goods.crops?.[kind] ?? 0;
    },

    carryItem(kind: string, amount: number): void {
        state.goods.crops ??= {};
        state.goods.crops[kind] = Math.max(0, (state.goods.crops[kind] ?? 0) + amount);
        this.changed();
    },

    /** The crop goods carried (for the backpack). */
    get carriedCrops(): { kind: `crop:${string}` | `product:${string}`; count: number }[] {
        return Object.entries(state.goods.crops ?? {}).filter(([, count]) => count > 0)
            .map(([kind, count]) => ({ kind: kind as `crop:${string}` | `product:${string}`, count }));
    },

    /** The chicken den's state (changed through denChanged()). */
    get den(): { hens: number; floor: number[]; machine: number; trays: number; cash: number; dock?: boolean; truckCash?: number; belt?: boolean; helper?: boolean; truckHelper?: boolean; gold?: boolean; goldBelt?: boolean; goldMachine?: number; goldTrays?: number; tutorial?: boolean } {
        return state.den;
    },

    /** The cow barn's state (changed through denChanged()). */
    get barn(): BarnState {
        return state.barn;
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

    /**
     * Play time toward the next regrow of restored areas: true (and the clock starts over) once `everySec` has passed.
     * (Saved with whatever saves next: no save of its own every frame.)
     */
    regrowDue(delta: number, everySec: number): boolean {
        state.regrowClock = (state.regrowClock ?? 0) + delta;
        if (state.regrowClock < everySec) return false;
        state.regrowClock = 0;
        this.scheduleSave();
        return true;
    },

    /** SELL x2 sales still free (no video). */
    get freeSellsLeft(): number {
        return Math.max(0, SELL_X2_FREE - state.freeSells);
    },

    /** SELL x2's very first sale: free, and the hand points at it. */
    get firstFreeSell(): boolean {
        return state.freeSells === 0;
    },

    useFreeSell(): void {
        state.freeSells++;
        this.scheduleSave();
    },

    /** A bush or tree cleared (Growth's id). */
    isGrowthCleared(id: number): boolean {
        return state.growthCleared.includes(id);
    },

    clearGrowth(id: number): void {
        if (state.growthCleared.includes(id)) return;
        state.growthCleared.push(id);
        this.scheduleSave();
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
        // (Faces aren't in the wardrobe any more: they don't show on the people models.)
        const shown = LOOK_KINDS.filter((kind) => kind !== 'faces');
        if (this.boughtFirstHat && shown.some((kind) => this.unclaimedFreeLook(kind))) return true;
        return shown.some((kind) => MOW.wardrobe[kind].some((item) =>
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
    /** Whether a skin tone can be worn: every plain one; a special one once its video's been watched. */
    skinUnlocked(skin: { id: string; video?: boolean }): boolean {
        return !skin.video || (state.skinsUnlocked ?? []).includes(skin.id);
    },

    unlockSkin(id: string): void {
        if (!(state.skinsUnlocked ??= []).includes(id)) state.skinsUnlocked.push(id);
        this.changed();
    },

    /** Wears a skin tone (the scene re-dresses the player: MowPlayer.applyLook). */
    wearSkin(id: string): void {
        state.look.skin = id;
        this.changed();
    },

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
        else if (kind === 'bottoms') state.look.bottom = item.id;
        else if (kind === 'patterns') state.look.pattern = item.id;
        else state.look.hat = item.id;
        this.changed();
        return true;
    },

    // ---------------------------------------------------------------- the tractor's skins

    /** What the tractor wears. */
    get tractorLook(): Readonly<TractorLook> {
        return state.tractorLook ?? NO_TRACTOR_LOOK;
    },

    ownsTractor(kind: TractorKind, item: TractorItem): boolean {
        return !item.id || (state.tractorOwned ?? []).includes(`${kind}:${item.id}`);
    },

    /** Buys (if needed: a gift costs nothing, a video's is never sold) and puts on a skin; false if it can't be had. */
    wearTractor(kind: TractorKind, item: TractorItem): boolean {
        if (!this.ownsTractor(kind, item)) {
            if (item.video) return false;
            if (!item.free) {
                if (state.money < item.price) return false;
                state.money -= item.price;
            }
            this.ownTractor(kind, item);
        }
        state.tractorLook = { ...this.tractorLook, [kind]: item.id };
        this.changed();
        return true;
    },

    /** A skin won (a rewarded video's): owned and put on. */
    unlockTractor(kind: TractorKind, item: TractorItem): void {
        this.ownTractor(kind, item);
        this.wearTractor(kind, item);
    },

    ownTractor(kind: TractorKind, item: TractorItem): void {
        if (!this.ownsTractor(kind, item)) (state.tractorOwned ??= []).push(`${kind}:${item.id}`);
    },

    /** The gift (a free skin) not claimed yet, if any. */
    tractorGift(): { kind: TractorKind; item: TractorItem } | undefined {
        for (const kind of TRACTOR_KINDS) {
            const item = TRACTOR_ITEMS[kind].find((entry) => entry.free && !this.ownsTractor(kind, entry));
            if (item) return { kind, item };
        }
        return undefined;
    },

    /** One to offer for a video: any not owned, the ones only a video gives first. */
    tractorToOffer(kind: TractorKind): TractorItem | undefined {
        const locked = TRACTOR_ITEMS[kind].filter((item) => !item.free && !this.ownsTractor(kind, item));
        const videos = locked.filter((item) => item.video);
        const from = videos.length ? videos : locked;
        return from[Math.floor(Math.random() * from.length)];
    },

    /** Its panel's "!": a gift in it, or something that's become affordable since it was last opened (or it never was). */
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

    /** Locked chests waiting to be opened (LockedChests). */
    get lockedChests(): readonly { id: string; reward: number }[] {
        return state.lockedChests ?? [];
    },

    addLockedChest(id: string, reward: number): void {
        (state.lockedChests ??= []).push({ id, reward });
        this.changed();
    },

    /** Opens the first waiting chest: its money is the player's (boosted like any other). Returns what it paid. */
    openLockedChest(): number {
        const chest = state.lockedChests?.shift();
        if (!chest) return 0;
        const paid = Math.round(chest.reward * (1 + this.moneyBonus) * (1 + this.prestige));
        state.money += paid;
        state.stats.earned += paid;
        this.changed();
        return paid;
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
        // Whole dollars only (fractions come from the bag's worth and boosts).
        state.money = Math.round(state.money + amount);
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
            if (!SaveStorage.getItem(cityKey(city.id)) && CITY.keepGear && city === CITIES[CITIES.indexOf(CITY) + 1]) {
                const carried: Partial<SaveData> = { version: SAVE_VERSION, money: state.money, toolLevel: state.toolLevel, upgrades: state.upgrades };
                SaveStorage.setItem(cityKey(city.id), JSON.stringify(carried));
            }
            SaveStorage.setItem(CURRENT_CITY_KEY, city.id);
        } catch {
            // No storage: played unsaved.
        }
        window.clearTimeout(saveTimer);
        saveTimer = undefined;
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

    /** Saves in a moment. (Not put off by the next change: mowing never stops changing things, and it would never save.) */
    scheduleSave(): void {
        if (saveTimer !== undefined) return;
        saveTimer = window.setTimeout(() => this.saveNow(), SAVE_DELAY_MS);
    },

    saveNow(): void {
        window.clearTimeout(saveTimer);
        saveTimer = undefined;
        if (wiped || !ready) return;
        if (cutProvider) state.cut = cutProvider();
        try {
            const city: Partial<SaveData> = { ...state };
            const global: Partial<SaveData> = { version: SAVE_VERSION };
            for (const field of GLOBAL_FIELDS) {
                (global as Record<string, unknown>)[field] = state[field];
                delete (city as Record<string, unknown>)[field];
            }
            SaveStorage.setItem(cityKey(CITY.id), JSON.stringify(city));
            SaveStorage.setItem(GLOBAL_KEY, JSON.stringify(global));
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
        saveTimer = undefined;
        cutProvider = undefined;
        try {
            SaveStorage.removeItem(cityKey(CITY.id));
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
        for (const city of CITIES) SaveStorage.removeItem(cityKey(city.id));
        SaveStorage.removeItem(GLOBAL_KEY);
        SaveStorage.removeItem(CURRENT_CITY_KEY);
        window.location.reload();
    },
};
