// missions/MissionFactory.ts
import { InGameProgress } from "../data/InGameProgress";
import { ProgressionType } from "../storage/GameStorage";
import { MISSION_TEMPLATES, MissionTemplate } from "./MissionRegistry";
import { MissionDefinition } from "./MissionTypes";

export interface MissionFactoryConfig {
    nextMissionDelaySec: number;
    cadence: number[];
    fallbackTier?: number;
}

export interface MissionGenContext {
    counters: Record<string, number>;
    playerLevel: number;
    highestCreature: number;
    tierCounters: Record<number, number>;
}

export class MissionFactory {
    private readonly cfg: MissionFactoryConfig;

    public constructor(cfg: MissionFactoryConfig) {
        this.cfg = cfg;
    }

    public get nextDelaySec(): number {
        return this.cfg.nextMissionDelaySec;
    }

    public createNextMission(args: {
        counters: Record<string, number>;
        tierCycleIndex: number;
        tierCounters: Record<number, number>;
    }): { def: MissionDefinition; tierCycleIndexNext: number } {
        const main = InGameProgress.instance.getProgression(ProgressionType.MAIN);

        const ctx: MissionGenContext = {
            counters: args.counters,
            playerLevel: main.level,
            highestCreature: main.highestMergeLevel,
            tierCounters: args.tierCounters
        };

        const tier = this.pickTier(args.tierCycleIndex);
        const template = this.pickTemplateForTier(tier, ctx);

        const def = template.build(ctx);

        // Maintain tier counters (assigned count)
        args.tierCounters[tier] = (args.tierCounters[tier] || 0) + 1;

        return {
            def,
            tierCycleIndexNext: this.nextCycleIndex(args.tierCycleIndex)
        };
    }

    private pickTier(tierCycleIndex: number): number {
        const cadence = this.cfg.cadence || [];
        if (cadence.length <= 0) {
            return this.cfg.fallbackTier ?? 1;
        }

        const i = Math.max(0, tierCycleIndex) % cadence.length;
        return cadence[i];
    }

    private nextCycleIndex(current: number): number {
        const cadence = this.cfg.cadence || [];
        if (cadence.length <= 0) return 0;
        return (Math.max(0, current) + 1) % cadence.length;
    }

    private pickTemplateForTier(tier: number, ctx: MissionGenContext): MissionTemplate {
        const eligible = MISSION_TEMPLATES
            .filter(t => t.tier === tier)
            .filter(t => (t.isEligible ? t.isEligible(ctx) : true));

        if (eligible.length <= 0) {
            const fallbackTier = this.cfg.fallbackTier ?? 1;
            const eligibleFallback = MISSION_TEMPLATES
                .filter(t => t.tier === fallbackTier)
                .filter(t => (t.isEligible ? t.isEligible(ctx) : true));

            if (eligibleFallback.length <= 0) {
                throw new Error(`MissionFactory: no eligible mission templates for tier ${tier} or fallback tier ${fallbackTier}`);
            }

            return this.weightedPick(eligibleFallback);
        }

        return this.weightedPick(eligible);
    }

    private weightedPick(list: MissionTemplate[]): MissionTemplate {
        let total = 0;
        for (const t of list) total += Math.max(0, t.weight);

        let r = Math.random() * total;
        for (const t of list) {
            r -= Math.max(0, t.weight);
            if (r <= 0) return t;
        }

        return list[0];
    }
}
