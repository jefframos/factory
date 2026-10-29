// DigProgress.ts
//
// The player's saved state (GDD §15 persistence): money, tool and backpack levels, what's in the
// backpack, finds collected (and which the player has looked at in the collection), the deepest zone
// reached, the wardrobe (owned and worn looks), and which terrain cells have been dug. One localStorage entry, saved shortly after any
// change so a burst of digging writes once.

import { Signal } from 'signals';
import { AchievementStat, DIG, FindDef, ToolDef, WardrobeItem } from './DigConfig';

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

const SAVE_KEY = 'dig.save';
const SAVE_DELAY_MS = 800;

interface SaveData {
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
}

const starterLook = (): Look => ({ color: DIG.wardrobe.colors[0].id, face: DIG.wardrobe.faces[0].id, hat: DIG.wardrobe.hats[0].id });

const fresh = (): SaveData => ({
    money: 0, toolLevel: 0, backpackLevel: 0, backpack: {}, found: {}, seen: [], collectionDone: false, deepestZone: 0,
    owned: { colors: [], faces: [], hats: [] }, look: starterLook(), wardrobeBudget: 0, wardrobeVisited: false, dug: '', built: [],
    stats: { blocks: 0, ores: 0, earned: 0, sells: 0 }, achievements: {}, revealedAt: {},
});

function load(): SaveData {
    try {
        const raw = window.localStorage.getItem(SAVE_KEY);
        if (raw) {
            const saved = JSON.parse(raw) as Partial<SaveData>;
            return { ...fresh(), ...saved, stats: { ...fresh().stats, ...saved.stats }, revealedAt: { ...saved.revealedAt }, look: { ...starterLook(), ...saved.look }, owned: { ...fresh().owned, ...saved.owned } };
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
    /** True when the next tool or backpack is affordable (the ATM shows "!"). */
    get canAffordUpgrade(): boolean {
        const tool = this.nextTool;
        const bag = this.nextBackpack;
        return (!!tool && state.money >= tool.price) || (!!bag && state.money >= bag.price);
    },
    /** The current tool is the tractor (the end of the tool path): ridden outside the hub. */
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

    /** Sells everything in the backpack; returns the money earned. */
    sellAll(): number {
        let earned = 0;
        for (const [id, count] of Object.entries(state.backpack)) {
            earned += (DIG.materials.find((m) => m.id === id)?.value ?? 0) * count;
        }
        state.backpack = {};
        state.money += earned;
        if (earned > 0) state.stats.sells++;
        state.stats.earned += earned;
        this.changed();
        return earned;
    },

    /** A find was dug up: pays its reward, and the collection reward when it was the last one missing. */
    addFind(find: FindDef): FindResult {
        const first = !state.found[find.id];
        state.found[find.id] = (state.found[find.id] ?? 0) + 1;
        state.money += find.reward;
        state.stats.earned += find.reward;
        const completed = !state.collectionDone && this.collectedCount === DIG.finds.length;
        if (completed) {
            state.collectionDone = true;
            state.money += DIG.collectionReward.money;
        }
        this.changed();
        return { first, completed };
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

    /** Starter looks are free; the collection-reward hat comes with completing the collection. */
    ownsLook(kind: LookKind, item: WardrobeItem): boolean {
        if (item.unlock === 'collection') return state.collectionDone;
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

    /** Tool and backpack upgrades bought, together (the hub's reveal areas count them). */
    get upgradesBought(): number {
        return state.toolLevel + state.backpackLevel;
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

    /** A block was dug (the Digger / Ore Hunter achievements count them). */
    recordBlock(ore: boolean): void {
        state.stats.blocks++;
        if (ore) state.stats.ores++;
    },

    achievementStat(stat: AchievementStat): number {
        return stat === 'finds' ? this.collectedCount : state.stats[stat];
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
        return !!achievement && this.achievementLevel(id) >= achievement.tiers.length;
    },

    /** Pays the current tier and moves on; `decor` when that was the last tier. Undefined when not ready. */
    claimAchievement(id: string): { reward: number; decor: boolean } | undefined {
        if (!this.canClaim(id)) return undefined;
        const achievement = DIG.achievements.find((a) => a.id === id)!;
        const level = this.achievementLevel(id);
        const reward = achievement.tiers[level].reward;
        state.money += reward;
        state.achievements[id] = level + 1;
        this.changed();
        return { reward, decor: level + 1 >= achievement.tiers.length };
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
