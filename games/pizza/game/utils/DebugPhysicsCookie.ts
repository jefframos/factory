// DebugPhysicsCookie.ts
//
// Lets the pizza web editor's header toggles ("Debug Colliders"/"Debug
// Triggers" — see games/pizza/web/public/index.html) drive the GAME's own
// PhysicsConstants.PHYSICS_DEBUG/PHYSICS_TRIGGER_DEBUG flags, without the
// editor and the game sharing any other runtime connection — the editor
// writes a small JSON metadata cookie on toggle, and applyDebugPhysicsCookie()
// (called once at boot, DEV MODE ONLY — see index.ts) reads that same
// cookie and flips the flags to match. Cookies aren't port-scoped (only
// host-scoped), so this works even though the editor (server.mjs) and the
// game (the Vite dev server) run on different localhost ports.
//
// Deliberately gated to dev mode by the CALLER (index.ts checks
// Game.debugParams.dev before calling this) rather than in here — a
// production build should never read designer-only debug state off a
// cookie at all, not even to leave it at false.

import { setPhysicsDebugFlags } from '../physics/PhysicsConstants';

/** Must match the cookie name the pizza web editor's header toggles write — see index.html/app.js. */
const COOKIE_NAME = 'pizzaDebugPhysics';

interface DebugPhysicsCookieValue {
    collider?: boolean;
    trigger?: boolean;
}

/** Reads COOKIE_NAME off document.cookie, or undefined if it isn't set/isn't valid JSON. */
function readCookieValue(): DebugPhysicsCookieValue | undefined {
    const match = document.cookie
        .split('; ')
        .find(entry => entry.startsWith(`${COOKIE_NAME}=`));
    if (!match) {
        return undefined;
    }

    try {
        return JSON.parse(decodeURIComponent(match.slice(COOKIE_NAME.length + 1)));
    } catch {
        console.warn(`[DebugPhysicsCookie] "${COOKIE_NAME}" cookie isn't valid JSON — ignoring it`);
        return undefined;
    }
}

/** Applies the editor's saved collider/trigger debug toggles, if any — a no-op if the cookie was never set (every game session before this feature existed, or a player build with no editor involved at all). */
export function applyDebugPhysicsCookie(): void {
    const value = readCookieValue();
    if (!value) {
        return;
    }

    setPhysicsDebugFlags(value);
}
