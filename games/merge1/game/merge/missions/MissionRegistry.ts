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
export class MissionRewardCalculator {

    /**
     * @param missionValue A value between 0.05 and 0.2
     * @param highestPieceLevel The highest level entity the player has (1-30)
     */
    public static calculateCoinReward(missionValue: number, highestPieceLevel: number): number {
        // 1. Get the shop config for the highest piece the player can actually interact with
        // We use the same math as your ShopManager: 500 * Math.pow(2.5, i)
        const index = Math.max(0, highestPieceLevel - 1);
        const referencePrice = index === 0 ? 50 : 500 * Math.pow(2.5, index);

        // 2. Multiply by the mission weight
        const reward = referencePrice * missionValue;

        // 3. Return rounded value, ensuring a minimum of 10 coins
        return Math.max(10, Math.floor(reward));
    }

    /**
     * @param missionValue A value between 0.05 and 0.2
     * @param highestPieceLevel Player progress (1-30)
     */
    public static calculateGemReward(missionValue: number, highestPieceLevel: number): number {
        // Goals: 3 gems is "low" (early game/low mission value), 50 gems is "high" (late game/high mission value)

        // Base gems scale from 20 (level 1) to 250 (level 30)
        // This represents the "Total Pot" for a mission at that level
        const basePot = 100 + (highestPieceLevel * 7.6);

        const reward = basePot * missionValue;

        // Clamp between your requested 3 and 50
        return Math.max(3, Math.min(100, Math.floor(reward)));
    }
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
                //reward: { currencies: { [CurrencyType.GEMS]: Math.max(1, 2 + Math.floor(k / 2)) } }
                reward: { currencies: { [CurrencyType.GEMS]: getRewardPercentage(k) } }
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
                reward: { currencies: { [CurrencyType.GEMS]: getRewardPercentage(k) } }
            };
        }
    }
];


/**
 * SIMULATION HELPER
 * Prints a table showing rewards based on Mission Difficulty (k) 
 * and Player Progression (Highest Piece Level).
 */
export function simulateRewards() {
    const START_PCT = 0.05;
    const MAX_PCT = 0.20;
    const K_AT_MAX = 50;
    console.log("--- MISSION REWARD SIMULATION ---");
    console.log("K: Mission Difficulty | PCT: Reward Percentage | HPL: Highest Piece Level");
    console.log("--------------------------------------------------------------------------");

    const milestones = [1, 5, 10, 15, 20, 25, 30]; // Player Progression Levels
    const kValues = [0, 10, 25, 50]; // Mission Difficulty steps

    milestones.forEach(hpl => {
        console.log(`\n>>> AT HIGHEST PIECE LEVEL: ${hpl}`);
        let row = [];

        kValues.forEach(k => {
            const pct = START_PCT + (MAX_PCT - START_PCT) * Math.min(k / K_AT_MAX, 1);

            const coins = MissionRewardCalculator.calculateCoinReward(pct, hpl);
            const gems = MissionRewardCalculator.calculateGemReward(pct, hpl);

            console.log(
                `k=${k.toString().padEnd(2)} (${(pct * 100).toFixed(0)}%) ` +
                `| Coins: ${coins.toLocaleString().padEnd(12)} ` +
                `| Gems: ${gems}`
            );
        });
    });
}
