// MeshLayerSpawner.ts
//
// Reads the Tiled map's "meshes" objectgroup layer — where a level designer
// drops a ModelSnapshotTool-generated PNG as a placeholder object (drag the
// downloaded snapshot onto an object layer in Tiled; Tiled auto-creates a
// one-tile "image collection" tileset for it, see TileMapConfig.ts's
// TiledTileset.tiles doc) — decodes each placed image's filename back to a
// MODELS registry ref (see ModelSnapshotTool.decodeModelRef()), and hands
// back where/how to spawn the REAL 3D model in its place. The PNG itself
// never renders in-game; it only ever stood in for the model inside Tiled.
//
// Each placement also carries the OBJECT'S OWN world-space width/depth
// (`worldWidth`/`worldDepth`, converted from its CURRENT Tiled width/
// height) rather than assuming the model should spawn at native scale.
// ModelSnapshotTool renders a snapshot at a fixed pixels-per-world-unit
// matching the map's own tile grid, so a NEVER-resized placeholder's pixel
// size already reflects the model's native footprint — but a level
// designer routinely drags an object's corners to fit it to a specific
// spot once it's placed, and that resize has to actually reach the real
// model too, or the placeholder and the thing that replaces it silently
// stop matching. PizzaScene.setupMeshLayer() is what turns worldWidth/
// worldDepth into an actual uniform scale factor, once the model's own
// UNROTATED native bounding box is known (see that method's own doc for
// why it has to measure before applying rotation).
//
// Built lazily, on demand (getMeshPlacements(), not a class with its own
// constructor-time parse like WorldObjectRegistry) — there's no per-id
// lookup need here, PizzaScene just wants "everything on this layer, right
// now," once, at scene build.

import { DEFAULT_TILE_MAP_ALIASES, getObjectBooleanProperty, getTiledTileBooleanProperty, loadTiledMap, loadTileDefs, resolveTiledTileImageName, WORLD_UNITS_PER_TILE } from './TileMapConfig';
import { ModelSnapshotTool } from '../debug/ModelSnapshotTool';

/** Tiled layer name holding hand-placed model-snapshot placeholder objects — see this file's own doc. */
export const MESH_LAYER_NAME = 'meshes';

/**
 * Custom BOOL property (Tiled's "Custom Properties" panel, type "bool") that makes a placed
 * mesh block the player — see PizzaScene.setupMeshLayer()'s own doc for the RigidBody this
 * adds. Checked in TWO places, either one wins: on the TILE definition itself (right-click the
 * tile in the tileset -> "Tile Properties" — the normal place for this, since "is this crate
 * solid" is a property of the crate art, not of one particular placed copy of it — see
 * TiledTileset.tiles' own doc), or on one specific placed OBJECT (an override/exception for
 * that one instance only). Neither set means "purely decorative," same as every mesh placement
 * before this property existed.
 */
const SOLID_PROPERTY = 'solid';

export interface MeshPlacement {
    /** "Group.Key" — see ModelSnapshotTool.resolveModelDef(), the one thing this ref is for. */
    modelRef: string;
    x: number;
    z: number;
    /** Radians, THREE Y-axis yaw — converted from Tiled's clockwise-degrees `rotation`. */
    rotationY: number;
    /** This object's CURRENT world-space footprint (its Tiled width/height, converted) — see this file's own doc on why a resize in Tiled has to reach the spawned model, not just its own placeholder image. */
    worldWidth: number;
    worldDepth: number;
    /** This object's own "solid" custom property (see SOLID_PROPERTY's own doc) — false unless a level designer explicitly checked it. */
    solid: boolean;
}

/**
 * Every mesh placeholder currently drawn on the "meshes" layer, decoded and converted to world
 * space — an object whose image doesn't decode to a KNOWN model ref (not one of
 * ModelSnapshotTool's own snapshots, or one whose model got renamed/removed since) is skipped
 * with a warning rather than spawning a mystery blank. Missing layer entirely (a map with no
 * "meshes" objects drawn yet) just returns an empty array, same "optional, not an error"
 * convention as WorldObjectRegistry's own missing-layer handling.
 */
export function getMeshPlacements(
    mapAlias: string = DEFAULT_TILE_MAP_ALIASES.map,
    tilesAlias: string = DEFAULT_TILE_MAP_ALIASES.tiles,
    worldUnitsPerTile: number = WORLD_UNITS_PER_TILE,
): MeshPlacement[] {
    const map = loadTiledMap(mapAlias);
    const layer = map.layers.find(l => l.type === 'objectgroup' && l.name === MESH_LAYER_NAME);
    if (!layer?.objects) {
        return [];
    }

    const tileDefs = loadTileDefs(tilesAlias);
    const scale = worldUnitsPerTile / tileDefs.tileSize;
    const placements: MeshPlacement[] = [];

    for (const obj of layer.objects) {
        if (!obj.gid) {
            continue;
        }

        const imageName = resolveTiledTileImageName(map, obj.gid);
        const modelRef = imageName ? ModelSnapshotTool.decodeModelRef(imageName) : undefined;
        if (!modelRef || !ModelSnapshotTool.resolveModelDef(modelRef)) {
            console.warn(`[MeshLayerSpawner] object #${obj.id} on "${MESH_LAYER_NAME}" (image "${imageName ?? '?'}") doesn't decode to a known model — skipping`);
            continue;
        }

        // Tile objects are anchored at their BOTTOM-left in Tiled (`(obj.x, obj.y)`), unlike a
        // plain rectangle object's top-left — see TiledObject.gid's own doc. Critically,
        // Tiled's `rotation` pivots around THAT ORIGIN, not the rectangle's center — rotating a
        // placed object in Tiled swings its whole footprint around its bottom-left corner, the
        // same way a tile layer cell would. So the true center isn't the fixed
        // `(width/2, -height/2)` offset a rotation=0 object would have; that offset itself has
        // to be rotated (by the SAME angle, around the SAME origin) before being added back to
        // (obj.x, obj.y) — skipping this (as an earlier version of this file did) put every
        // rotated placement in the wrong spot, more so the further from 0°/180° its rotation was.
        const rotationRad = (obj.rotation * Math.PI) / 180;
        const cos = Math.cos(rotationRad);
        const sin = Math.sin(rotationRad);
        const localCenterX = obj.width / 2;
        const localCenterY = -obj.height / 2;
        // Standard 2D rotation matrix, applied directly in Tiled's own pixel space (x right, y
        // DOWN) — that y-down basis is what makes this formula already match Tiled's own
        // clockwise-positive `rotation` with no extra sign flip needed here (unlike rotationY
        // below, which crosses into THREE's y-UP/right-handed convention and DOES need one).
        const rotatedCenterX = localCenterX * cos - localCenterY * sin;
        const rotatedCenterY = localCenterX * sin + localCenterY * cos;
        const centerXpx = obj.x + rotatedCenterX;
        const centerYpx = obj.y + rotatedCenterY;

        placements.push({
            modelRef,
            x: centerXpx * scale,
            z: centerYpx * scale,
            // Tiled's `rotation` is clockwise degrees as viewed in its own top-down 2D
            // editor; THREE's +Y-axis rotation is counter-clockwise when viewed from above
            // (looking down -Y) by the right-hand rule — hence the sign flip. Best-effort:
            // flip this if a rotated placement still reads mirrored in practice.
            rotationY: -rotationRad,
            worldWidth: obj.width * scale,
            worldDepth: obj.height * scale,
            solid: getObjectBooleanProperty(obj, SOLID_PROPERTY) || getTiledTileBooleanProperty(map, obj.gid, SOLID_PROPERTY),
        });
    }

    return placements;
}
