// MowProgress.ts
//
// The player's saved state: money, the tool owned, upgrade levels, the clippings in the container, which grass has
// been cut (from the grass field, as a compact string), which districts are restored, and the wardrobe (owned and worn
// looks). One localStorage entry, saved shortly after any change; versioned (SAVE_VERSION): a save from another version
// starts a new game. Fields added later get their defaults on an older save of the same version (load()).

import { Signal } from 'signals';
import { MOW, ToolDef, UpgradeDef, UpgradeId, WardrobeItem } from './MowConfig';

export type LookKind = 'colors' | 'faces' | 'hats';
/** The wardrobe's kinds (its section in ui/mow.json also has a $comment: never walk its keys). */
export const LOOK_KINDS: LookKind[] = ['colors', 'faces', 'hats'];

/** What the player wears. */
export interface Look {
    color: string;
    face: string;
    hat: string;
}

const SAVE_KEY = 'mow.save';
/** Bump when a change can't carry old saves over: a save from another version starts a new game. */
const SAVE_VERSION = 3;
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
    /** Treasures found (ids), and rewards claimed (treasure ids, and `area:<section id>` for an area's bonus). */
    treasuresFound: string[];
    treasuresClaimed: string[];
}

/** The claim key of an area's bonus (all its treasures found). */
export const areaBonusKey = (areaId: string): string => `area:${areaId}`;

/** A new player: the first colour and face, no hat. */
const starterLook = (): Look => ({ color: MOW.wardrobe.colors[0].id, face: MOW.wardrobe.faces[0].id, hat: '' });

const fresh = (): SaveData => ({
    version: SAVE_VERSION, money: 0, toolLevel: 0, upgrades: {}, clippings: 0, cut: '', restored: [],
    stats: { cells: 0, earned: 0, sells: 0 }, sent: [],
    owned: { colors: [], faces: [], hats: [] }, look: starterLook(), wardrobeBudget: 0,
    treasuresFound: [], treasuresClaimed: [],
});

function load(): SaveData {
    try {
        const raw = window.localStorage.getItem(SAVE_KEY);
        if (raw) {
            const saved = JSON.parse(raw) as Partial<SaveData>;
            if (saved.version !== SAVE_VERSION) return fresh();
            return {
                ...fresh(), ...saved, upgrades: { ...saved.upgrades }, stats: { ...fresh().stats, ...saved.stats },
                owned: { ...fresh().owned, ...saved.owned }, look: { ...starterLook(), ...saved.look },
            };
        }
    } catch {
        // A broken save starts fresh.
    }
    return fresh();
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
        const earned = Math.round(state.clippings * MOW.clippingPrice * (1 + this.moneyBonus));
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

    /** Something in the wardrobe became affordable since it was last opened (its "!"). */
    get wardrobeHasNews(): boolean {
        return LOOK_KINDS.some((kind) => MOW.wardrobe[kind].some((item) =>
            !this.ownsLook(kind, item) && item.price <= state.money && item.price > state.wardrobeBudget));
    },

    /** The wardrobe was opened: everything affordable now has been seen. */
    markWardrobeSeen(): void {
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

    /** Buys (if needed) and wears a look; false when it costs more than the money there is. */
    wearLook(kind: LookKind, item: WardrobeItem): boolean {
        if (!this.ownsLook(kind, item)) {
            if (state.money < item.price) return false;
            state.money -= item.price;
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
    get cellsCut(): number {
        return state.stats.cells;
    },

    addMoney(amount: number): void {
        state.money += amount;
        this.changed();
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
};
