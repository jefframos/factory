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
    public showReward(prizes: PrizeItem[], coinEffectsLayer: any, hudReference: any) {
        const coinRewardData: PrizePopupData = {
            prizes: prizes,
            waitForClaim: true,
            effects: {
                layer: coinEffectsLayer,
                getHudTarget: (type: CurrencyType) => {
                    return hudReference.getCurrencyTargetGlobalPos(type);
                }
            },
            claimCallback: async () => {
                // Buffer for animation timing
                await PromiseUtils.await(750);

                prizes.forEach(element => {
                    if (element.type === CurrencyType.MONEY || element.type === CurrencyType.GEMS) {
                        InGameEconomy.instance.add(element.type, element.value);
                    }
                    // Add logic here for CurrencyType.ENTITY if needed
                });
            }
        };

        PopupManager.instance.show('prize', coinRewardData);
    }
}