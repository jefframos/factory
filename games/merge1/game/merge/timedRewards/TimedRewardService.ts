// timedRewards/TimedRewardService.ts
import { Signal } from "signals";
import { TimedRewardRegistry } from "./TimedRewardRegistry";
import {
    TimedRewardClaimResult,
    TimedRewardContext,
    TimedRewardMilestone
} from "./TimedRewardTypes";

export interface TimedRewardServiceConfig {
    registry: TimedRewardRegistry;
    context: TimedRewardContext;
    visibleWindowSize?: number; // must be 3 for your UI
}

export class TimedRewardService {
    public readonly onChanged: Signal = new Signal(); // dispatch()
    public readonly onRewardClaimed: Signal = new Signal(); // dispatch(result: TimedRewardClaimResult)

    private readonly registry: TimedRewardRegistry;
    private readonly ctx: TimedRewardContext;
    private readonly windowSize: number;

    private elapsedSec: number = 0;

    // next milestone to be claimed (auto-claim in order)
    private claimIndex: number = 0;

    // window start index (controls displayed 3 prizes and bar span)
    private windowStartIndex: number = 0;

    public autoClaim: boolean = true

    public constructor(cfg: TimedRewardServiceConfig) {
        this.registry = cfg.registry;
        this.ctx = cfg.context;
        this.windowSize = cfg.visibleWindowSize ?? 3;
    }

    // timedRewards/TimedRewardService.ts

    public update(dtSeconds: number): void {
        if (dtSeconds <= 0) return;

        this.elapsedSec += dtSeconds;

        let claimedAny = false;
        while (this.isClaimReady()) {
            const ok = this.tryAutoClaimOne();
            if (!ok) break;
            claimedAny = true;
        }

        if (claimedAny) {
            this.recomputeWindowStartAfterClaims();

            // OPTIONAL: If you want the timer to physically reset to 0 
            // after the final reward in the registry cycle:
            /*
            const cycleDuration = this.registry.getCycleTotalSeconds(); 
            if (this.elapsedSec >= cycleDuration && this.allRewardsInCycleClaimed()) {
                 this.elapsedSec -= cycleDuration;
                 this.claimIndex = 0;
                 this.windowStartIndex = 0;
            }
            */
        }

        this.onChanged.dispatch();
    }

    public getElapsedSeconds(): number {
        return this.elapsedSec;
    }

    public getClaimIndex(): number {
        return this.claimIndex;
    }

    // -------- Window / UI model --------

    public getVisibleMilestones(): TimedRewardMilestone[] {
        const arr: TimedRewardMilestone[] = [];
        for (let i = 0; i < this.windowSize; i++) {
            arr.push(this.buildMilestone(this.windowStartIndex + i));
        }
        return arr;
    }

    /**
     * Bar range:
     * - start = (firstVisible - step)
     * - end = (thirdVisible)
     *
     * This makes the first prize appear at ~1/3 of the bar, matching your requirement:
     * “it must fill until reach where the 5”.
     */
    public getBarRangeSeconds(): { startSec: number; endSec: number } {
        const step = this.registry.stepSeconds;

        const first = this.buildMilestone(this.windowStartIndex).milestoneSeconds;
        const third = this.buildMilestone(this.windowStartIndex + 2).milestoneSeconds;

        const startSec = Math.max(0, first - step);
        const endSec = Math.max(startSec + 1, third);

        return { startSec, endSec };
    }

    public getBarProgress01(): number {
        const r = this.getBarRangeSeconds();
        const denom = (r.endSec - r.startSec);
        if (denom <= 0) {
            return 1;
        }
        return Math.max(0, Math.min(1, (this.elapsedSec - r.startSec) / denom));
    }

    public getMilestonePos01(milestoneSeconds: number): number {
        const r = this.getBarRangeSeconds();
        const denom = (r.endSec - r.startSec);
        if (denom <= 0) {
            return 1;
        }
        return Math.max(0, Math.min(1, (milestoneSeconds - r.startSec) / denom));
    }

    public getNextClaimRemainingSec(): number {
        const target = this.buildMilestone(this.claimIndex).milestoneSeconds;
        return Math.max(0, target - this.elapsedSec);
    }

    public getTotalTimer(): number {
        return Math.max(0, this.elapsedSec);
    }

    public isMilestoneClaimed(milestoneIndex: number): boolean {
        return milestoneIndex < this.claimIndex;
    }

    // -------- Auto-claim logic --------

    private isClaimReady(): boolean {
        const m = this.buildMilestone(this.claimIndex);
        // If elapsedSec is 300 and milestone is 300, it should claim.
        return this.elapsedSec >= m.milestoneSeconds;
    }

    private tryAutoClaimOne(): boolean {
        const m = this.buildMilestone(this.claimIndex);

        const exec = this.executeReward(m);
        if (!exec.ok) {
            return false;
        }


        // Advance the index. Because buildMilestone uses (index + 1) * step,
        // this naturally moves the 'target time' for the next reward forward.
        this.claimIndex++;

        this.onRewardClaimed.dispatch(exec.result, m);
        return true;
    }

    /**
     * Ensures that as soon as the 3rd prize in the current window is claimed,
     * the window slides forward.
     */
    private recomputeWindowStartAfterClaims(): void {
        // If the claimIndex has passed the 3rd slot (windowStartIndex + 2),
        // slide the window so that the 3rd slot is now the 2nd slot.
        while (this.claimIndex > (this.windowStartIndex + 2)) {
            this.windowStartIndex++;
        }
    }

    // -------- Internal helpers --------
    private buildMilestone(milestoneIndex: number): TimedRewardMilestone {
        // Use the registry's new logic to determine the time
        const sec = this.registry.getSecondsForMilestone(milestoneIndex);

        return {
            milestoneIndex,
            milestoneSeconds: sec,
            definition: this.registry.getDefinitionForMilestoneIndex(milestoneIndex)
        };
    }
    private buildMilestone2(milestoneIndex: number): TimedRewardMilestone {
        const sec = (milestoneIndex + 1) * this.registry.stepSeconds;
        return {
            milestoneIndex,
            milestoneSeconds: sec,
            definition: this.registry.getDefinitionForMilestoneIndex(milestoneIndex)
        };
    }

    private executeReward(m: TimedRewardMilestone): { ok: boolean; result: TimedRewardClaimResult } {
        let moneyAdded = 0;
        let gemsAdded = 0;
        let spawnedEntityLevel: number | undefined;

        const reward = m.definition.reward;

        switch (reward.kind) {
            case "money_percent_or_min":
                {
                    const money = this.ctx.getMoney();
                    const raw = Math.floor(money * reward.percent);
                    moneyAdded = Math.max(reward.minMoney, raw);
                    if (moneyAdded > 0 && this.autoClaim) {
                        this.ctx.addMoney(moneyAdded);
                    }
                    break;
                }

            case "gems_fixed":
                {
                    gemsAdded = Math.max(0, reward.gems);
                    if (gemsAdded > 0 && this.autoClaim) {
                        this.ctx.addGems(gemsAdded);
                    }
                    break;
                }

            case "combo":
                {
                    const money = this.ctx.getMoney();
                    const pct = reward.moneyPercent ?? 0;
                    const min = reward.moneyMin ?? 0;

                    const raw = Math.floor(money * pct);
                    moneyAdded = Math.max(min, raw);
                    if (moneyAdded > 0 && this.autoClaim) {
                        this.ctx.addMoney(moneyAdded);
                    }

                    gemsAdded = Math.max(0, reward.gems ?? 0);
                    if (gemsAdded > 0 && this.autoClaim) {
                        this.ctx.addGems(gemsAdded);
                    }
                    break;
                }

            case "spawn_high_entity":
                {
                    const highest = this.ctx.getHighestEntityLevel();
                    const level = Math.max(reward.minLevel, highest - reward.offsetFromHighest);

                    const ok = this.ctx.spawnEntityAtLevel(level);
                    if (!ok) {
                        // cannot claim now; retry later
                        return {
                            ok: false,
                            result: {
                                milestoneIndex: m.milestoneIndex,
                                milestoneSeconds: m.milestoneSeconds,
                                definitionId: m.definition.id,
                                moneyAdded: 0,
                                gemsAdded: 0
                            }
                        };
                    }

                    spawnedEntityLevel = level;
                    break;
                }
        }

        return {
            ok: true,
            result: {
                milestoneIndex: m.milestoneIndex,
                milestoneSeconds: m.milestoneSeconds,
                definitionId: m.definition.id,
                moneyAdded,
                gemsAdded,
                spawnedEntityLevel
            }
        };
    }
}
