import PlatformHandler from 'core/platforms/PlatformHandler';

const KEY = 'TOWER_POWERUP_INVENTORY';

export type PowerupInventory = Record<string, number>;

/**
 * How many of each powerup (keyed by id — see PowerupStorage.POWERUPS, plus
 * the pseudo-id 'skip-piece' for the skip button, which isn't a real
 * PowerupDefinition) the player currently owns, persisted via
 * PlatformHandler — same load-once/cache/fire-and-forget-save shape as
 * HighScoreStorage, just storing a whole JSON object instead of one number.
 */
export class PowerupInventoryStorage {
    private static cached: PowerupInventory = {};

    /** Call once at boot, before any HUD reads counts — see MyGame.initialize() in index.ts. */
    static async load(): Promise<void> {
        try {
            const raw = await PlatformHandler.instance.platform.getItem(KEY);
            this.cached = raw ? JSON.parse(raw) : {};
        } catch (e) {
            console.error('PowerupInventoryStorage: failed to load', e);
            this.cached = {};
        }
    }

    static getCount(powerupId: string): number {
        return this.cached[powerupId] ?? 0;
    }

    /** Read-only snapshot — for the HUD to sync every button's count in one pass. */
    static getAll(): Readonly<PowerupInventory> {
        return this.cached;
    }

    /** Call whenever the player earns one — see IslandViewScene's onLevelProgressed handler. */
    static grant(powerupId: string, amount = 1): void {
        this.cached[powerupId] = this.getCount(powerupId) + amount;
        this.save();
    }

    /** Spends one if available (and persists the new count), returning whether there was one to spend — callers should only trigger the powerup's actual in-game effect when this returns true. */
    static consume(powerupId: string): boolean {
        const count = this.getCount(powerupId);

        if (count <= 0) {
            return false;
        }

        this.cached[powerupId] = count - 1;
        this.save();
        return true;
    }

    private static save(): void {
        void PlatformHandler.instance.platform.setItem(KEY, JSON.stringify(this.cached));
    }
}
