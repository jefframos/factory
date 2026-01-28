import * as PIXI from "pixi.js";
import { Signal } from "signals";
import { ProgressionStats } from "../data/ProgressionStats";
import { BlockMergeEntity } from "../entity/BlockMergeEntity";
import { MergeEgg } from "../entity/MergeEgg";
import { MergeFTUE } from "../ui/ftue/MergeFTUE";

export interface MergeFtueServiceConfig {
    parentLayer: PIXI.Container;
    fingerTexture: PIXI.Texture;
    maxPairDistancePx?: number;
    eggHoverOffsetY?: number;
}

export class MergeFtueService {
    private readonly ftue: MergeFTUE;

    public ftueEnabled: boolean = true;
    private ftueDirty: boolean = true;

    private isInFocus: boolean = true;
    private completed: boolean = false;

    // Signals for the Mediator to listen to
    public readonly onStarted = new Signal();
    public readonly onCompleted = new Signal();

    private startedEmitted: boolean = false;

    public get isCompleted(): boolean {
        if (this.completed) return true;
        const s = ProgressionStats.instance.snapshot;
        // Logic: Finish after 2 merges (Level 1 -> 2, Level 2 -> 3)
        this.completed = s.mergesMade >= 2;
        return this.completed;
    }

    public constructor(cfg: MergeFtueServiceConfig) {
        this.ftue = new MergeFTUE(cfg.parentLayer, {
            fingerTexture: cfg.fingerTexture,
            maxPairDistancePx: cfg.maxPairDistancePx ?? 260,
            eggHoverOffsetY: cfg.eggHoverOffsetY ?? -70,
            completeOnFirstMerge: false // We want to handle completion manually after 2 merges
        });

        this.ftue.setFocus(true);
        // Start by allowing only merges (skipping eggs)
        this.ftue.setAllowedHints(false, true);
    }

    public markDirty(): void {
        this.ftueDirty = true;
    }

    public setFocus(inFocus: boolean): void {
        this.isInFocus = inFocus;
        this.ftue.setFocus(inFocus);
        this.ftueDirty = true;
    }

    public onEntitySpawned(view: any): void {
        this.ftue.onEntitySpawned(view);
        this.ftueDirty = true;
    }

    public onEntityRemoved(view: any): void {
        this.ftue.onEntityRemoved(view);
        this.ftueDirty = true;
    }

    public onEggHatched(egg: MergeEgg, spawned: BlockMergeEntity): void {
        this.ftue.onEggHatched(egg, spawned);
        this.ftueDirty = true;
    }

    public onMerged(): void {
        this.ftue.onMerged();
        this.ftueDirty = true;
    }

    public update(dtSeconds: number): void {
        this.handleFtueState();

        if (!this.isInFocus) {
            this.ftue.setAllowedHints(false, false);
            return;
        }

        if (this.ftueEnabled) {
            if (!this.startedEmitted) {
                this.onStarted.dispatch();
                this.startedEmitted = true;
            }
            this.ftue.update(dtSeconds);
        } else {
            this.ftue.setAllowedHints(false, false);
        }
    }

    private handleFtueState(): void {
        if (!this.ftueDirty) return;

        const s = ProgressionStats.instance.snapshot;

        // Sequence: 
        // 1. MergesMade 0 -> Show Lvl 1 merge hint
        // 2. MergesMade 1 -> Show Lvl 2 merge hint
        // 3. MergesMade 2 -> Done
        if (s.mergesMade >= 2) {
            if (this.ftueEnabled) {
                this.ftueEnabled = false;
                this.ftue.setAllowedHints(false, false);
                this.onCompleted.dispatch();
            }
            this.ftueDirty = false;
            return;
        }

        const blocksCount = this.ftue.getTrackedBlockCount ? this.ftue.getTrackedBlockCount() : 0;

        // We only enable hints if we have enough blocks to actually perform the merge
        const canMerge = blocksCount >= 2;

        this.ftueEnabled = true;
        this.ftue.setAllowedHints(false, canMerge);
        this.ftueDirty = false;
    }
}