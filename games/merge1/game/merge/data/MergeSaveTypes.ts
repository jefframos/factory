import { CurrencyType } from "./InGameEconomy";


export interface IEntityData {
    id: string;
    type: "animal" | "egg" | "reward_container";
    level: number;
    x: number;
    y: number;
    lastCoinTimestamp: number;
    pendingCoins: number;
    rewardId?: string;       // Reference to what's inside
    rewardType?: CurrencyType;
    rewardValue?: number;
}

export interface ICoinData {
    x: number;
    y: number;
    value: number;
    ownerId: string;
    currencyType: CurrencyType;
}

export interface IMergeSaveState {
    entities: IEntityData[];
    coinsOnGround: ICoinData[];
}
