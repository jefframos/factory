// services/MergeFtueService.ts
import * as PIXI from "pixi.js";
import { ProgressionStats } from "../data/ProgressionStats";
import { BlockMergeEntity } from "../entity/BlockMergeEntity";
import { MergeEgg } from "../entity/MergeEgg";
import { MergeFTUE } from "../ui/ftue/MergeFTUE";

export interface MergeFtueServiceConfig {
    parentLayer: PIXI.Container;

    fingerTexture: PIXI.Texture;

    // MergeFTUE config
    maxPairDistancePx?: number;
    eggHoverOffsetY?: number;
    completeOnFirstMerge?: boolean;
}

/**
 * Owns MergeFTUE and the "stats-driven, gated" FTUE driver logic.
 *
 * Responsibilities:
 * - Keep MergeFTUE entity tracking fed (spawn/remove/hatch).
 * - Decide allowEgg/allowMerge from ProgressionStats + tracked counts.
 * - Disable permanently when mergesMade >= 2.
 * - Respect focus (UI open/closed).
 * - Provide cheap external hooks: markDirty(), setFocus(), update().
 */
export class MergeFtueServiceOld {
    private readonly ftue: MergeFTUE;

    public ftueEnabled: boolean = true;
    private ftueDirty: boolean = true;

    private lastAllowEgg: boolean = false;
    private lastAllowMerge: boolean = false;

    private isInFocus: boolean = true;
    private completed: boolean = false;

    public get isCompleted(): boolean {
        if (this.completed) {
            return true;
        }
        const s = ProgressionStats.instance.snapshot;
        //console.log(s)
        this.completed = s.mergesMade >= 1
        return this.completed; // keep consistent with your current hard-gate in handleFtueState()
    }

    public constructor(cfg: MergeFtueServiceConfig) {
        this.ftue = new MergeFTUE(cfg.parentLayer, {
            fingerTexture: cfg.fingerTexture,
            maxPairDistancePx: cfg.maxPairDistancePx ?? 260,
            eggHoverOffsetY: cfg.eggHoverOffsetY ?? -70,
            completeOnFirstMerge: cfg.completeOnFirstMerge ?? true
        });

        this.ftue.setFocus(true);
        this.ftue.setAllowedHints(false, false);
    }

    public dispose(): void {
        this.ftue.dispose();
    }

    // ---------------------------------
    // External hooks
    // ---------------------------------

    public markDirty(): void {
        this.ftueDirty = true;
    }

    public setFocus(inFocus: boolean): void {
        this.isInFocus = inFocus;
        this.ftue.setFocus(inFocus);
        this.ftueDirty = true;
    }

    // ---------------------------------
    // Entity feed (called by mediator)
    // ---------------------------------

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

    /**
     * Optional compatibility hook.
     * If your merge system emits an event, you can call this to allow FTUE completion effects,
     * but the gating itself is driven by ProgressionStats (mergesMade).
     */
    public onMerged(): void {
        this.ftue.onMerged();
        this.ftueDirty = true;
    }

    // ---------------------------------
    // Update
    // ---------------------------------

    public update(dtSeconds: number): void {
        // Decide allowEgg/allowMerge (stats-driven)
        this.handleFtueState();

        // If not in focus, service should keep hints off.
        if (!this.isInFocus) {
            this.ftue.setAllowedHints(false, false);
            return;
        }

        if (this.ftueEnabled) {
            this.ftue.update(dtSeconds);
        } else {
            this.ftue.setAllowedHints(false, false);
        }
    }

    // ---------------------------------
    // Driver (extracted from mediator)
    // ---------------------------------

    private handleFtueState(): void {
        if (!this.ftueDirty) {
            return;
        }

        const s = ProgressionStats.instance.snapshot;

        // Hard gate: after 2 merges, FTUE is permanently disabled.
        if (s.mergesMade >= 1) {
            if (this.ftueEnabled) {
                this.ftueEnabled = false;
                this.ftue.setAllowedHints(false, false);
            }
            this.ftueDirty = false;
            return;
        }

        const eggsExist = this.ftue.getTrackedEggCount ? (this.ftue.getTrackedEggCount() > 0) : true;
        const blocksCount = this.ftue.getTrackedBlockCount ? this.ftue.getTrackedBlockCount() : 0;

        const allowEgg = (s.eggsHatched === 0) && eggsExist;

        const allowMergePrefilter = (s.mergesMade === 0) && (blocksCount >= 2);
        const allowMerge = allowMergePrefilter && !allowEgg;

        if (allowEgg === this.lastAllowEgg && allowMerge === this.lastAllowMerge) {
            this.ftueDirty = false;
            return;
        }

        this.lastAllowEgg = allowEgg;
        this.lastAllowMerge = allowMerge;

        const anyAllowed = allowEgg || allowMerge;

        this.ftueEnabled = anyAllowed;
        this.ftue.setAllowedHints(allowEgg, allowMerge);

        this.ftueDirty = false;
    }
}
