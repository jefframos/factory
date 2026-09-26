// StoreLayout.ts
//
// Reads the Tiled map's "stores" objectgroup layer — kept separate from
// WorldObjectRegistry (which only reads "mapSettings") so this feature adds
// nothing to that registry. Every object there carries a "type" custom
// property:
//   - store:          the store's own area (its "id" is the store id). An
//                     optional "starter" property names a building
//                     (BuildingId) that must be built before the store opens.
//   - storeEntrance:  where clients spawn          ("target" = store id)
//   - storeExit:      where clients despawn        ("target" = store id)
//   - storeCashier:   where the player serves      ("target" = store id)
//   - storeMoneyDrop: where paid money piles up    ("target" = store id)
//
// The storages a store sells from are NOT drawn here — they're the regular
// "storage" objects on mapSettings whose position falls inside the store's
// area (see Store.ts), so adding a new storage inside a store is all it
// takes for clients to start asking for its item.

import {
    DEFAULT_TILE_MAP_ALIASES,
    WORLD_UNITS_PER_TILE,
    getObjectProperty,
    loadTileDefs,
    loadTiledMap,
    objectToWorldRect,
} from '../world/TileMapConfig';

export const STORES_LAYER_NAME = 'stores';

/** World-space rect, centered at x/z — same shape as WorldObjectPlacement. */
export interface StoreRect {
    x: number;
    z: number;
    width: number;
    depth: number;
}

export interface StoreLayout {
    id: string;
    area: StoreRect;
    /** BuildingId that must reach level 1 before clients start coming — undefined = open from the start. */
    starter?: string;
    entrance: StoreRect;
    exit: StoreRect;
    cashier: StoreRect;
    moneyDrop: StoreRect;
}

type StorePartType = 'storeEntrance' | 'storeExit' | 'storeCashier' | 'storeMoneyDrop';
const PART_TYPES: readonly StorePartType[] = ['storeEntrance', 'storeExit', 'storeCashier', 'storeMoneyDrop'];

/** Every fully-drawn store on the map — a store missing any of its four parts is skipped with a warning. */
export function readStoreLayouts(
    mapAlias: string = DEFAULT_TILE_MAP_ALIASES.map,
    tilesAlias: string = DEFAULT_TILE_MAP_ALIASES.tiles,
): StoreLayout[] {
    const map = loadTiledMap(mapAlias);
    const tileSize = loadTileDefs(tilesAlias).tileSize;
    const layer = map.layers.find(l => l.type === 'objectgroup' && l.name === STORES_LAYER_NAME);
    if (!layer?.objects) {
        return [];
    }

    const areas = new Map<string, StoreRect>();
    const starters = new Map<string, string>();
    const parts = new Map<string, Partial<Record<StorePartType, StoreRect>>>();

    for (const obj of layer.objects) {
        const type = getObjectProperty(obj, 'type');
        const { x, z, width, depth } = objectToWorldRect(obj, tileSize, WORLD_UNITS_PER_TILE);
        const rect: StoreRect = { x, z, width, depth };

        if (type === 'store') {
            const id = getObjectProperty(obj, 'id');
            if (!id) {
                console.warn(`[StoreLayout] store object #${obj.id} has no "id" — skipping`);
                continue;
            }
            areas.set(id, rect);
            const starter = getObjectProperty(obj, 'starter');
            if (starter) {
                starters.set(id, starter);
            }
        } else if (type && (PART_TYPES as readonly string[]).includes(type)) {
            const target = getObjectProperty(obj, 'target');
            if (!target) {
                console.warn(`[StoreLayout] ${type} object #${obj.id} has no "target" — skipping`);
                continue;
            }
            const entry = parts.get(target) ?? {};
            entry[type as StorePartType] = rect;
            parts.set(target, entry);
        }
    }

    const layouts: StoreLayout[] = [];
    for (const [id, area] of areas) {
        const p = parts.get(id) ?? {};
        const missing = PART_TYPES.filter(type => !p[type]);
        if (missing.length > 0) {
            console.warn(`[StoreLayout] store "${id}" is missing ${missing.join(', ')} — skipping`);
            continue;
        }
        layouts.push({
            id,
            area,
            starter: starters.get(id),
            entrance: p.storeEntrance!,
            exit: p.storeExit!,
            cashier: p.storeCashier!,
            moneyDrop: p.storeMoneyDrop!,
        });
    }
    return layouts;
}

export function rectContains(rect: StoreRect, x: number, z: number): boolean {
    return Math.abs(x - rect.x) <= rect.width / 2 && Math.abs(z - rect.z) <= rect.depth / 2;
}

/** A random point inside `rect`, kept `inset` world units away from its edges when it's big enough. */
export function randomPointInRect(rect: StoreRect, inset = 0.5): { x: number; z: number } {
    const halfW = Math.max(0, rect.width / 2 - inset);
    const halfD = Math.max(0, rect.depth / 2 - inset);
    return {
        x: rect.x + (Math.random() * 2 - 1) * halfW,
        z: rect.z + (Math.random() * 2 - 1) * halfD,
    };
}
