// tiledMap.mjs
//
// A minimal, read-only unpacker for the SAME Tiled map JSON the game itself
// reads at runtime (games/pizza/raw-assets/json/map/testMap1.json, via
// WorldObjectRegistry.ts) — just enough to answer "what (type, id) objects
// actually exist on the map's mapSettings layer," so the editor can cross-
// check a gate/building/queue/shop/craft-table id against what's really
// drawn in Tiled instead of trusting the config blindly. Deliberately NOT a
// full Tiled parser (no tile layers, no gid resolution, no waypoint
// ordering) — WorldObjectRegistry.ts already owns the real runtime version
// of this; this is a duplicate parse, on purpose, so the editor stays a
// read-only tool with no import-time dependency on game code (which would
// drag in PIXI/THREE — see this repo's own note on why ItemTypes.ts/
// MilestoneRequirement.ts can't just be `import`ed from a plain Node
// script). If WorldObjectRegistry.ts's own reading of "type"/"id" custom
// properties off the "mapSettings" objectgroup layer ever changes, mirror
// the change here too.

import fs from 'node:fs';

/** Matches WorldObjectRegistry.OBJECTS_LAYER_NAME exactly — see that file's own doc. */
const OBJECTS_LAYER_NAME = 'mapSettings';

/**
 * Reads `mapFilePath` and buckets every object on its "mapSettings" layer by
 * ("type" custom property) -> Set of ("id" custom property) — the same
 * bucketing WorldObjectRegistry.ts does at runtime, minus everything this
 * editor doesn't need (waypoint ordering, dropper targets, world-unit
 * conversion). Objects missing "type" or "id" (waypoints, playerStart) are
 * silently skipped — they're not something a config entity id ever
 * cross-references.
 *
 * Returns `{ byType, error }` — `error` is set (and `byType` empty) if the
 * map file doesn't exist or fails to parse, so a caller can surface "map
 * couldn't be read" distinctly from "map read fine, but empty."
 */
export function readMapObjectIds(mapFilePath) {
    let raw;
    try {
        raw = fs.readFileSync(mapFilePath, 'utf-8');
    } catch (err) {
        return { byType: {}, error: `couldn't read map file: ${err.message}` };
    }

    let map;
    try {
        map = JSON.parse(raw);
    } catch (err) {
        return { byType: {}, error: `map file isn't valid JSON: ${err.message}` };
    }

    const layer = map.layers?.find(l => l.type === 'objectgroup' && l.name === OBJECTS_LAYER_NAME);
    if (!layer) {
        return { byType: {}, error: `no "${OBJECTS_LAYER_NAME}" objectgroup layer found in the map` };
    }

    const byType = {};
    for (const obj of layer.objects ?? []) {
        const props = Object.fromEntries((obj.properties ?? []).map(p => [p.name, p.value]));
        const type = props.type;
        const id = props.id;
        if (!type || !id) {
            continue;
        }
        (byType[type] ??= new Set()).add(String(id));
    }

    return { byType, error: null };
}

/** Matches WorldObjectRegistry's SPAWNER_TYPE ("spawner") exactly — the "type" custom property value marking a spawner AREA object (rect/ellipse/polygon) on mapSettings, as opposed to WorldSpawner's own unrelated "spawnerLayer" TILE clusters below. */
const SPAWNER_OBJECT_TYPE = 'spawner';

/**
 * Every "id" custom property drawn on a "spawner"-type mapSettings object (e.g.
 * "animalSpawner1") — backs the Shape Resources tab's '$spawnerShapeIds' virtual select
 * source, same "ask the real map, not any tab's own data" reasoning readSpawnerTileTypes()
 * uses. Reuses readMapObjectIds() (already buckets by type/id) rather than re-parsing the
 * map a second time.
 */
export function readSpawnerShapeIds(mapFilePath) {
    const { byType, error } = readMapObjectIds(mapFilePath);
    if (error) {
        return { shapeIds: [], error };
    }
    return { shapeIds: [...(byType[SPAWNER_OBJECT_TYPE] ?? [])].sort(), error: null };
}

/** Matches WorldSpawner.SPAWNER_LAYER_NAME_FILTER exactly — see that file's own doc (substring match, not exact, so "spawnerLayer"/"spawnerLayer2"/etc. all count). */
const SPAWNER_LAYER_NAME_FILTER = 'spawnerLayer';

/** Every gid painted anywhere in `layer`, whichever shape it's in (bounded `data` array or infinite-map `chunks`) — mirrors TileMapConfig.ts's iterateLayerCells(), minus the col/row this caller doesn't need. */
function* iterateLayerGids(layer) {
    if (layer.chunks) {
        for (const chunk of layer.chunks) {
            for (const gid of chunk.data) {
                if (gid > 0) yield gid;
            }
        }
        return;
    }
    for (const gid of layer.data ?? []) {
        if (gid > 0) yield gid;
    }
}

/**
 * Resolves every ground tile name (map/tiles.json's `grounds[]`) the game's tile-spawner
 * system could ever resolve a "spawnerLayer" cell to, cross-referenced against which of
 * those names are ACTUALLY painted on a spawner layer on the current map right now — see
 * WorldSpawner.ts's own doc for the exact gid -> name resolution this mirrors (tileset
 * firstgid ordering, then an index lookup into tiles.json's `grounds`/`resources` arrays).
 * Only `grounds` names are offered as options (not `resources, e.g. "tree"/"stone") since a
 * spawner tile type names the GROUND a loose resource scatters across, not a gatherable
 * resource tile itself — matches every existing DYNAMIC_RESOURCE_PLACEMENTS entry (`sand`,
 * `grass`), both ground names.
 *
 * Returns `{ tileTypes: [{ name, painted }], error }` — `painted` is true for a name found
 * on an actual spawnerLayer cell right now, false for a ground tile that exists in the
 * tileset but hasn't been painted onto any spawner layer yet (still offered — a designer
 * planning ahead should be able to pick it before going and painting it in Tiled, this just
 * tells them it still needs that step).
 */
export function readSpawnerTileTypes(mapFilePath, tilesFilePath) {
    let map;
    let tileDefs;
    try {
        map = JSON.parse(fs.readFileSync(mapFilePath, 'utf-8'));
        tileDefs = JSON.parse(fs.readFileSync(tilesFilePath, 'utf-8'));
    } catch (err) {
        return { tileTypes: [], error: `couldn't read map/tiles files: ${err.message}` };
    }

    const sortedTilesets = [...(map.tilesets ?? [])].sort((a, b) => a.firstgid - b.firstgid);
    const groundFirstGid = sortedTilesets[0]?.firstgid ?? 1;
    const resourceFirstGid = sortedTilesets[1]?.firstgid ?? groundFirstGid;

    const spawnerLayers = (map.layers ?? []).filter(l => l.type === 'tilelayer' && l.name.includes(SPAWNER_LAYER_NAME_FILTER));

    const paintedNames = new Set();
    for (const layer of spawnerLayers) {
        for (const gid of iterateLayerGids(layer)) {
            const groundDef = tileDefs.grounds?.[gid - groundFirstGid];
            if (groundDef) {
                paintedNames.add(groundDef.name);
                continue;
            }
            const resourceDef = tileDefs.resources?.[gid - resourceFirstGid];
            if (resourceDef) {
                paintedNames.add(resourceDef.name);
            }
        }
    }

    const tileTypes = (tileDefs.grounds ?? []).map(g => ({ name: g.name, painted: paintedNames.has(g.name) }));
    return { tileTypes, error: null };
}

/** Matches TileMapConfig.ZONE_LAYER_NAME exactly — the tilelayer whose cells mark zone boundaries (see that file's own doc: a cell's LOCAL tile id, gid minus its owning tileset's firstgid, IS the zone number, 0-based — "zone1" in level-designer terms is zoneNumber 0). */
const ZONE_LAYER_NAME = 'zones';

/** Every gid painted anywhere in `layer`, WITH its absolute (col, row) — same two map shapes iterateLayerGids() above already handles (bounded `data` array vs. infinite-map `chunks`), just also yielding position since a zone's own cell coordinates are the whole point here (unlike iterateLayerGids(), which only needed the gid). Mirrors TileMapConfig.ts's iterateLayerCells() exactly. */
function* iterateLayerCells(layer) {
    if (layer.chunks) {
        for (const chunk of layer.chunks) {
            for (let i = 0; i < chunk.data.length; i++) {
                const gid = chunk.data[i];
                if (gid > 0) {
                    yield { gid, col: chunk.x + (i % chunk.width), row: chunk.y + Math.floor(i / chunk.width) };
                }
            }
        }
        return;
    }
    const data = layer.data ?? [];
    const width = layer.width ?? 0;
    for (let i = 0; i < data.length; i++) {
        const gid = data[i];
        if (gid > 0) {
            yield { gid, col: i % width, row: Math.floor(i / width) };
        }
    }
}

/** The tileset (from `map.tilesets`) with the largest firstgid still `<= gid` — mirrors TileMapConfig.ts's findTilesetOwningGid(). */
function findTilesetOwningGid(map, gid) {
    if (gid <= 0) {
        return undefined;
    }
    const sorted = [...(map.tilesets ?? [])].sort((a, b) => a.firstgid - b.firstgid);
    let owner;
    for (const tileset of sorted) {
        if (tileset.firstgid > gid) {
            break;
        }
        owner = tileset;
    }
    return owner;
}

/**
 * Reads `mapFilePath`'s "zones" tilelayer and groups every painted cell by zone number — the
 * SAME grouping TileMapConfig.buildZoneTileCells() does at runtime (mirrored here, read-only,
 * for the same "editor stays independent of game code" reasoning this file's own top doc
 * gives for readMapObjectIds()) — backs the Zones tab's map visualization and its
 * auto-discovery of which zone numbers actually exist to edit (see app.js's renderZonesTab()).
 *
 * Returns `{ zones: [{ zoneNumber, cellCount, minCol, maxCol, minRow, maxRow, cells }], error }`,
 * sorted ascending by zoneNumber. `cells` is every (col, row) that zone paints — enough for the
 * client to draw a small grid visualization without a second round-trip.
 */
export function readZoneCells(mapFilePath) {
    let map;
    try {
        map = JSON.parse(fs.readFileSync(mapFilePath, 'utf-8'));
    } catch (err) {
        return { zones: [], error: `couldn't read map file: ${err.message}` };
    }

    const layer = (map.layers ?? []).find(l => l.type === 'tilelayer' && l.name === ZONE_LAYER_NAME);
    if (!layer) {
        return { zones: [], error: `no "${ZONE_LAYER_NAME}" tilelayer found in the map` };
    }

    const byZone = new Map();
    for (const { gid, col, row } of iterateLayerCells(layer)) {
        const owner = findTilesetOwningGid(map, gid);
        if (!owner) {
            continue;
        }
        const zoneNumber = gid - owner.firstgid;
        (byZone.get(zoneNumber) ?? byZone.set(zoneNumber, []).get(zoneNumber)).push({ col, row });
    }

    const zones = [...byZone.entries()]
        .sort(([a], [b]) => a - b)
        .map(([zoneNumber, cells]) => ({
            zoneNumber,
            cellCount: cells.length,
            minCol: Math.min(...cells.map(c => c.col)),
            maxCol: Math.max(...cells.map(c => c.col)),
            minRow: Math.min(...cells.map(c => c.row)),
            maxRow: Math.max(...cells.map(c => c.row)),
            cells,
        }));

    return { zones, error: null };
}

/** "type" custom property values on a mapSettings object that aren't a real placed ENTITY — a dropper is a second trigger-area rect for something else's own id (not itself a thing), a waypoint is one stop on a path (no identity of its own) — see WorldObjectRegistry.ts's own doc on both. Excluded from readZoneContents() below; every other type ('building', 'gate', 'queue', 'shop', 'craft', 'spawner') is a real placed thing worth showing as "in zone X". */
const NON_ENTITY_OBJECT_TYPES = new Set(['dropper', 'waypoint']);

/**
 * Cross-references every mapSettings object's position against the "zones" tilelayer (same
 * cellToZone lookup readZoneCells() builds, just kept as a Map instead of grouped into arrays)
 * to answer "what's actually IN zone N" — backs the Graph tab's zone "in zone" edges (see
 * graph.js's own doc). A "spawner"-type object's id here is a shapeId (e.g.
 * "animalSpawner1") — the Graph tab cross-references that against SHAPE_RESOURCE_PLACEMENTS
 * itself (fetched separately) to find which spawner(s) actually reference it, since a spawner
 * AREA's own placement and what it spawns are two different tabs.
 *
 * Best-effort, not exact: a tile-anchored object's `x`/`y` is its BOTTOM-left corner per
 * objectToWorldRect()'s own doc (an ordinary rect object's is top-left) — this doesn't
 * distinguish the two, since "roughly which cell is this in" for a graph visualization doesn't
 * need that precision the way the game's own real placement math does.
 *
 * Returns `{ byZone: { [zoneNumber]: { [type]: [id, ...] } }, error }`.
 */
export function readZoneContents(mapFilePath) {
    let map;
    try {
        map = JSON.parse(fs.readFileSync(mapFilePath, 'utf-8'));
    } catch (err) {
        return { byZone: {}, error: `couldn't read map file: ${err.message}` };
    }

    const zoneLayer = (map.layers ?? []).find(l => l.type === 'tilelayer' && l.name === ZONE_LAYER_NAME);
    if (!zoneLayer) {
        return { byZone: {}, error: `no "${ZONE_LAYER_NAME}" tilelayer found in the map` };
    }

    const cellToZone = new Map();
    for (const { gid, col, row } of iterateLayerCells(zoneLayer)) {
        const owner = findTilesetOwningGid(map, gid);
        if (owner) {
            cellToZone.set(`${col},${row}`, gid - owner.firstgid);
        }
    }

    const objectLayer = (map.layers ?? []).find(l => l.type === 'objectgroup' && l.name === OBJECTS_LAYER_NAME);
    const byZone = {};
    for (const obj of objectLayer?.objects ?? []) {
        const props = Object.fromEntries((obj.properties ?? []).map(p => [p.name, p.value]));
        const type = props.type;
        const id = props.id;
        if (!type || !id || NON_ENTITY_OBJECT_TYPES.has(type)) {
            continue;
        }
        const col = Math.floor(obj.x / map.tilewidth);
        const row = Math.floor(obj.y / map.tileheight);
        const zoneNumber = cellToZone.get(`${col},${row}`);
        if (zoneNumber === undefined) {
            continue;
        }
        ((byZone[zoneNumber] ??= {})[type] ??= []).push(String(id));
    }

    // Dedupe — a "craft"/"shop"/etc. id can legitimately have more than one mapSettings
    // object drawn for it (e.g. a table's own dropper-adjacent duplicate placement), which
    // would otherwise list/edge the same id twice for no reason.
    for (const types of Object.values(byZone)) {
        for (const [type, ids] of Object.entries(types)) {
            types[type] = [...new Set(ids)];
        }
    }

    return { byZone, error: null };
}
