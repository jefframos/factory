// WorldObjectRegistry.ts
//
// Reads the Tiled map's "mapSettings" objectgroup layer (see
// TileMapConfig.ts's TiledObject/getObjectProperty doc) and buckets every
// object by its "type" custom property (e.g. "building", "gate", "dropper"),
// keyed within that bucket by its "id" custom property (e.g. "camp",
// "gate1") — so a spawner can ask "where's the building/gate/etc. named X"
// instead of PizzaScene hand-placing everything at hardcoded positions
// (BUILDING_ZONE_OFFSET, GateConfig.position, ...).
//
// A "dropper" object is a second rect, drawn separately from the building/
// entity it belongs to, meant to stand in for that entity's OWN deposit
// trigger area instead of the entity's own footprint — useful when the
// visual building sits somewhere a player can't actually walk up to (against
// a wall, elevated, etc.) and the drop-off spot needs to be somewhere else
// entirely. It points at its target via a "target" custom property (e.g. a
// BuildingId) rather than "id" — see getDropperFor(), the one reader.
//
// Built once alongside TileMap (same loadTiledMap()/loadTileDefs() PIXI
// Assets reads, no extra network/parse cost) — call get()/require()/
// getDropperFor() any time after that, e.g. right where PizzaScene currently
// spawns each BuildingZone/Gate.

import {
    DEFAULT_TILE_MAP_ALIASES,
    getObjectProperty,
    loadTiledMap,
    loadTileDefs,
    objectToWorldRect,
    WORLD_UNITS_PER_TILE,
} from './TileMapConfig';

/** Tiled layer name holding hand-placed building/gate/etc. spawn points — see this file's own doc. */
export const OBJECTS_LAYER_NAME = 'mapSettings';

/** The "type" custom property value marking a dropper rect — see this file's own doc. */
const DROPPER_TYPE = 'dropper';
/** The custom property (NOT "id") a dropper uses to name what it's a trigger area FOR — e.g. a BuildingId. */
const DROPPER_TARGET_PROPERTY = 'target';

/** width/depth are the rect's HORIZONTAL footprint (Tiled has no 3rd dimension) — see objectToWorldRect()'s own doc for why a spawner should keep its own config's Y height and only override X/Z from these. */
export interface WorldObjectPlacement {
    x: number;
    z: number;
    width: number;
    depth: number;
}

export default class WorldObjectRegistry {
    /** type -> (id -> placement) — see this file's own doc. */
    private readonly byType = new Map<string, Map<string, WorldObjectPlacement>>();
    /** target (a dropper's "target" custom property, e.g. a BuildingId) -> that dropper's own placement — see getDropperFor(). */
    private readonly dropperPlacementsByTarget = new Map<string, WorldObjectPlacement>();

    public constructor(
        mapAlias: string = DEFAULT_TILE_MAP_ALIASES.map,
        tilesAlias: string = DEFAULT_TILE_MAP_ALIASES.tiles,
        worldUnitsPerTile: number = WORLD_UNITS_PER_TILE,
    ) {
        const map = loadTiledMap(mapAlias);
        const tileDefs = loadTileDefs(tilesAlias);
        const layer = map.layers.find(l => l.type === 'objectgroup' && l.name === OBJECTS_LAYER_NAME);
        if (!layer?.objects) {
            console.warn(`[WorldObjectRegistry] no "${OBJECTS_LAYER_NAME}" objectgroup layer found on "${mapAlias}" — every building/gate placement will fall back to its hardcoded position`);
            return;
        }

        // Logged unconditionally (not just on ?dev) since this is exactly the "what did it
        // actually find" the user asked for — cheap, one-time, at map-load — see require()'s
        // own warning for the OTHER half (an id a spawner asked for that ISN'T in this list).
        console.log(`[WorldObjectRegistry] "${OBJECTS_LAYER_NAME}" has ${layer.objects.length} object(s):`);

        for (const obj of layer.objects) {
            const type = getObjectProperty(obj, 'type');
            const id = getObjectProperty(obj, 'id');
            if (!type || !id) {
                console.warn(`[WorldObjectRegistry] object #${obj.id} on "${OBJECTS_LAYER_NAME}" is missing its "type" or "id" custom property — skipping`);
                continue;
            }

            const placement = objectToWorldRect(obj, tileDefs.tileSize, worldUnitsPerTile);
            console.log(
                `  - type="${type}" id="${id}" -> world x=${placement.x.toFixed(2)} z=${placement.z.toFixed(2)}` +
                ` width=${placement.width.toFixed(2)} depth=${placement.depth.toFixed(2)}` +
                ` (Tiled px: x=${obj.x} y=${obj.y} width=${obj.width} height=${obj.height})`,
            );

            let bucket = this.byType.get(type);
            if (!bucket) {
                bucket = new Map();
                this.byType.set(type, bucket);
            }
            bucket.set(id, placement);

            if (type === DROPPER_TYPE) {
                const target = getObjectProperty(obj, DROPPER_TARGET_PROPERTY);
                if (!target) {
                    console.warn(`[WorldObjectRegistry] dropper "${id}" has no "${DROPPER_TARGET_PROPERTY}" custom property — it won't be used as anything's trigger area`);
                } else if (this.dropperPlacementsByTarget.has(target)) {
                    console.warn(`[WorldObjectRegistry] more than one dropper targets "${target}" — the last one found ("${id}") wins`);
                    this.dropperPlacementsByTarget.set(target, placement);
                } else {
                    this.dropperPlacementsByTarget.set(target, placement);
                }
            }
        }
    }

    /** The placement for `id` within `type`'s bucket, or undefined if no such object exists on the map — callers decide what "not found" means (fall back to a hardcoded position, skip spawning, ...); this never warns on its own, see require() for the warn-and-fall-back convenience below. */
    public get(type: string, id: string): WorldObjectPlacement | undefined {
        return this.byType.get(type)?.get(id);
    }

    /**
     * Every id -> placement found for `type`, e.g. every "queue" object on the map — for
     * spawners with no FIXED, known-ahead-of-time id list to require() against (unlike
     * BuildingId/GateId's small hand-authored enums), where "whatever's drawn on the map,
     * however many there are" IS the source of truth. Returns a fresh copy (not the live
     * bucket) so a caller can't accidentally mutate this registry's own state. Empty map
     * (not undefined) if `type` has no objects at all — a spawner iterating this can just
     * `for...of` it with no existence check.
     */
    public getAllOfType(type: string): Map<string, WorldObjectPlacement> {
        return new Map(this.byType.get(type));
    }

    /**
     * The dropper rect (see this file's own doc) whose "target" custom property equals
     * `targetId` — undefined if no dropper targets it, in which case the caller should fall
     * back to `targetId`'s own placement as its trigger area. Never warns on its own (unlike
     * require()) — a target with no dropper is an expected, not-necessarily-wrong state (not
     * every building needs a dropper); callers that care (e.g. PizzaScene, wanting to flag
     * buildings a level designer forgot to give one) collect the misses themselves and warn
     * once after resolving everything, not per-lookup.
     */
    public getDropperFor(targetId: string): WorldObjectPlacement | undefined {
        return this.dropperPlacementsByTarget.get(targetId);
    }

    /**
     * Same lookup as get(), but warns (once per missing id, not once per call) and returns
     * `fallback` instead of undefined — the convenience for "spawn this thing somewhere
     * even if the level designer hasn't dropped its marker in Tiled yet," so a missing
     * object degrades to a visible warning instead of a building/gate silently not spawning
     * at all.
     */
    public require(type: string, id: string, fallback: WorldObjectPlacement): WorldObjectPlacement {
        const placement = this.get(type, id);
        if (!placement) {
            console.warn(`[WorldObjectRegistry] "${id}" (type "${type}") not found on the Tiled map's "${OBJECTS_LAYER_NAME}" layer — using fallback position`);
            return fallback;
        }
        return placement;
    }
}
