// MergeFTUE.ts
import * as PIXI from "pixi.js";
import { Signal } from "signals";
import { BlockMergeEntity } from "../../entity/BlockMergeEntity";
import { MergeEgg } from "../../entity/MergeEgg";
import { FingerHint } from "./FingerHint";

export type FtueState =
    | "Disabled"
    | "WaitFirstEggSpawn"
    | "HintEgg"
    | "WaitMergeablePair"
    | "HintMerge"
    | "Completed";

export interface MergeFTUEConfig {
    fingerTexture: PIXI.Texture;
    maxPairDistancePx?: number;
    eggHoverOffsetY?: number;
    completeOnFirstMerge?: boolean;
}

/**
 * IMPORTANT:
 * - This FTUE does not decide "when" it should be active. The mediator does.
 * - The mediator calls:
 *    - setAllowedHints(allowEgg, allowMerge)
 *    - setFocus(isInFocus)
 *    - onEntitySpawned/onEntityRemoved/onEggHatched
 *    - update(dt) only if enabled
 *
 * This class:
 * - Tracks eggs/blocks in sets (cheap)
 * - When allowedEggHint => points to an egg (if exists)
 * - When allowedMergeHint => points to closest mergeable pair (if exists)
 * - Egg hint has priority if both are allowed, but mediator can already enforce that.
 */
export class MergeFTUE {
    public readonly onStateChanged: Signal = new Signal(); // dispatch(state: FtueState)

    private readonly container: PIXI.Container;
    private readonly finger: FingerHint;
    private readonly cfg: Required<MergeFTUEConfig>;

    private state: FtueState = "Disabled";
    private isInFocus: boolean = true;

    private readonly trackedEggs: Set<MergeEgg> = new Set();
    private readonly trackedBlocks: Set<BlockMergeEntity> = new Set();

    private firstEgg?: MergeEgg;

    private hintFrom?: BlockMergeEntity;
    private hintTo?: BlockMergeEntity;

    // Keeping for compatibility; not used when stats-driven FTUE is enabled by mediator
    private hasMergedOnce: boolean = false;

    // caches to reduce allocations
    private readonly tmpGlobalA: PIXI.Point = new PIXI.Point();
    private readonly tmpGlobalB: PIXI.Point = new PIXI.Point();
    private readonly tmpLocalA: PIXI.Point = new PIXI.Point();
    private readonly tmpLocalB: PIXI.Point = new PIXI.Point();

    private allowEggHint: boolean = false;
    private allowMergeHint: boolean = false;

    public constructor(parentLayer: PIXI.Container, config: MergeFTUEConfig) {
        this.container = parentLayer;

        this.cfg = {
            fingerTexture: config.fingerTexture,
            maxPairDistancePx: config.maxPairDistancePx ?? 260,
            eggHoverOffsetY: config.eggHoverOffsetY ?? -70,
            completeOnFirstMerge: config.completeOnFirstMerge ?? true
        };

        this.finger = new FingerHint(this.cfg.fingerTexture);
        this.container.addChild(this.finger);

        this.finger.zIndex = 9999;
        this.container.sortableChildren = true;

        this.setStateInternal("Disabled", true);
        this.finger.hide(true);
    }

    // -------------------------
    // External controls
    // -------------------------

    public setAllowedHints(allowEgg: boolean, allowMerge: boolean): void {
        if (this.allowEggHint === allowEgg && this.allowMergeHint === allowMerge) {
            return;
        }

        this.allowEggHint = allowEgg;
        this.allowMergeHint = allowMerge;

        if (!this.allowEggHint && !this.allowMergeHint) {
            this.clearHintRefs();
            this.setStateInternal("Disabled", true);
            this.finger.hide(true);
            return;
        }

        // Re-evaluate immediately (no need to wait for update tick)
        this.refresh();
    }

    public setFocus(isInFocus: boolean): void {
        this.isInFocus = isInFocus;

        if (!this.isInFocus) {
            this.finger.hide(true);
            return;
        }

        this.refresh();
    }

    /**
     * Optional compatibility. With stats-driven gating, you typically do NOT need to call start().
     * If you do call it, it does NOT force hints on; it simply resets internal refs.
     */
    public start(): void {
        this.hasMergedOnce = false;
        this.firstEgg = undefined;
        this.hintFrom = undefined;
        this.hintTo = undefined;

        // If not allowed, remain disabled.
        if (!this.allowEggHint && !this.allowMergeHint) {
            this.setStateInternal("Disabled", true);
            this.finger.hide(true);
            return;
        }

        this.setStateInternal("WaitFirstEggSpawn", true);
        this.refresh();
    }

    public dispose(): void {
        this.finger.hide(true);
        this.container.removeChild(this.finger);
        this.trackedEggs.clear();
        this.trackedBlocks.clear();
        this.clearHintRefs();
        this.setStateInternal("Disabled", true);
    }

    // -------------------------
    // Cheap counts for mediator
    // -------------------------

    public getTrackedEggCount(): number {
        let count = 0;
        for (const e of this.trackedEggs) {
            if (e && e.parent) {
                count++;
            }
        }
        return count;
    }

    public getTrackedBlockCount(): number {
        let count = 0;
        for (const b of this.trackedBlocks) {
            if (b && b.parent) {
                count++;
            }
        }
        return count;
    }

    // -------------------------
    // Entity feed from mediator
    // -------------------------

    public onEntitySpawned(entity: any): void {
        if (entity instanceof MergeEgg) {
            this.trackedEggs.add(entity);
            if (!this.firstEgg) {
                this.firstEgg = entity;
            }
            this.refresh();
            return;
        }

        if (entity instanceof BlockMergeEntity) {
            this.trackedBlocks.add(entity);
            this.refresh();
        }
    }

    public onEntityRemoved(entity: any): void {
        if (entity instanceof MergeEgg) {
            this.trackedEggs.delete(entity);
            if (this.firstEgg === entity) {
                this.firstEgg = undefined;
            }
        }

        if (entity instanceof BlockMergeEntity) {
            this.trackedBlocks.delete(entity);

            if (this.hintFrom === entity) this.hintFrom = undefined;
            if (this.hintTo === entity) this.hintTo = undefined;
        }

        this.refresh();
    }

    public onEggHatched(egg: MergeEgg, spawned: BlockMergeEntity): void {
        this.trackedEggs.delete(egg);
        if (this.firstEgg === egg) {
            this.firstEgg = undefined;
        }

        this.trackedBlocks.add(spawned);
        this.refresh();
    }

    /**
     * Compatibility only. In stats-driven mode you typically will not call this.
     * If you do call it, we just allow completion behavior.
     */
    public onMerged(): void {
        this.hasMergedOnce = true;

        if (this.cfg.completeOnFirstMerge) {
            this.setStateInternal("Completed", true);
            this.finger.hide(true);
        } else {
            this.refresh();
        }
    }

    // -------------------------
    // Update
    // -------------------------

    public update(deltaSeconds: number): void {
        if (!this.isInFocus) {
            return;
        }

        if (!this.allowEggHint && !this.allowMergeHint) {
            // Hard off
            if (this.state !== "Disabled") {
                this.setStateInternal("Disabled", true);
            }
            this.finger.hide(true);
            return;
        }

        if (this.state === "Completed") {
            this.finger.hide(true);
            return;
        }

        // Keep it reactive even if no events fired (safe; mediator can call update only when needed)
        this.refresh();

        if (this.state === "HintEgg" && this.firstEgg && this.firstEgg.parent) {
            const base = this.getEggHoverLocal(this.firstEgg, this.cfg.eggHoverOffsetY);
            this.finger.setHoverBase(base);
        }

        if (this.state === "HintMerge" && this.hintFrom && this.hintTo && this.hintFrom.parent && this.hintTo.parent) {
            const a = this.getEntityLocal(this.hintFrom, -30);
            const b = this.getEntityLocal(this.hintTo, -30);
            this.finger.setDragTargets(a, b);
        }

        this.finger.update(deltaSeconds);
    }

    // -------------------------
    // Core decision logic
    // -------------------------

    private refresh(): void {
        if (!this.isInFocus) {
            this.finger.hide(true);
            return;
        }

        if (!this.allowEggHint && !this.allowMergeHint) {
            this.setStateInternal("Disabled", false);
            this.finger.hide(true);
            return;
        }

        if (this.state === "Completed") {
            this.finger.hide(true);
            return;
        }

        // Priority:
        // - If merge hint is allowed, try to show merge
        // - Else if egg hint is allowed, show egg
        // - Else hide
        if (this.allowMergeHint) {
            const pair = this.findBestMergeablePair();
            if (pair) {
                this.hintFrom = pair[0];
                this.hintTo = pair[1];

                this.setStateInternal("HintMerge", false);

                const lA = this.getEntityLocal(this.hintFrom, -30);
                const lB = this.getEntityLocal(this.hintTo, -30);

                const dx = lA.x - lB.x;
                const dy = lA.y - lB.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                const duration = Math.max(0.35, Math.min(0.95, dist / 600));

                this.finger.ensureDragLoop(lA, lB, duration, 0.15);
                return;
            }
        }

        if (this.allowEggHint) {
            const egg = this.pickEggForHint();
            if (egg) {
                this.firstEgg = egg;
                this.setStateInternal("HintEgg", false);

                const base = this.getEggHoverLocal(egg, this.cfg.eggHoverOffsetY);
                this.finger.ensureHover(base);
                return;
            }
        }

        // Nothing to hint right now
        this.clearHintRefs();
        this.setStateInternal("WaitFirstEggSpawn", false);
        this.finger.hide(true);
    }

    private clearHintRefs(): void {
        this.firstEgg = undefined;
        this.hintFrom = undefined;
        this.hintTo = undefined;
    }

    private setStateInternal(next: FtueState, forceDispatch: boolean): void {
        if (!forceDispatch && this.state === next) {
            return;
        }

        this.state = next;
        this.onStateChanged.dispatch(this.state);
    }

    private pickEggForHint(): MergeEgg | undefined {
        for (const egg of this.trackedEggs) {
            if (egg && egg.parent) {
                return egg;
            }
        }
        return undefined;
    }

    private getEntityLocal(ent: PIXI.DisplayObject, yOffset: number): PIXI.Point {
        ent.getGlobalPosition(this.tmpGlobalA);
        this.container.toLocal(this.tmpGlobalA, undefined, this.tmpLocalA, true);
        this.tmpLocalA.y += yOffset;
        return this.tmpLocalA.clone();
    }

    private getEggHoverLocal(egg: MergeEgg, yOffset: number): PIXI.Point {
        egg.getGlobalPosition(this.tmpGlobalA);
        this.container.toLocal(this.tmpGlobalA, undefined, this.tmpLocalA, true);
        this.tmpLocalA.y += yOffset;
        return this.tmpLocalA.clone();
    }

    private findBestMergeablePair(): [BlockMergeEntity, BlockMergeEntity] | null {
        const byLevel: Map<number, BlockMergeEntity[]> = new Map();

        this.trackedBlocks.forEach((b) => {
            if (!b.parent) {
                return;
            }

            const arr = byLevel.get(b.level) ?? [];
            arr.push(b);
            byLevel.set(b.level, arr);
        });

        const maxD2 = this.cfg.maxPairDistancePx * this.cfg.maxPairDistancePx;

        let bestA: BlockMergeEntity | null = null;
        let bestB: BlockMergeEntity | null = null;
        let bestD2: number = Number.POSITIVE_INFINITY;

        byLevel.forEach((arr) => {
            if (arr.length < 2) {
                return;
            }

            for (let i = 0; i < arr.length; i++) {
                const a = arr[i];
                a.getGlobalPosition(this.tmpGlobalA);

                for (let j = i + 1; j < arr.length; j++) {
                    const b = arr[j];
                    b.getGlobalPosition(this.tmpGlobalB);

                    const dx = this.tmpGlobalA.x - this.tmpGlobalB.x;
                    const dy = this.tmpGlobalA.y - this.tmpGlobalB.y;
                    const d2 = dx * dx + dy * dy;

                    if (d2 > maxD2) {
                        continue;
                    }

                    if (d2 < bestD2) {
                        bestD2 = d2;
                        bestA = a;
                        bestB = b;
                    }
                }
            }
        });

        if (!bestA || !bestB) {
            return null;
        }

        return [bestA, bestB];
    }
}
