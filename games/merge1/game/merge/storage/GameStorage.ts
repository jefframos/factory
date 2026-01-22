export default class GameStorage {
    private static _instance: GameStorage;
    public coins: number = 0;
    public gridState: string[] = []; // IDs of animals on grid

    public static get instance(): GameStorage {
        return this._instance || (this._instance = new GameStorage());
    }

    public addMoney(amount: number): void {
        this.coins += amount;
        // Save to localStorage here if needed
    }
}