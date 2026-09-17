// GameState.ts
//
// The one piece of state that has to survive a scene switch. SceneManager
// (core/scene/SceneManager.ts) fully `destroy()`s and rebuilds a scene on
// every `changeScene()` — HubScene, RunnerMinigameScene and
// SwipeMinigameScene are all thrown away and reconstructed from scratch each
// time the player crosses between them. Everything else (player position,
// world entities, UI) is fine to reset on rebuild; the collected money total
// is the one thing that needs to keep existing outside any single scene
// instance. Deliberately a plain static (not a *Storage.ts-style persisted
// class like bandit/legacy's EconomyStorage) — nothing here needs to survive
// a page reload, only a scene change.

export class GameState {
    private static money = 0;

    public static getMoney(): number {
        return GameState.money;
    }

    public static addMoney(amount: number): void {
        GameState.money += amount;
    }
}
