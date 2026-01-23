export enum ProgressionType {
    MAIN = "MAIN",
    SEASONAL = "SEASONAL",
    RANKED = "RANKED"
}

export interface IProgressionData {
    level: number;
    xp: number;
    highestMergeLevel: number;
}

export interface IFarmSaveData {
    progressions: Record<string, IProgressionData>; // Map of different progressions
    currencies: Record<string, number>;
    entities: any[];
    coinsOnGround: any[];
}

export default class GameStorage {
    private static _instance: GameStorage;
    private readonly STORAGE_KEY: string = "farm_game_state_";

    public static get instance(): GameStorage {
        return this._instance || (this._instance = new GameStorage());
    }

    public saveFullState(data: IFarmSaveData): void {
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(data));
    }

    public getFullState(): IFarmSaveData | null {
        const data = localStorage.getItem(this.STORAGE_KEY);
        if (!data) return null;
        return JSON.parse(data);
    }

    public resetGameProgress(reload: boolean = false): void {
        localStorage.removeItem(this.STORAGE_KEY);
        if (reload) window.location.reload();
    }
}