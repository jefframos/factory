import { CurrencyType } from "./InGameEconomy";


export interface IEntityData {
    id: string;
    type: "animal" | "egg";
    level: number;
    x: number;
    y: number;
    lastCoinTimestamp: number;
    pendingCoins: number;
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
