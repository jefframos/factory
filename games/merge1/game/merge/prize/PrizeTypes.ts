import * as PIXI from 'pixi.js';
import { CurrencyType } from "../data/InGameEconomy";
import MergeAssets from "../MergeAssets";
import { CoinEffectLayer } from "../vfx/CoinEffectLayer";


export interface PrizeItem {
    type: CurrencyType;
    value: any;
    label?: string;
    tier: number;
    // Optional asset overrides
    customIcon?: string;
    customBg?: string;
}
export interface PrizePopupEffects {
    layer: CoinEffectLayer;
    // A function that returns the global position of the HUD target for a type
    getHudTarget: (type: CurrencyType) => PIXI.Point;
}


export interface PrizePopupData {
    prizes: PrizeItem[];
    waitForClaim?: boolean;
    autoHideTimer?: number;
    customRibbon?: string;
    multiplier?: number; // NEW: e.g., 2, 3, 5
    doubleCallback?: () => Promise<void>;
    claimCallback?: (multiplier: number) => void; // NEW: receives multiplier
    effects?: {
        layer: any;
        getHudTarget: (type: CurrencyType) => PIXI.Point;
    };
}

// Define the visual style for different tiers
export const RewardRegistry = {
    Tiers: {
        1: { bg: MergeAssets.Textures.UI.BgCommon, tint: 0xffffff },
        2: { bg: MergeAssets.Textures.UI.BgRare, tint: 0x55ff55 },
        3: { bg: MergeAssets.Textures.UI.BgEpic, tint: 0xaa55ff },
        4: { bg: MergeAssets.Textures.UI.BgLegendary, tint: 0xffaa00 },
    },
    Entities: {
        // Map entity levels/tiers to specific icons if they aren't dynamic
        //3: MergeAssets.Textures.Entities.CatTier3,
    }
};