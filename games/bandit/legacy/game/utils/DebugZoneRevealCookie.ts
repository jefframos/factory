// DebugZoneRevealCookie.ts
//
// Persists how far the debug "Open Next Zone"/"Teleport: Next" tools (see
// WorldManager.revealNextZone()/revealUpToZone(), InGameButtonList.ts's own
// debug button stack) have manually unlocked — a plain document.cookie, same
// mechanism (and file-neighbor) as DebugPhysicsCookie.ts/
// DebugMenuVisibilityCookie.ts, rather than PlatformHandler (the *Storage.ts
// convention every REAL gameplay value in this game persists through): this
// is a local dev/testing convenience, read synchronously once at module
// load, with no boot-sequence await needed.
//
// Deliberately separate from any real zone-unlock persistence — zones
// unlocked through an actual MilestoneRequirement (WorldManager.
// checkZoneRequirements()) never touch this at all (that path calls
// revealZoneWithEffect() directly, bypassing nextZoneToReveal entirely — see
// that field's own doc), so this cookie only ever reflects "how far a
// tester manually clicked/teleported," never real player progression. That's
// also why losing this cookie (a different browser, a cleared cookie jar)
// is harmless — real progression is unaffected either way.

const COOKIE_NAME = 'pizzaDebugNextZoneToReveal';
const COOKIE_MAX_AGE_SEC = 365 * 24 * 60 * 60;

function readCookie(): number {
    const match = document.cookie
        .split('; ')
        .find(entry => entry.startsWith(`${COOKIE_NAME}=`));
    if (!match) {
        return 1;
    }
    const value = Number(match.slice(COOKIE_NAME.length + 1));
    return Number.isFinite(value) && value >= 1 ? value : 1;
}

function writeCookie(nextZoneToReveal: number): void {
    document.cookie = `${COOKIE_NAME}=${nextZoneToReveal}; path=/; max-age=${COOKIE_MAX_AGE_SEC}`;
}

export class DebugZoneRevealCookie {
    // Read once, at module load — well before WorldManager is ever constructed (scene build
    // happens after every top-level import has already run), so no async load() step is needed
    // the way PlatformHandler-backed storage requires.
    private static cached = readCookie();

    /** The next zoneNumber a debug reveal should unlock — 1 (nothing manually unlocked past zone1/zoneNumber 0 yet) if never set. */
    static getNextZoneToReveal(): number {
        return this.cached;
    }

    static setNextZoneToReveal(nextZoneToReveal: number): void {
        this.cached = nextZoneToReveal;
        writeCookie(nextZoneToReveal);
    }

    /** Debug/dev reset — see PlayerDataReset.ts's own doc on why a player-facing "Clear Data" has to reach this too: without it, a session that ever used "Open Next Zone"/"Teleport: Next" would reload a Clear Data wipe straight back into whatever zone that debug reveal last left off at, instead of the fresh zone1-only state every other cleared storage reset to. Resets back to 1 (nothing manually unlocked past zone1/zoneNumber 0) — same as never having set the cookie at all. */
    static clear(): void {
        this.cached = 1;
        writeCookie(1);
    }
}
