import { CurrencyType } from "../data/InGameEconomy";
import MergeAssets from "../MergeAssets";
import { MissionGenContext } from "./MissionFactory";
import { MissionDefinition } from "./MissionTypes";

/**
 * REWARD PERCENTAGE CONFIGURATION
 */
const START_PCT = 0.05; // 5%
const MAX_PCT = 0.20;   // 20%
const K_AT_MAX = 50;    // Mission 'k' level where percentage hits the cap

/**
 * Returns the percentage value (0.05 to 0.20) based on mission difficulty k.
 * This is intended to be multiplied by player currency elsewhere in the engine.
 */
const getRewardPercentage = (k: number): number => {
    const progress = Math.min(k / K_AT_MAX, 1);
    return START_PCT + (MAX_PCT - START_PCT) * progress;
};

export interface MissionTemplate {
    templateId: string;
    tier: number;
    weight: number;
    isEligible?: (ctx: MissionGenContext) => boolean;
    build: (ctx: MissionGenContext, k: number) => MissionDefinition;
}

export const MISSION_TEMPLATES: MissionTemplate[] = [
    {
        templateId: "t1_merge",
        tier: 1,
        weight: 4,
        build: (ctx, k) => {
            const target = 6 + 2 * k;
            return {
                id: `m_merge_${k}`,
                templateId: "t1_merge",
                k,
                tier: 1,
                iconTextureId: `ENTITY_${1}`,
                chestTextureId: MergeAssets.Textures.Icons.Coin,
                title: `Merge ${target} cats`,
                type: "merge_creatures",
                target,
                // Gems remain fixed/flat
                reward: { currencies: { [CurrencyType.GEMS]: Math.max(1, 2 + Math.floor(k / 2)) } }
            };
        }
    },
    {
        templateId: "t1_tap",
        tier: 1,
        weight: 4,
        build: (ctx, k) => {
            const target = 25 + 5 * k;
            return {
                id: `m_tap_${k}`,
                templateId: "t1_tap",
                k,
                tier: 1,
                iconTextureId: MergeAssets.Textures.Icons.Finger,
                chestTextureId: MergeAssets.Textures.Icons.Coin,
                title: `Tap cats ${target} times`,
                type: "tap_creature",
                target,
                reward: {
                    currencies: {
                        [CurrencyType.MONEY]: getRewardPercentage(k)
                    }
                }
            };
        }
    },
    {
        templateId: "t1_hatch",
        tier: 1,
        weight: 3,
        build: (ctx, k) => {
            const target = 3 + 1 * k;
            return {
                id: `m_hatch_${k}`,
                templateId: "t1_hatch",
                k,
                tier: 1,
                iconTextureId: MergeAssets.Textures.Icons.Gift2,
                chestTextureId: MergeAssets.Textures.Icons.Coin,
                title: `Rescue ${target} cats`,
                type: "hatch_eggs",
                target,
                reward: {
                    currencies: {
                        [CurrencyType.MONEY]: getRewardPercentage(k)
                    }
                }
            };
        }
    },
    {
        templateId: "t2_reach_player_level",
        tier: 2,
        weight: 1,
        build: (ctx, k) => {
            const target = ctx.playerLevel + 1;
            return {
                id: `m_t2_plvl_${target}`,
                templateId: "t2_reach_player_level",
                k,
                tier: 2,
                iconTextureId: MergeAssets.Textures.Icons.BadgeMain,
                chestTextureId: MergeAssets.Textures.Icons.Coin,
                title: `Reach player level ${target}`,
                type: "reach_player_level",
                target,
                reward: { currencies: { [CurrencyType.GEMS]: 5 } }
            };
        }
    }
];