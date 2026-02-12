// LevelSelectMediator.ts
import { Signal } from "signals";
import { Difficulty, GameProgress, LevelDefinition, SectionDefinition } from "../../../types";
import Assets from "../Assets";
import { InGameEconomy } from "../data/InGameEconomy";
import { ProgressCookieStore } from "../data/ProgressCookieStore";

export interface PlayLevelRequest {
    levelId: string;
    difficulty: Difficulty;
    level: LevelDefinition;
    section: SectionDefinition;
    allowRotation: boolean;
}

export interface PurchaseLevelRequest {
    levelId: string;
    level: LevelDefinition;
    section: SectionDefinition;
    cost: number;
}

export class LevelSelectMediator {
    public readonly onPlayLevel: Signal = new Signal(); // dispatch(PlayLevelRequest)
    public readonly onProgressChanged: Signal = new Signal(); // dispatch(GameProgress)
    public readonly onPurchaseLevel: Signal = new Signal();

    private readonly store: ProgressCookieStore;
    private progress: GameProgress;

    private sections: SectionDefinition[] = [];
    private levelIndex: Map<string, { level: LevelDefinition; section: SectionDefinition }> = new Map();

    public constructor(store: ProgressCookieStore) {
        this.store = store;
        this.progress = this.store.load();
    }

    public setSections(sections: SectionDefinition[]): void {
        this.sections = sections;
        this.levelIndex.clear();

        for (const s of sections) {
            for (const l of s.levels) {
                this.levelIndex.set(l.id, { level: l, section: s });
            }
        }
    }

    public getProgress(): GameProgress {
        return this.progress;
    }
    public isLevelUnlocked(levelId: string): boolean {
        const hit = this.levelIndex.get(levelId);
        if (!hit) {
            return false;
        }

        // const cost = hit.level.unlockCost ?? 0;
        // if (cost <= 0) {
        //     return true;
        // }

        return this.store.isLevelUnlocked(this.progress, levelId);
    }
    public requestPlay(levelId: string, difficulty: Difficulty): void {
        const hit = this.levelIndex.get(levelId);
        if (!hit) {
            return;
        }
        if (!this.isLevelUnlocked(levelId)) {
            return;
        }
        const req: PlayLevelRequest = {
            levelId,
            difficulty,
            level: hit.level,
            section: hit.section,
            allowRotation: true
        };

        this.onPlayLevel.dispatch(req);
    }

    public reportLevelCompleted(levelId: string, difficulty: Difficulty, timeMs: number): void {
        this.progress = this.store.markCompleted(this.progress, levelId, difficulty, timeMs);
        this.store.save(this.progress);
        this.onProgressChanged.dispatch(this.progress);
    }

    public requestPurchase(levelId: string): void {
        const hit = this.levelIndex.get(levelId);
        if (!hit || this.isLevelUnlocked(levelId)) return;


        const normalCost = hit.level.unlockCost ?? 0;
        const specialCost = (hit.level as any).specialCost ?? 0; // Assuming this exists in your level def

        // Check economy
        const economy = InGameEconomy.instance;

        if (economy.purchase(normalCost, specialCost)) {

            Assets.tryToPlaySound(Assets.Sounds.UI.Purchase)
            // Economy handles the money, Mediator handles the unlock state
            this.confirmPurchase(levelId);
        } else {
            console.log("Transaction cancelled: Insufficient funds", normalCost);
        }
    }

    public confirmPurchase(levelId: string): void {
        if (this.isLevelUnlocked(levelId)) {
            return;
        }

        // 1. REFRESH: Pull the progress from the store again.
        // This ensures we have the deducted currency from the InGameEconomy. purchase call.
        this.progress = this.store.load();

        // 2. MODIFY: Mark the level as unlocked on the fresh progress object.
        this.progress = this.store.markLevelUnlocked(this.progress, levelId);

        // 3. SAVE: Now save the object that has BOTH the new currency and the new unlock.
        this.store.save(this.progress);



        // 4. NOTIFY: Tell the UI to refresh.
        this.onProgressChanged.dispatch(this.progress);
    }
}
