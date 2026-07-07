import PlatformHandler from '@core/platforms/PlatformHandler';
import shopItemsJson from './shopItems.json';

export type ShopItemKind = 'cosmetic' | 'achievement' | 'free';

/** The always-unlocked, no-ad-required starting skin — see shopItems.json. */
export const DEFAULT_SKIN_ID = 'default';

export interface ShopItem {
    id: string;
    name: string;
    description: string;
    icon: string;
    kind: ShopItemKind;
    /** Only present on kind: 'achievement' items. */
    valueThreshold?: number;
    /** Only present on kind: 'achievement' items — e.g. "8K", "1M". */
    shortLabel?: string;
}

export const SHOP_ITEMS: ShopItem[] = shopItemsJson as ShopItem[];

interface ShopSaveData {
    version: number;
    unlockedAchievementIds: string[];
    equippedSkinId: string;
    bestValueReached: number;
}

/**
 * Persists shop unlock/equip state via PlatformHandler (localStorage under
 * every current platform backend — see IPlatformConnection). Achievement
 * unlocks are permanent once earned; cosmetic items never get a persisted
 * "owned" flag — only the currently-equipped id survives a reload (see
 * ShopScreen's ad-gating, which decides *when* equip() is allowed to run,
 * not this class). DEFAULT_SKIN_ID (kind: 'free') is the initial equip and
 * is always available with no ad/achievement gate.
 *
 * Cosmetic items also get a session-only unlock (sessionUnlockedCosmeticIds)
 * — deliberately in-memory-only, never persisted — so switching back and
 * forth between cosmetics already watched-for this session doesn't ask for
 * another ad each time, but a refresh always resets it back to "every
 * cosmetic needs an ad again".
 */
export class ShopStorage {
    private static readonly KEY = 'CLOG_SHOP_DATA';
    private static readonly CURRENT_VERSION = 1;

    private static _cachedData: ShopSaveData | null = null;
    private static readonly sessionUnlockedCosmeticIds = new Set<string>();

    private static createDefaultData(): ShopSaveData {
        return {
            version: this.CURRENT_VERSION,
            unlockedAchievementIds: [],
            equippedSkinId: DEFAULT_SKIN_ID,
            bestValueReached: 0,
        };
    }

    /** Call once at boot, before the shop UI or BaseDemoScene.update() can run. */
    static async load(): Promise<void> {
        try {
            const raw = await PlatformHandler.instance.platform.getItem(this.KEY);
            let parsed = raw ? JSON.parse(raw) : null;
            if (parsed && parsed.version !== this.CURRENT_VERSION) parsed = null;
            this._cachedData = parsed ? { ...this.createDefaultData(), ...parsed } : this.createDefaultData();
        } catch (e) {
            console.error('ShopStorage: failed to load save data', e);
            this._cachedData = this.createDefaultData();
        }

        // Whatever was equipped when the session started is already "in use" —
        // never ask for an ad just to switch back to it later this session.
        this.sessionUnlockedCosmeticIds.add(this._cachedData.equippedSkinId);
    }

    private static data(): ShopSaveData {
        if (!this._cachedData) this._cachedData = this.createDefaultData();
        return this._cachedData;
    }

    static isAchievementUnlocked(id: string): boolean {
        return this.data().unlockedAchievementIds.includes(id);
    }

    static getEquippedSkinId(): string {
        return this.data().equippedSkinId;
    }

    /** Caller is responsible for gating this on the achievement/ad rule first (see ShopScreen.handleEquip) — this just records the choice. */
    static equip(itemId: string): void {
        const data = this.data();
        data.equippedSkinId = itemId;
        void this.persist(data);
    }

    static isCosmeticSessionUnlocked(id: string): boolean {
        return this.sessionUnlockedCosmeticIds.has(id);
    }

    /** Call once a rewarded ad finishes for a cosmetic — lets it be re-equipped for the rest of this session with no further ad. */
    static markCosmeticSessionUnlocked(id: string): void {
        this.sessionUnlockedCosmeticIds.add(id);
    }

    /**
     * Bumps the best value ever reached and auto-unlocks any achievement
     * whose threshold is newly crossed. No-ops (no persist call) when value
     * hasn't advanced past the cached best, so calling this every frame from
     * BaseDemoScene.update() is cheap. Returns newly-unlocked ids.
     */
    static recordValueReached(value: number): string[] {
        const data = this.data();
        if (value <= data.bestValueReached) return [];
        data.bestValueReached = value;

        const newlyUnlocked: string[] = [];
        for (const item of SHOP_ITEMS) {
            if (item.kind !== 'achievement' || item.valueThreshold === undefined) continue;
            if (value >= item.valueThreshold && !data.unlockedAchievementIds.includes(item.id)) {
                data.unlockedAchievementIds.push(item.id);
                newlyUnlocked.push(item.id);
            }
        }
        void this.persist(data);
        return newlyUnlocked;
    }

    private static async persist(data: ShopSaveData): Promise<void> {
        await PlatformHandler.instance.platform.setItem(this.KEY, JSON.stringify(data));
    }

    /** Wipes unlocks/equip/best-value progress back to a fresh install — see SettingsMenu's Clear Data action. */
    static async clearAll(): Promise<void> {
        this._cachedData = this.createDefaultData();
        this.sessionUnlockedCosmeticIds.clear();
        await PlatformHandler.instance.platform.removeItem(this.KEY);
    }
}
