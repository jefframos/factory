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
