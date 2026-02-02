import { CurrencyType } from "../../data/InGameEconomy";
import { MissionClaimResult } from "../../missions/MissionManager";
import { ModifierManager, ModifierType } from "../../modifiers/ModifierManager";
import { PrizeItem } from "../../prize/PrizeTypes";
import { WheelPrize } from "../../spinningWheel/SpinningWheel";
import { CoinEffectLayer } from "../../vfx/CoinEffectLayer";
import { RewardManager } from "../prize/RewardManager";


export class MergeHudRewardsPresenter {
    private readonly coinEffects: CoinEffectLayer;
    private readonly vfxParent: any;

    public constructor(coinEffects: CoinEffectLayer, vfxParent: any) {
        this.coinEffects = coinEffects;
        this.vfxParent = vfxParent;
    }

    public showMissionClaim(claim: MissionClaimResult): void {
        const prizes = this.mapMissionClaimToPrizes(claim);
        if (prizes.length <= 0) {
            return;
        }

        RewardManager.instance.showReward(prizes, this.coinEffects, this.vfxParent);
    }

    public showWheelPrize(prize: WheelPrize): void {
        const prizes = this.mapWheelPrizeToPrizes(prize);
        if (prizes.length <= 0) {
            return;
        }

        RewardManager.instance.showReward(prizes, this.coinEffects, this.vfxParent);
    }

    private mapMissionClaimToPrizes(claim: MissionClaimResult): PrizeItem[] {
        const out: PrizeItem[] = [];

        const currencies = claim.rewards?.currencies;
        if (!currencies) {
            return out;
        }

        const mult = ModifierManager.instance.getNormalizedValue(ModifierType.MissionRewards);

        for (const currencyType in currencies) {
            const amount = currencies[currencyType as CurrencyType];
            if (!amount || amount <= 0) {
                continue;
            }

            out.push({
                type: currencyType as CurrencyType,
                value: Math.ceil(amount * mult),
                tier: currencyType === CurrencyType.GEMS ? 2 : 0
            });
        }

        return out;
    }

    private mapWheelPrizeToPrizes(prize: WheelPrize): PrizeItem[] {
        const value = prize.level || prize.amount;
        if (!value) {
            return [];
        }

        return [
            {
                type: prize.prizeType,
                value,
                tier: prize.prizeType === CurrencyType.GEMS ? 2 : 0
            }
        ];
    }
}
