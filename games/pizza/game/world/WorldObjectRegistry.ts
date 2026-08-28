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
// A "playerStart" object is a bare Tiled point carrying ONLY an "id"
// custom property (value "playerStart") — no "type" at all, unlike every
// other object here, since it isn't a typed/bucketed thing a spawner looks
// up by (type, id); it's a single, singular marker. Handled as its own
// special case, checked by id before the "type" requirement every other
// object below goes through — see getPlayerStart(), the one reader
// (PizzaScene, positioning MainPlayer at boot). Optional: a map with no such
// object just means "whatever MainPlayer's own default position already
// is" — see getPlayerStart()'s own doc.
//
// A "spawner" object is an AREA (rect, ellipse, or freehand polygon — a
// level designer's choice per object, all three read here) instead of a
// point/rect placement — e.g. "animalSpawner1", a polygon drawn on
// mapSettings. Unlike every other type bucketed by (type, id) above, a
// spawner's whole shape geometry (not just its center) is what callers need,
// since something spawning INSIDE it (see ShapeResourceSpawner.ts) has to
// pick a random point that actually lands within the drawn area — a plain
// center+width/depth rect wouldn't capture an irregular polygon's real
// footprint. Kept as its OWN map (getShape()/getAllShapes()), parsed
// alongside the normal (type, id) bucketing above (a spawner object still
// gets a degenerate zero-size entry in that bucket too, harmlessly unused)
// rather than replacing it, so nothing already reading `byType`/get()
// changes behavior. See SpawnerShape's own doc for how each Tiled draw tool
// maps to a shape kind, and ShapeResourceSpawner.ts for the one consumer.
//
// A "waypoint" object is a point (Tiled ellipse, zero width/height) marking
// one stop on a walked PATH — it carries "order" (an int, where the path
// runs LOWEST-to-highest, index 0 conventionally right next to whatever it
// leads to) and "target" (e.g. a queue id) instead of "id"/"type"-bucketed
// like everything else here, since a waypoint has no identity of its own
// beyond its place in that ordered list — see getWaypoints(), the one reader
// (QuestGiverEntity.ts, walking a queue's giver in/out along the path).
//
// Built once alongside TileMap (same loadTiledMap()/loadTileDefs() PIXI
// Assets reads, no extra network/parse cost) — call get()/require()/
// getDropperFor()/getWaypoints() any time after that, e.g. right where
// PizzaScene currently spawns each BuildingZone/Gate/QueueZone.

import {
    DEFAULT_TILE_MAP_ALIASES,
    getObjectProperty,
    loadTiledMap,
    loadTileDefs,
    objectToWorldRect,
    TiledObject,
    WORLD_UNITS_PER_TILE,
} from './TileMapConfig';

/** Tiled layer name holding hand-placed building/gate/etc. spawn points — see this file's own doc. */
export const OBJECTS_LAYER_NAME = 'mapSettings';

/** The "type" custom property value marking a dropper rect — see this file's own doc. */
const DROPPER_TYPE = 'dropper';
/** The custom property (NOT "id") a dropper uses to name what it's a trigger area FOR — e.g. a BuildingId. */
const DROPPER_TARGET_PROPERTY = 'target';

/** The "type" custom property value marking a spawner AREA object — see this file's own doc. */
const SPAWNER_TYPE = 'spawner';

/** The "id" custom property value marking the player-start point — see this file's own doc. */
const PLAYER_START_ID = 'playerStart';

/** The "type" custom property value marking a waypoint point — see this file's own doc. */
const WAYPOINT_TYPE = 'waypoint';
/** The custom property (NOT "id") a waypoint uses to name which path it belongs to — e.g. a queue id. */
const WAYPOINT_TARGET_PROPERTY = 'target';
/** The custom property giving a waypoint's position within its path — see WaypointPlacement's own doc. */
const WAYPOINT_ORDER_PROPERTY = 'order';

/** width/depth are the rect's HORIZONTAL footprint (Tiled has no 3rd dimension) — see objectToWorldRect()'s own doc for why a spawner should keep its own config's Y height and only override X/Z from these. `rotationDeg` is Tiled's own clockwise-degrees `rotation`, unconverted — see objectToWorldRect()'s own doc for the sign flip a caller needs applying it to a THREE Y-axis rotation. 0 for an object that was never rotated at all, same as before this field existed. */
export interface WorldObjectPlacement {
    x: number;
    z: number;
    width: number;
    depth: number;
    rotationDeg: number;
}

/**
 * One spawner AREA's world-space geometry — see this file's own doc for why a spawner needs
 * its full shape, not just a center point. `kind` follows straight from which Tiled draw tool
 * made the object: a polygon object (obj.polygon set) -> 'polygon'; an ellipse object
 * (obj.ellipse === true) -> 'circle'; anything else (a plain drawn rectangle) -> 'rect'.
 * Rotation is honored for 'polygon' (each vertex rotated the same way objectToWorldRect()
 * rotates a rect's center) but NOT for 'circle'/'rect' — a rotated circle is still the same
 * circle, and a rotated rect spawner is treated as its unrotated axis-aligned bounds, which is
 * an acceptable simplification for a random-point-inside sampler (see
 * ShapeResourceSpawner.ts's own doc).
 */
export interface SpawnerShape {
    kind: 'polygon' | 'circle' | 'rect';
    /** World-space centroid/center — always present regardless of kind. */
    center: { x: number; z: number };
    /** World-space vertices, in drawn order — 'polygon' only. */
    points?: { x: number; z: number }[];
    /** World-units radius — 'circle' only. */
    radius?: number;
    /** World-units half-extents from `center` — 'rect' only. */
    halfWidth?: number;
    halfDepth?: number;
}

/** True if (x, z) falls inside `shape` — see SpawnerShape's own doc for what each kind means. Ray-casting (even-odd rule) for a polygon; plain distance/box check for circle/rect. Lives here (not ShapeResourceSpawner.ts/AnimalNode.ts, both of which use it) so those two files can share it without importing each other — see AnimalNode.ts's own doc on why that circular import would otherwise happen (it needs this for wander-target picking, ShapeResourceSpawner.ts constructs AnimalNode instances). */
export function isPointInShape(shape: SpawnerShape, x: number, z: number): boolean {
    switch (shape.kind) {
        case 'circle': {
            const dx = x - shape.center.x;
            const dz = z - shape.center.z;
            return dx * dx + dz * dz <= shape.radius! * shape.radius!;
        }
        case 'rect':
            return Math.abs(x - shape.center.x) <= shape.halfWidth! && Math.abs(z - shape.center.z) <= shape.halfDepth!;
        case 'polygon': {
            const points = shape.points!;
            let inside = false;
            for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
                const pi = points[i];
                const pj = points[j];
                const intersects = (pi.z > z) !== (pj.z > z)
                    && x < ((pj.x - pi.x) * (z - pi.z)) / (pj.z - pi.z) + pi.x;
                if (intersects) {
                    inside = !inside;
                }
            }
            return inside;
        }
    }
}

/**
 * `shape`'s own area, in world-units² — see ShapeResourcePlacement.density's own doc (that
 * file's one caller) for why a drawn AREA needs this at all: unlike a WorldSpawner tile
 * cluster (a known, countable number of cells — see DynamicResourcePlacement.density's own
 * doc), a rect/circle/polygon spawner has no discrete cell count to rate a density against
 * until it's actually measured. Exact for 'rect'/'circle'; 'polygon' uses the shoelace
 * formula (the standard exact-area formula for any simple, non-self-intersecting polygon —
 * which is all Tiled's own polygon draw tool ever produces) over `points` in their drawn
 * order, `Math.abs()`'d since the formula's sign otherwise flips with winding direction
 * (clockwise vs counter-clockwise), which isn't something a level designer thinks about
 * while drawing.
 */
export function shapeArea(shape: SpawnerShape): number {
    switch (shape.kind) {
        case 'circle':
            return Math.PI * shape.radius! * shape.radius!;
        case 'rect':
            return shape.halfWidth! * 2 * shape.halfDepth! * 2;
        case 'polygon': {
            const points = shape.points!;
            let sum = 0;
            for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
                sum += points[j].x * points[i].z - points[i].x * points[j].z;
            }
            return Math.abs(sum) / 2;
        }
    }
}

/** The axis-aligned world-space box sampleRandomPointInShape() rejection-samples within before testing isPointInShape() — tight for 'circle'/'rect' (every sampled point is already guaranteed inside for those, see that function's own doc), loose for 'polygon' (its own bounding box, since there's no cheaper uniform-sampling approach for an arbitrary shape). */
function boundsOfShape(shape: SpawnerShape): { minX: number; maxX: number; minZ: number; maxZ: number } {
    switch (shape.kind) {
        case 'circle':
            return { minX: shape.center.x - shape.radius!, maxX: shape.center.x + shape.radius!, minZ: shape.center.z - shape.radius!, maxZ: shape.center.z + shape.radius! };
        case 'rect':
            return { minX: shape.center.x - shape.halfWidth!, maxX: shape.center.x + shape.halfWidth!, minZ: shape.center.z - shape.halfDepth!, maxZ: shape.center.z + shape.halfDepth! };
        case 'polygon': {
            const points = shape.points!;
            return points.reduce(
                (b, p) => ({
                    minX: Math.min(b.minX, p.x), maxX: Math.max(b.maxX, p.x),
                    minZ: Math.min(b.minZ, p.z), maxZ: Math.max(b.maxZ, p.z),
                }),
                { minX: points[0].x, maxX: points[0].x, minZ: points[0].z, maxZ: points[0].z },
            );
        }
    }
}

/** One uniformly-random point inside `shape`, or undefined if `maxAttempts` of bounding-box rejection sampling all missed (only possible for 'polygon' — 'circle'/'rect' always succeed first try). Used by ShapeResourceSpawner.tryFillDensity() (roll a spawn point) and AnimalNode.pickNewWanderTarget() (roll a wander target) alike. */
export function sampleRandomPointInShape(shape: SpawnerShape, maxAttempts: number): { x: number; z: number } | undefined {
    if (shape.kind === 'circle') {
        // Closed-form disk sampling (sqrt(rand) so points aren't biased toward the center) —
        // always inside, no rejection needed.
        const angle = Math.random() * Math.PI * 2;
        const r = shape.radius! * Math.sqrt(Math.random());
        return { x: shape.center.x + Math.cos(angle) * r, z: shape.center.z + Math.sin(angle) * r };
    }
    if (shape.kind === 'rect') {
        return {
            x: shape.center.x + (Math.random() * 2 - 1) * shape.halfWidth!,
            z: shape.center.z + (Math.random() * 2 - 1) * shape.halfDepth!,
        };
    }

    const bounds = boundsOfShape(shape);
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const x = bounds.minX + Math.random() * (bounds.maxX - bounds.minX);
        const z = bounds.minZ + Math.random() * (bounds.maxZ - bounds.minZ);
        if (isPointInShape(shape, x, z)) {
            return { x, z };
        }
    }
    return undefined;
}

/** One stop on a waypoint path — see this file's own doc and getWaypoints(). */
export interface WaypointPlacement {
    /** This waypoint's position within its path — getWaypoints() always returns these sorted ascending, so index 0 of the returned array IS order 0 regardless of the order objects were drawn/exported in. */
    order: number;
    x: number;
    z: number;
}

export default class WorldObjectRegistry {
    /** type -> (id -> placement) — see this file's own doc. */
    private readonly byType = new Map<string, Map<string, WorldObjectPlacement>>();
    /** target (a dropper's "target" custom property, e.g. a BuildingId) -> that dropper's own placement — see getDropperFor(). */
    private readonly dropperPlacementsByTarget = new Map<string, WorldObjectPlacement>();
    /** target (a waypoint's "target" custom property, e.g. a queue id) -> every waypoint drawn for that path, sorted ascending by order once the constructor finishes — see getWaypoints(). */
    private readonly waypointsByTarget = new Map<string, WaypointPlacement[]>();
    /**
     * id -> EVERY spawner object drawn with that id, in the order they're stored in the map's
     * own layer data — see SpawnerShape's own doc and getShape()/getShapes()/getAllShapes().
     * Plural (not one-per-id) specifically so ShapeResourceSpawner.ts can treat "the same
     * shapeId drawn N times" as N independent spawn areas sharing one placement config
     * (e.g. "treeSpawner" drawn in five different forest clearings, one ShapeResourcePlacement
     * entry) instead of forcing a unique id — and a fresh, separately-budgeted count/density —
     * per clearing. Every OTHER mapSettings type (gate/building/queue/shop/craft/dropper)
     * still needs a genuinely UNIQUE id — this plural collection is intentionally spawner-only.
     */
    private readonly shapesById = new Map<string, SpawnerShape[]>();
    /** The map's single "playerStart" point, if drawn — see this file's own doc and getPlayerStart(). */
    private playerStartPlacement?: WorldObjectPlacement;

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

            // The player-start marker has no "type" at all (see this file's own doc) — checked
            // by "id" before the type-based waypoint/bucket handling below, since it wouldn't
            // survive either of those paths' own requirements.
            const objId = getObjectProperty(obj, 'id');
            if (objId === PLAYER_START_ID) {
                this.playerStartPlacement = objectToWorldRect(obj, tileDefs.tileSize, worldUnitsPerTile);
                console.log(`  - id="playerStart" -> world x=${this.playerStartPlacement.x.toFixed(2)} z=${this.playerStartPlacement.z.toFixed(2)}`);
                continue;
            }

            // Waypoints are keyed by "target"+"order", never "id" (see this file's own doc) —
            // handled entirely separately, before the id-requirement check every OTHER type
            // goes through below.
            if (type === WAYPOINT_TYPE) {
                this.registerWaypoint(obj, tileDefs.tileSize, worldUnitsPerTile);
                continue;
            }

            const id = objId;
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

            if (type === SPAWNER_TYPE) {
                const shape = this.readSpawnerShape(obj, tileDefs.tileSize, worldUnitsPerTile);
                // Appended, not set — see shapesById's own doc for why a spawner id
                // deliberately collects every instance instead of the last one silently
                // winning (the byType bucket above still only keeps the last placement per id,
                // but nothing reads that for a spawner-type object — see this file's own doc).
                let shapes = this.shapesById.get(id);
                if (!shapes) {
                    shapes = [];
                    this.shapesById.set(id, shapes);
                }
                shapes.push(shape);
                console.log(
                    `  - spawner "${id}"${shapes.length > 1 ? ` [instance ${shapes.length}]` : ''} -> kind=${shape.kind} center=(${shape.center.x.toFixed(2)}, ${shape.center.z.toFixed(2)})` +
                    (shape.kind === 'polygon' ? ` points=${shape.points!.length}` : shape.kind === 'circle' ? ` radius=${shape.radius!.toFixed(2)}` : ` halfWidth=${shape.halfWidth!.toFixed(2)} halfDepth=${shape.halfDepth!.toFixed(2)}`),
                );
            }

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

        // Sorted ONCE here rather than on every getWaypoints() call — see that method's own doc.
        for (const waypoints of this.waypointsByTarget.values()) {
            waypoints.sort((a, b) => a.order - b.order);
        }
    }

    /**
     * Converts a "spawner"-type TiledObject to its full world-space SpawnerShape — see that
     * interface's own doc for the kind-selection rule and rotation caveat. Mirrors
     * objectToWorldRect()'s pixel->world `scale` and rotation math (TileMapConfig.ts's own
     * doc), just applied per-vertex for a polygon instead of once for a rect's center.
     */
    private readSpawnerShape(obj: TiledObject, tileSizePx: number, worldUnitsPerTile: number): SpawnerShape {
        const scale = worldUnitsPerTile / tileSizePx;

        if (obj.polygon && obj.polygon.length > 0) {
            const rotationRad = (obj.rotation * Math.PI) / 180;
            const cos = Math.cos(rotationRad);
            const sin = Math.sin(rotationRad);

            const points = obj.polygon.map(p => {
                const rotatedX = p.x * cos - p.y * sin;
                const rotatedY = p.x * sin + p.y * cos;
                return { x: (obj.x + rotatedX) * scale, z: (obj.y + rotatedY) * scale };
            });
            const centroid = points.reduce((sum, p) => ({ x: sum.x + p.x / points.length, z: sum.z + p.z / points.length }), { x: 0, z: 0 });

            return { kind: 'polygon', center: centroid, points };
        }

        if (obj.ellipse) {
            const rect = objectToWorldRect(obj, tileSizePx, worldUnitsPerTile);
            return { kind: 'circle', center: { x: rect.x, z: rect.z }, radius: (rect.width + rect.depth) / 4 };
        }

        const rect = objectToWorldRect(obj, tileSizePx, worldUnitsPerTile);
        return { kind: 'rect', center: { x: rect.x, z: rect.z }, halfWidth: rect.width / 2, halfDepth: rect.depth / 2 };
    }

    /** Reads one waypoint object's "target"/"order" and appends it to that target's path — see this file's own doc. Warns and skips if either custom property is missing (a waypoint with no target/order can't be placed on any path at all). */
    private registerWaypoint(obj: TiledObject, tileSizePx: number, worldUnitsPerTile: number): void {
        const target = getObjectProperty(obj, WAYPOINT_TARGET_PROPERTY);
        const orderRaw = getObjectProperty(obj, WAYPOINT_ORDER_PROPERTY);
        if (!target || orderRaw === undefined) {
            console.warn(`[WorldObjectRegistry] waypoint #${obj.id} on "${OBJECTS_LAYER_NAME}" is missing its "${WAYPOINT_TARGET_PROPERTY}" or "${WAYPOINT_ORDER_PROPERTY}" custom property — skipping`);
            return;
        }

        const order = Number(orderRaw);
        if (Number.isNaN(order)) {
            console.warn(`[WorldObjectRegistry] waypoint #${obj.id}'s "${WAYPOINT_ORDER_PROPERTY}" ("${orderRaw}") isn't a number — skipping`);
            return;
        }

        const { x, z } = objectToWorldRect(obj, tileSizePx, worldUnitsPerTile);
        console.log(`  - type="waypoint" target="${target}" order=${order} -> world x=${x.toFixed(2)} z=${z.toFixed(2)}`);

        let waypoints = this.waypointsByTarget.get(target);
        if (!waypoints) {
            waypoints = [];
            this.waypointsByTarget.set(target, waypoints);
        }
        waypoints.push({ order, x, z });
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

    /** Every waypoint drawn for `target`'s path, sorted ascending by order (already sorted once at construction — see the constructor's own doc) — index 0 IS order 0. Empty array if `target` has no waypoints at all; callers (QuestGiverEntity.ts) treat fewer than 2 as "no usable path" themselves. */
    public getWaypoints(target: string): readonly WaypointPlacement[] {
        return this.waypointsByTarget.get(target) ?? [];
    }

    /** The FIRST world-space shape (see SpawnerShape's own doc) drawn for spawner `id` — e.g. "animalSpawner1" — or undefined if no such spawner object exists on the map at all. Prefer getShapes() (plural) for anything that should treat every same-id instance as its own independent area (see that method's own doc) — this singular form exists for a caller that genuinely only ever expects one (nothing left in this codebase actually does, but it's a reasonable single-shape convenience to keep). */
    public getShape(id: string): SpawnerShape | undefined {
        return this.shapesById.get(id)?.[0];
    }

    /**
     * EVERY spawner object drawn with `id` — e.g. five separate "treeSpawner" areas scattered
     * across different forest clearings, each its own independent SpawnerShape — see
     * shapesById's own doc for why a spawner id collects instances instead of the last one
     * winning. Empty array (not undefined) if no such spawner object exists on the map at
     * all, so a caller can `for...of` it with no existence check, same convention
     * getWaypoints() uses. This is the one ShapeResourceSpawner.ts actually calls.
     */
    public getShapes(id: string): readonly SpawnerShape[] {
        return this.shapesById.get(id) ?? [];
    }

    /** Every spawner id -> its FIRST shape found on the map — a fresh copy, same "no accidental live-state mutation" convention as getAllOfType(). See getShape()'s own doc for why this is the first instance, not every one. */
    public getAllShapes(): Map<string, SpawnerShape> {
        return new Map([...this.shapesById].map(([id, shapes]) => [id, shapes[0]]));
    }

    /** The map's "playerStart" point (see this file's own doc), or undefined if the level designer hasn't drawn one — the caller (PizzaScene) falls back to MainPlayer's own default position in that case. */
    public getPlayerStart(): WorldObjectPlacement | undefined {
        return this.playerStartPlacement;
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
