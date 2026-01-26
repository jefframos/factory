import * as PIXI from "pixi.js";

export interface TimedRewardDefinition {
    id: string;
    reward: any; // Keep your existing reward structure
    icon?: PIXI.Texture; // Optional override
}
export type TimedRewardKind =
    | "money_percent_or_min"
    | "gems_fixed"
    | "combo"
    | "spawn_high_entity";

export interface MoneyPercentOrMinReward {
    kind: "money_percent_or_min";
    percent: number;
    minMoney: number;
}

export interface GemsFixedReward {
    kind: "gems_fixed";
    gems: number;
}

export interface ComboReward {
    kind: "combo";
    moneyPercent?: number;
    moneyMin?: number;
    gems?: number;
}

export interface SpawnHighEntityReward {
    kind: "spawn_high_entity";
    offsetFromHighest: number;
    minLevel: number;
}

export type TimedReward =
    | MoneyPercentOrMinReward
    | GemsFixedReward
    | ComboReward
    | SpawnHighEntityReward;

export interface TimedRewardDefinition {
    id: string;
    reward: TimedReward;
}

export interface TimedRewardMilestone {
    milestoneIndex: number;      // 0..N
    milestoneSeconds: number;    // (milestoneIndex+1) * stepSeconds
    definition: TimedRewardDefinition;
}

export interface TimedRewardContext {
    getMoney(): number;
    addMoney(amount: number): void;

    getGems(): number;
    addGems(amount: number): void;

    getHighestEntityLevel(): number;
    spawnEntityAtLevel(level: number): boolean;
}

export interface TimedRewardClaimResult {
    milestoneIndex: number;
    milestoneSeconds: number;
    definitionId: string;

    moneyAdded: number;
    gemsAdded: number;

    spawnedEntityLevel?: number;
}
