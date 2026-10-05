// StoreLayerNames.ts
//
// Tiled object-layer naming for everything that belongs to one store, so a level designer can
// isolate/toggle a store's layers together in Tiled. The part after the prefix groups the layers
// (by convention the store's starter building id, e.g. "stall1"):
//
//   --store--stall1          the store itself: area, entrance/exit, cashier, money drop, NPC
//                            points (see StoreLayout.ts). Same content the old "stores" layer had.
//   --storeView--stall1      the store building's look: EVERY model on this layer is a piece of
//                            building `stall1` — no per-piece type/id/useOwnMesh props (see
//                            WorldObjectRegistry.readStoreViewLayers()). Here the suffix IS the
//                            building id, up to its first "-": add more layers for the same
//                            building as "--storeView--stall1-2", "--storeView--stall1-floor", ...
//                            and all their pieces merge (e.g. the floor on its own layer).
//                            A plain rect with "type"="floor" is a checker floor — one mesh for
//                            the whole rect instead of one model per tile, painted with the
//                            store's floor checker (StoreViewTypes.ts, editor: Store View tab).
//   --storeSection--stall1   the store's buildable sections (see WorldObjectRegistry's
//                            SECTIONS_LAYER_NAME doc). Same content the old "sections" layer had.
//
// The old plain "stores"/"sections" layer names keep working.
//
// Mirrored in web/sync/tiledMap.mjs (the editor reads the map the same way).

import type { TiledMapData } from './TileMapConfig';

export const STORE_LAYER_PREFIX = '--store--';
export const STORE_VIEW_LAYER_PREFIX = '--storeView--';
export const STORE_SECTION_LAYER_PREFIX = '--storeSection--';

/** Pre-prefix layer names, still read. */
const LEGACY_STORES_LAYER_NAME = 'stores';
const LEGACY_SECTIONS_LAYER_NAME = 'sections';

type TiledLayer = TiledMapData['layers'][number];

function objectLayers(map: TiledMapData, matches: (name: string) => boolean): TiledLayer[] {
    return map.layers.filter(layer => layer.type === 'objectgroup' && typeof layer.name === 'string' && matches(layer.name));
}

/** Every store layer — "--store--*" plus the legacy "stores". */
export function getStoreLayers(map: TiledMapData): TiledLayer[] {
    return objectLayers(map, name => name.startsWith(STORE_LAYER_PREFIX) || name === LEGACY_STORES_LAYER_NAME);
}

/** Object types StoreLayout.ts reads off a store layer itself (the store's own area/parts/NPC points). Counter meshes there carry no type at all. */
const STORE_LAYOUT_TYPES: ReadonlySet<string> = new Set(['store', 'storeEntrance', 'storeExit', 'storeCashier', 'storeMoneyDrop', 'npcPoint']);

/**
 * Every OTHER typed object on the store layers — e.g. the store's storages and trash bin — so they
 * can live on "--store--stall1" next to the store they belong to instead of on mapSettings.
 * WorldObjectRegistry reads these exactly like mapSettings objects (same type/id/dropper rules).
 */
export function getStoreLayerMapObjects(map: TiledMapData): NonNullable<TiledLayer['objects']> {
    return getStoreLayers(map)
        .flatMap(layer => layer.objects ?? [])
        .filter(obj => {
            const type = obj.properties?.find(p => p.name === 'type')?.value;
            return typeof type === 'string' && !STORE_LAYOUT_TYPES.has(type);
        });
}

/** Every section layer — "--storeSection--*" plus legacy layers whose name contains "sections". */
export function getStoreSectionLayers(map: TiledMapData): TiledLayer[] {
    return objectLayers(map, name => name.startsWith(STORE_SECTION_LAYER_PREFIX) || name.includes(LEGACY_SECTIONS_LAYER_NAME));
}

/**
 * The building id a "--storeView--" layer name carries — everything up to the first "-" after
 * the prefix, so several layers can feed the same building: "--storeView--stall1",
 * "--storeView--stall1-2" and "--storeView--stall1-floor" are all building "stall1" (the rest
 * is just a label to tell the layers apart in Tiled). Building ids therefore can't contain "-".
 */
export function storeViewBuildingId(layerName: string): string {
    return layerName.slice(STORE_VIEW_LAYER_PREFIX.length).split('-')[0];
}

/** Every "--storeView--<buildingId>[-anything]" layer, with the building id its name carries — see storeViewBuildingId(). Several layers may share one building; their pieces are merged. */
export function getStoreViewLayers(map: TiledMapData): { buildingId: string; layer: TiledLayer }[] {
    return objectLayers(map, name => name.startsWith(STORE_VIEW_LAYER_PREFIX))
        .map(layer => ({ buildingId: storeViewBuildingId(layer.name), layer }))
        .filter(entry => entry.buildingId.length > 0);
}
