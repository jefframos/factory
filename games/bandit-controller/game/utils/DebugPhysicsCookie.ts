// DebugPhysicsCookie.ts
//
// Persists the ?dev=1 panel's "Show Colliders"/"Show Triggers" checkboxes (see index.ts)
// across reloads — dat.GUI itself has no storage of its own (see DevGuiManager.ts), so
// without this every toggle would silently reset to off on the next reload. Same small-JSON-
// cookie shape pizza's own DebugPhysicsCookie.ts uses for its web-editor toggles, but here
// the GAME itself is the only reader AND writer (no separate editor process involved), so
// both halves live in one file instead of being split across an editor + a game-side reader.
//
// Deliberately gated to dev mode by the CALLER (index.ts checks Game.debugParams.dev before
// calling either function here) — a production build should never read/write designer-only
// debug state off a cookie at all, not even to leave it at false.

import { setPhysicsDebugFlags } from 'core/physics/PhysicsConstants';

const COOKIE_NAME = 'banditDebugPhysics';
/** One year — long enough that a returning dev never has to re-check the boxes, short enough that a stray cookie doesn't outlive the machine it was set on. */
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

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

/**
 * Applies whatever was last saved (see saveDebugPhysicsCookie()) and returns it — a no-op
 * (returns {}) if nothing's been saved yet, e.g. the very first ?dev session on this
 * browser. Call once at boot, before any scene builds its entities (same "RigidBody.awake()
 * only reads these once" constraint setPhysicsDebugFlags's own doc describes).
 */
export function applyDebugPhysicsCookie(): DebugPhysicsCookieValue {
    const value = readCookieValue() ?? {};
    setPhysicsDebugFlags(value);
    return value;
}

/**
 * Merges `patch` into whatever's already saved and writes the result back — called from the
 * ?dev panel's own checkbox onChange handlers (see index.ts), so the NEXT reload starts with
 * the same toggle state instead of resetting to off. Merges rather than overwrites so
 * flipping ONE checkbox (e.g. Show Colliders) never clobbers whatever the OTHER one
 * (Show Triggers) already had saved.
 */
export function saveDebugPhysicsCookie(patch: DebugPhysicsCookieValue): void {
    const merged: DebugPhysicsCookieValue = { ...readCookieValue(), ...patch };
    document.cookie = `${COOKIE_NAME}=${encodeURIComponent(JSON.stringify(merged))}; max-age=${COOKIE_MAX_AGE_SECONDS}; path=/`;
}
