// missions/defaultMissions.ts
import { CurrencyType } from "../data/InGameEconomy";
import MergeAssets from "../MergeAssets";
import { MissionDefinition } from "./MissionTypes";

export const DEFAULT_MISSIONS: MissionDefinition[] = [
    {
        id: "m_tap_25",
        tier: 1,
        title: "Tap creatures 25 times",
        description: "Tap any creature on the board.",
        type: "tap_creature",
        target: 25,
        iconTextureId: MergeAssets.Textures.Icons.Finger,
        chestTextureId: MergeAssets.Textures.Icons.Check,
        reward: { currencies: { [CurrencyType.MONEY]: 100 } }
    },
    {
        id: "m_merge_10",
        tier: 1,
        title: "Merge 10 creatures",
        description: "Perform merges on the board.",
        type: "merge_creatures",
        target: 10,
        iconTextureId: MergeAssets.Textures.Icons.Check || undefined,
        chestTextureId: MergeAssets.Textures.Icons.Check,
        reward: { currencies: { [CurrencyType.GEMS]: 5 } }
    },
    {
        id: "m_reach_lvl_3",
        tier: 1,
        title: "Reach player level 3",
        type: "reach_player_level",
        target: 3,
        iconTextureId: MergeAssets.Textures.Icons.Check || undefined,
        chestTextureId: MergeAssets.Textures.Icons.Check,
        reward: { currencies: { [CurrencyType.MONEY]: 250 } }
    }
];
