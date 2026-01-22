import { ICoinData, IEntityData } from "../core/MergeMediator";

export interface IFarmSaveData {
    coins: number;
    entities: IEntityData[];
    coinsOnGround: ICoinData[];
}

export default class GameStorage {
    private static _instance: GameStorage;
    private readonly STORAGE_KEY: string = "farm_game_state";

    public coins: number = 0;

    public static get instance(): GameStorage {
        return this._instance || (this._instance = new GameStorage());
    }

    // New unified save method
    public saveFullState(data: IFarmSaveData): void {
        this.coins = data.coins;
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(data));
    }

    // New unified load method
    public getFullState(): IFarmSaveData | null {
        const data = localStorage.getItem(this.STORAGE_KEY);
        if (!data) return null;
        const parsed = JSON.parse(data);
        this.coins = parsed.coins || 0;
        return parsed;
    }

    public addMoney(amount: number): void {
        this.coins += amount;
        // Note: In your architecture, MergeMediator handles the save trigger
    }

    public resetGameProgress(reload: boolean = false): void {
        localStorage.removeItem(this.STORAGE_KEY);
        if (reload) window.location.reload();
    }
}