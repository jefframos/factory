// missions/MissionTypes.ts
import { CurrencyType } from "../data/InGameEconomy";

export type MissionType =
    | "tap_creature"
    | "merge_creatures"
    | "hatch_eggs"          // NEW
    | "reach_player_level"
    | "reach_creature_level"
    | "collect_currency";


export interface MissionReward {
    currencies?: Partial<Record<CurrencyType, number>>;
    items?: Array<{ itemId: string; amount: number }>; // future-proof
}

export interface MissionDefinition {
    id: string;
    tier: number;

    title: string;
    description?: string;

    type: MissionType;
    target: number;

    // For collect_currency:
    currencyType?: CurrencyType;

    // Optional UI:
    iconTextureId?: string;     // mission icon
    chestTextureId?: string;    // claim chest icon override

    reward: MissionReward;
}
