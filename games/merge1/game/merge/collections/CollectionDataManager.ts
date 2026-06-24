import { Signal } from "signals";
import { InGameProgress } from "../data/InGameProgress";
import GameStorage from "../storage/GameStorage";
import PlatformHandler from "core/platforms/PlatformHandler";

export class CollectionDataManager {
    private static _instance: CollectionDataManager;

    private readonly BASE_PREFIX = "cat_collection_claims_";

    // Signals
    public readonly onNotificationChanged: Signal = new Signal(); // Dispatches true/false
    public readonly onNewDiscovery: Signal = new Signal();      // Dispatches catLevel

    private _lastNotificationState: boolean = false;
    private _lastHighestLevel: number = 0;
    private _claimData: Record<number, boolean> = {};
    private _isHydrated = false;
    private _hydrationPromise: Promise<void> | null = null;
    private _writeQueue: Promise<void> = Promise.resolve();

    public static get instance(): CollectionDataManager {
        return this._instance || (this._instance = new CollectionDataManager());
    }

    private constructor() {
        const prog = InGameProgress.instance.getProgression('MAIN');
        this._lastHighestLevel = prog ? prog.highestMergeLevel : 0;

        // Listen to progress to check for new discoveries
        InGameProgress.instance.onMaxEntitiesChanged.add(() => this.checkDiscoveryUpdate());

        // Initial check for notifications
        this.refreshNotificationState();
        void this.ensureHydrated();
    }

    private get currentKey(): string {
        return `${this.BASE_PREFIX}${GameStorage.STORAGE_KEY}`;
    }

    private async ensureHydrated(): Promise<void> {
        if (this._isHydrated) {
            return;
        }

        if (!this._hydrationPromise) {
            this._hydrationPromise = this.hydrateFromPlatform();
        }

        await this._hydrationPromise;
    }

    private async hydrateFromPlatform(): Promise<void> {
        try {
            const raw = await PlatformHandler.instance.platform.getItem(this.currentKey);
            this._claimData = raw ? JSON.parse(raw) : {};
        } catch (e) {
            console.error("CollectionDataManager: Failed to hydrate claim data", e);
            this._claimData = {};
        } finally {
            this._isHydrated = true;
            this._hydrationPromise = null;
            this.refreshNotificationState();
        }
    }

    /**
     * Checks if the highest merge level has increased since last check
     */
    private checkDiscoveryUpdate(): void {
        const currentHighest = InGameProgress.instance.getProgression('MAIN').highestMergeLevel;

        if (currentHighest > this._lastHighestLevel) {
            this._lastHighestLevel = currentHighest;
            this.onNewDiscovery.dispatch(currentHighest);
            this.onNotificationChanged.dispatch(currentHighest);
            this.refreshNotificationState();
        }
    }

    public isDiscovered(catLevel: number): boolean {
        const progression = InGameProgress.instance.getProgression('MAIN');
        if (!progression) return false;
        return catLevel <= progression.highestMergeLevel;
    }

    public isClaimed(catLevel: number): boolean {
        const data = this.getClaimData();
        return !!data[catLevel];
    }

    /**
     * Returns true if there is at least one discovered cat that hasn't been claimed.
     */
    public hasUnclaimedRewards(): boolean {
        const highestLevel = InGameProgress.instance.getProgression('MAIN').highestMergeLevel;
        const claimData = this.getClaimData();

        for (let level = 1; level <= highestLevel; level++) {
            if (!claimData[level]) {
                return true;
            }
        }
        return false;
    }

    public claim(catLevel: number): number {
        const data = this.getClaimData();

        if (this.isDiscovered(catLevel) && !this.isClaimed(catLevel)) {
            data[catLevel] = true;
            this.saveClaimData(data);

            this.refreshNotificationState();
            return 1; // Reward: 1 Gem
        }

        return 0;
    }

    public refreshNotificationState(): void {
        const currentState = this.hasUnclaimedRewards();
        if (currentState !== this._lastNotificationState) {
            this._lastNotificationState = currentState;
            this.onNotificationChanged.dispatch(currentState);
        }
    }

    /**
     * Storage Logic
     */
    public wipeCollectionData(): void {
        this._claimData = {};
        this._writeQueue = this._writeQueue
            .then(async () => {
                await PlatformHandler.instance.platform.removeItem(this.currentKey);
            })
            .catch((e) => {
                console.error("CollectionDataManager: Failed to wipe collection data", e);
            });
        this.refreshNotificationState();
    }

    public hardWipeAllVersions(): void {
        // Platform storage API is key-based, so remove the active key used by this build.
        this.wipeCollectionData();
        this.refreshNotificationState();
    }

    private getClaimData(): Record<number, boolean> {
        if (!this._isHydrated) {
            void this.ensureHydrated();
        }
        return this._claimData;
    }

    private saveClaimData(data: Record<number, boolean>) {
        this._claimData = { ...data };
        const serialized = JSON.stringify(this._claimData);
        this._writeQueue = this._writeQueue
            .then(async () => {
                await PlatformHandler.instance.platform.setItem(this.currentKey, serialized);
            })
            .catch((e) => {
                console.error("CollectionDataManager: Failed to save claim data", e);
            });
    }
}