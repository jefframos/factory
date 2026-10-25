// GameState.ts
//
// The one piece of state that has to survive a scene switch. SceneManager
// (core/scene/SceneManager.ts) fully `destroy()`s and rebuilds a scene on
// every `changeScene()` — HubScene, RunnerMinigameScene and
// SwipeMinigameScene are all thrown away and reconstructed from scratch each
// time the player crosses between them. Everything else (player position,
// world entities, UI) is fine to reset on rebuild; the collected money total
// is the one thing that needs to keep existing outside any single scene
// instance. The total is also saved to localStorage so shop purchases survive a reload.

const MONEY_KEY = 'bandit-controller.money';

export class GameState {
    private static money = Math.max(0, Math.floor(Number(window.localStorage.getItem(MONEY_KEY)) || 0));

    public static getMoney(): number {
        return GameState.money;
    }

    public static addMoney(amount: number): void {
        GameState.money += amount;
        window.localStorage.setItem(MONEY_KEY, String(GameState.money));
    }

    /** Spends `amount` when affordable; returns whether it did. */
    public static spendMoney(amount: number): boolean {
        if (amount > GameState.money) {
            return false;
        }
        GameState.addMoney(-amount);
        return true;
    }
}
