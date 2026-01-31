import { Signal } from "signals";
import { InGameProgress } from "../data/InGameProgress";
import GameStorage from "../storage/GameStorage";

export class CollectionDataManager {
    private static _instance: CollectionDataManager;

    private readonly BASE_PREFIX = "cat_collection_claims_";

    // Signals
    public readonly onNotificationChanged: Signal = new Signal(); // Dispatches true/false
    public readonly onNewDiscovery: Signal = new Signal();      // Dispatches catLevel

    private _lastNotificationState: boolean = false;
    private _lastHighestLevel: number = 0;

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
    }

    private get currentKey(): string {
        return `${this.BASE_PREFIX}${GameStorage.STORAGE_KEY}`;
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
        localStorage.removeItem(this.currentKey);
        this.refreshNotificationState();
    }

    public hardWipeAllVersions(): void {
        Object.keys(localStorage)
            .filter(key => key.startsWith(this.BASE_PREFIX))
            .forEach(key => localStorage.removeItem(key));
        this.refreshNotificationState();
    }

    private getClaimData(): Record<number, boolean> {
        const raw = localStorage.getItem(this.currentKey);
        try {
            return raw ? JSON.parse(raw) : {};
        } catch (e) {
            return {};
        }
    }

    private saveClaimData(data: Record<number, boolean>) {
        localStorage.setItem(this.currentKey, JSON.stringify(data));
    }
}