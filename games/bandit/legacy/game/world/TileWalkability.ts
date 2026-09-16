// TileWalkability.ts
//
// Optional world-position -> walkable query, published by whichever TileMap is currently
// built (see TileMap.build()/destroy()) and read by PlayerMovementController.fixedUpdate().
// Deliberately a bare module-level slot rather than something wired through
// WorldManager/PizzaScene/MainPlayer's constructors: PlayerMovementController has no
// dependency on TileMap, WorldManager, or the tile map even existing, so a game with no
// tile map (or one that removes it later) still moves normally — `query` just stays
// undefined and isWalkable() below always returns true (fail-open, never fail-closed).
//
// Only one tile map is ever built at a time (PizzaScene owns exactly one WorldManager/
// TileMap), so a single slot is enough; a second build() overwrites it, and destroy() only
// clears it if it's still the current owner (see TileMap.ts) so a stale destroy() from an
// old instance can't clobber a newer one's registration.

export type WalkabilityQuery = (worldX: number, worldZ: number) => boolean;

let query: WalkabilityQuery | undefined;

export function setWalkabilityQuery(next: WalkabilityQuery): void {
    query = next;
}

/** No-ops unless `current` is still the published query — guards against an old TileMap's destroy() clobbering a newer one's registration (see this file's own doc). */
export function clearWalkabilityQuery(current: WalkabilityQuery): void {
    if (query === current) {
        query = undefined;
    }
}

/** Fail-open: true whenever no TileMap has published a query (no tile map in this game, or it hasn't built yet/was torn down). */
export function isWalkable(worldX: number, worldZ: number): boolean {
    return query?.(worldX, worldZ) ?? true;
}
