// missions/MissionRegistry.ts
import { CurrencyType } from "../data/InGameEconomy";
import { MissionGenContext } from "./MissionFactory";
import { MissionDefinition } from "./MissionTypes";

/**
 * Template interface: easy to add new missions.
 */
export interface MissionTemplate {
    templateId: string;
    tier: number;
    weight: number;

    isEligible?: (ctx: MissionGenContext) => boolean;
    build: (ctx: MissionGenContext) => MissionDefinition;
}

function nextK(ctx: MissionGenContext, key: string): number {
    const k = ctx.counters[key] || 0;
    ctx.counters[key] = k + 1;
    return k;
}

/**
 * Default mission set.
 * Cadence decides which tier is selected next.
 */
export const MISSION_TEMPLATES: MissionTemplate[] = [
    // -------- Tier 1 (baseline-based) --------

    {
        templateId: "t1_merge",
        tier: 1,
        weight: 4,
        build: (ctx) => {
            const k = nextK(ctx, "t1_merge");
            const target = 6 + 2 * k;

            return {
                id: `m_merge_${target}_${k}`,
                tier: 1,
                title: `Merge ${target} creatures`,
                type: "merge_creatures",
                target,
                reward: { currencies: { [CurrencyType.GEMS]: Math.max(1, 2 + Math.floor(k / 2)) } }
            };
        }
    },
    {
        templateId: "t1_tap",
        tier: 1,
        weight: 4,
        build: (ctx) => {
            const k = nextK(ctx, "t1_tap");
            const target = 25 + 5 * k;

            return {
                id: `m_tap_${target}_${k}`,
                tier: 1,
                title: `Tap creatures ${target} times`,
                type: "tap_creature",
                target,
                reward: { currencies: { [CurrencyType.MONEY]: 100 + 25 * k } }
            };
        }
    },
    {
        templateId: "t1_hatch",
        tier: 1,
        weight: 3,
        build: (ctx) => {
            const k = nextK(ctx, "t1_hatch");
            const target = 3 + 1 * k;

            return {
                id: `m_hatch_${target}_${k}`,
                tier: 1,
                title: `Hatch ${target} eggs`,
                type: "hatch_eggs",
                target,
                reward: { currencies: { [CurrencyType.MONEY]: 120 + 30 * k } }
            };
        }
    },
    {
        templateId: "t1_collect_money",
        tier: 1,
        weight: 3,
        build: (ctx) => {
            const k = nextK(ctx, "t1_collect_money");
            const target = 150 + 50 * k;

            return {
                id: `m_collect_money_${target}_${k}`,
                tier: 1,
                title: `Collect ${target} coins`,
                type: "collect_currency",
                currencyType: CurrencyType.MONEY,
                target,
                reward: { currencies: { [CurrencyType.MONEY]: 80 + 20 * k } }
            };
        }
    },

    // -------- Tier 2 (absolute) --------

    {
        templateId: "t2_reach_player_level",
        tier: 2,
        weight: 1,
        build: (ctx) => {
            const target = ctx.playerLevel + 1;

            return {
                id: `m_t2_plvl_${target}_${Date.now()}`,
                tier: 2,
                title: `Reach player level ${target}`,
                type: "reach_player_level",
                target,
                reward: { currencies: { [CurrencyType.GEMS]: 5 } }
            };
        }
    },
    {
        templateId: "t2_reach_creature_level",
        tier: 2,
        weight: 1,
        isEligible: (ctx) => ctx.highestCreature >= 1,
        build: (ctx) => {
            const target = Math.max(1, ctx.highestCreature + 1);

            return {
                id: `m_t2_clvl_${target}_${Date.now()}`,
                tier: 2,
                title: `Get a level ${target} creature`,
                type: "reach_creature_level",
                target,
                reward: { currencies: { [CurrencyType.GEMS]: 6 } }
            };
        }
    }
];
