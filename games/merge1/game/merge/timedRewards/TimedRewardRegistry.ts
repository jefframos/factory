// timedRewards/TimedRewardRegistry.ts
import * as PIXI from "pixi.js";
import MergeAssets from "../MergeAssets";
import { TimedRewardDefinition } from "./TimedRewardTypes";

export interface TimedRewardRegistryConfig {
    stepSeconds: number; // 300 = 5m, or 30 for 30s
    cycle: TimedRewardDefinition[];
}

export class TimedRewardRegistry {
    public readonly stepSeconds: number;
    private readonly cycle: TimedRewardDefinition[];

    public constructor(cfg: TimedRewardRegistryConfig) {
        this.stepSeconds = cfg.stepSeconds;
        this.cycle = cfg.cycle.slice();
    }

    public getDefinitionForMilestoneIndex(milestoneIndex: number): TimedRewardDefinition {
        const i = milestoneIndex % this.cycle.length;
        return this.cycle[i];
    }

    public static createDefault5m(): TimedRewardRegistry {
        return new TimedRewardRegistry({
            stepSeconds: 5 * 60,
            cycle: [
                { id: "money_5p_or_100", reward: { kind: "money_percent_or_min", percent: 0.05, minMoney: 100 }, icon: PIXI.Texture.from(MergeAssets.Textures.Icons.Coin) },
                { id: "money_7p5_or_250", reward: { kind: "money_percent_or_min", percent: 0.075, minMoney: 250 }, icon: PIXI.Texture.from(MergeAssets.Textures.Icons.CoinPileSmall) },
                { id: "gems_3", reward: { kind: "gems_fixed", gems: 3 }, icon: PIXI.Texture.from(MergeAssets.Textures.Icons.Gem) },
                { id: "money_10p", reward: { kind: "money_percent_or_min", percent: 0.10, minMoney: 0 }, icon: PIXI.Texture.from(MergeAssets.Textures.Icons.CoinPileLarge) },
                { id: "gems_5", reward: { kind: "gems_fixed", gems: 5 }, icon: PIXI.Texture.from(MergeAssets.Textures.Icons.GemPile) },
                { id: "spawn_high_minus_3", reward: { kind: "spawn_high_entity", offsetFromHighest: 3, minLevel: 1 }, icon: PIXI.Texture.from(MergeAssets.Textures.Icons.Gift1) },
            ]
        });
    }
}
