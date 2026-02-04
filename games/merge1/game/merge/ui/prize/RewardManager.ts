import PlatformHandler from "@core/platforms/PlatformHandler";
import { PopupManager } from "@core/popup/PopupManager";
import PromiseUtils from "@core/utils/PromiseUtils";
import { CurrencyType, InGameEconomy } from "../../data/InGameEconomy";
import { PrizeItem, PrizePopupData } from "../../prize/PrizeTypes";

export class RewardManager {
    private static _instance: RewardManager;
    public static get instance(): RewardManager {
        if (!this._instance) this._instance = new RewardManager();
        return this._instance;
    }

    /**
     * Standard method to trigger the prize popup and update economy
     */
    public showReward(prizes: PrizeItem[], coinEffectsLayer: any, hudReference: any, multiplier: number = 0) {
        const coinRewardData: PrizePopupData = {
            prizes: prizes,
            waitForClaim: true,
            multiplier: multiplier, // Pass multiplier (0 = no video button)

            doubleCallback: async () => {
                await PlatformHandler.instance.platform.showRewardedVideo();
                await PromiseUtils.await(750);
                // Video watched - popup will handle multiplier animation
            },

            effects: {
                layer: coinEffectsLayer,
                getHudTarget: (type: CurrencyType) => {
                    return hudReference.getCurrencyTargetGlobalPos(type);
                }
            },

            claimCallback: async (appliedMultiplier: number) => {
                // Buffer for animation timing
                await PromiseUtils.await(750);

                prizes.forEach(element => {
                    if (element.type === CurrencyType.MONEY || element.type === CurrencyType.GEMS) {
                        const finalValue = Math.ceil(element.value * appliedMultiplier);
                        InGameEconomy.instance.add(element.type, finalValue);
                    }
                    // Add logic here for CurrencyType.ENTITY if needed
                });
            }
        };

        PopupManager.instance.show('prize', coinRewardData);
    }
}