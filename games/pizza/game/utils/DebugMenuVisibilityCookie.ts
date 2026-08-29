// DebugMenuVisibilityCookie.ts
//
// Persists whether InGameButtonList's own testing-button stack (Top-Down
// View, Clear Data, Open Next Zone, Add 100 Money, ... — see PizzaScene.ts's
// own registerButton() calls) is expanded or collapsed — a plain
// document.cookie, same mechanism (and file-neighbor) as DebugPhysicsCookie.ts,
// rather than PlatformHandler (the *Storage.ts convention every gameplay
// value in this game persists through): this is a local dev/testing toggle,
// read synchronously once at module load, with no boot-sequence await
// needed the way BackpackStorage/ShopUpgradeStorage/etc. require.
//
// Collapsed (false) is the default the FIRST time a browser ever loads this
// game — these are testing tools, not something that belongs in a player's
// face out of the box. InGameButtonList keeps its own small toggle button
// always on screen (see that file's own doc) so expanding it back is still
// one tap away, and whichever state it's left in persists across reloads on
// this browser from then on.

const COOKIE_NAME = 'pizzaDebugMenuExpanded';
const COOKIE_MAX_AGE_SEC = 365 * 24 * 60 * 60;

function readCookie(): boolean {
    const match = document.cookie
        .split('; ')
        .find(entry => entry.startsWith(`${COOKIE_NAME}=`));
    return match?.slice(COOKIE_NAME.length + 1) === '1';
}

function writeCookie(expanded: boolean): void {
    document.cookie = `${COOKIE_NAME}=${expanded ? '1' : '0'}; path=/; max-age=${COOKIE_MAX_AGE_SEC}`;
}

export class DebugMenuVisibilityCookie {
    // Read once, at module load — well before InGameButtonList is ever constructed (scene
    // build happens after every top-level import has already run), so no async load() step is
    // needed the way PlatformHandler-backed storage requires.
    private static cached = readCookie();

    static isExpanded(): boolean {
        return this.cached;
    }

    static setExpanded(expanded: boolean): void {
        this.cached = expanded;
        writeCookie(expanded);
    }
}
