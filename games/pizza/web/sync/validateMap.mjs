// validateMap.mjs
//
// Cross-checks each map-placeable entity tab's ids against what's actually
// drawn on the Tiled map (see tiledMap.mjs) and reports both directions of
// mismatch:
//  - "in config, missing on map" — for gates/buildings this means
//    PizzaScene falls back to a hardcoded position (still spawns, just not
//    where the level designer probably intended); for queues it means the
//    id just never appears at all (queues are entirely map-driven — no
//    Tiled object, no spawn); for shops/crafting it's worse — PizzaScene
//    explicitly SKIPS spawning that shop/craft table (see
//    registerShopSpawnGates()/setupCraftTables()'s own console.warn), so
//    the config exists but is completely inert.
//  - "on map, missing from config" — for shops/crafting this is the exact
//    mirror of the above (WorldObjectRegistry sees an id with no matching
//    config, PizzaScene warns and refuses to spawn it); for queues it's
//    harmless (DEFAULT_QUEUE_CONFIG covers it); for gates/buildings this
//    can't happen today since both use a fixed enum id list, not
//    auto-discovery — included anyway for symmetry/future-proofing.
//
// Resources/actions/items/tools/dynamicResourcePlacements have no Tiled
// placement concept at all and are never checked here. shapeResourcePlacements
// IS checked, unlike its dynamicResourcePlacements sibling — a `shapeId`
// pointing at nothing drawn on the map means that placement silently spawns
// nothing at all (see ShapeResourceSpawner.tryFillDensity()'s own console.warn),
// exactly the kind of quiet-typo mismatch this file exists to catch.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readMapObjectIds } from './tiledMap.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MAP_FILE = path.join(__dirname, '..', '..', 'raw-assets', 'json', 'map', 'testMap1.json');

/** entity tab id -> the "type" custom property its objects use on the Tiled map, plus how to read that tab's own config ids and how severe a "missing on map" mismatch actually is in-game. */
const MAP_CHECKED_ENTITIES = {
    gates: { mapType: 'gate', configIds: data => Object.keys(data), missingOnMapSeverity: 'warning' },
    buildings: { mapType: 'building', configIds: data => Object.keys(data), missingOnMapSeverity: 'warning' },
    queues: { mapType: 'queue', configIds: data => Object.keys(data.byId ?? {}), missingOnMapSeverity: 'info' },
    // Same "harmless either direction" severity as queues — a farm id missing on the map just
    // means that override never applies to anything; a farm id drawn on the map but missing
    // from FARM_PLOT_CONFIG_BY_ID just falls back to DEFAULT_FARM_PLOT_CONFIG (see FarmTypes.
    // ts's own doc) — surfaced here mainly so a level designer sees every plot they've actually
    // drawn and can give one its own price/unlock instead of hunting the Tiled map by eye.
    farms: { mapType: 'farm', configIds: data => Object.keys(data.byId ?? {}), missingOnMapSeverity: 'info' },
    // Same reasoning/severity as farms just above — a mart id missing on the map means that
    // override never applies; one drawn but not overridden just falls back to
    // DEFAULT_MART_CONFIG (see MartTypes.ts's own doc).
    marts: { mapType: 'mart', configIds: data => Object.keys(data.byId ?? {}), missingOnMapSeverity: 'info' },
    // Same reasoning/severity as marts just above — a "craftTable" id missing on the map means
    // that override never applies; one drawn but not overridden just falls back to
    // DEFAULT_CRAFTING_TABLE_CONFIG (see CraftingTableTypes.ts's own doc).
    craftingTables: { mapType: 'craftTable', configIds: data => Object.keys(data.byId ?? {}), missingOnMapSeverity: 'info' },
    shops: { mapType: 'shop', configIds: data => Object.keys(data), missingOnMapSeverity: 'error' },
    crafting: { mapType: 'craft', configIds: data => Object.keys(data), missingOnMapSeverity: 'error' },
    // `configIds` collects every placement's `shapeId` (not the array's own indices — a
    // shapeResourcePlacements entry has no id of its own, see ShapeResourceTypes.ts) —
    // deduped via Set since more than one placement can legitimately share the same shape.
    shapeResourcePlacements: { mapType: 'spawner', configIds: data => [...new Set(data.map(p => p.shapeId).filter(Boolean))], missingOnMapSeverity: 'error' },
};

/**
 * `allData` is every tab's current data, keyed by tab id (the same shape
 * app.js keeps in memory — see server.mjs's caller, which reads it fresh
 * from the on-disk JSON mirrors). Returns `{ mapError, entities }` — one
 * entry per entity in MAP_CHECKED_ENTITIES, each `{ missingOnMap: [...],
 * missingInConfig: [...] }`. If the map itself couldn't be read, `entities`
 * is still returned (all empty) so callers don't need a separate branch.
 */
export function validateMap(allData) {
    const { byType, error } = readMapObjectIds(MAP_FILE);

    const entities = {};
    for (const [entityId, check] of Object.entries(MAP_CHECKED_ENTITIES)) {
        const data = allData[entityId];
        if (!data) {
            continue;
        }
        const configIds = check.configIds(data);
        const mapIds = byType[check.mapType] ?? new Set();

        entities[entityId] = {
            severity: check.missingOnMapSeverity,
            missingOnMap: configIds.filter(id => !mapIds.has(id)),
            missingInConfig: [...mapIds].filter(id => !configIds.includes(id)),
        };
    }

    return { mapError: error, mapFile: MAP_FILE, entities };
}
