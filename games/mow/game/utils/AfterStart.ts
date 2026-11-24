// AfterStart.ts
//
// What can wait until the game is up: the loading screen waits only for what the first seconds need (the player, the
// town round them), and everything else a scene builds early (the farm's goods, the other people, the shops' animals and
// plots, the tractor) asks for its models after this, so it doesn't compete with the first download. Opened once, by
// index.ts, as the loading screen goes.

let open!: () => void;
const gate = new Promise<void>((resolve) => (open = resolve));

/** Resolves once the game is up (at once afterwards). */
export const afterStart = (): Promise<void> => gate;

/** The game is up: what waited starts loading. */
export const markStarted = (): void => open();
