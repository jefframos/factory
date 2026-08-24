// GameDataBaker.ts
//
// Dumps every hand-authored DESIGN NUMBER in the game (resources, actions,
// items, crafting tables, shops, queues, buildings, gates, dynamic resource
// placements) into one plain JSON object, and offers a browser-download
// helper for it. Deliberately excludes two kinds of things:
//  - live/persisted player state (BackpackStorage, ShopUpgradeStorage, ...)
//    — so the output is always the same "what does this game contain"
//    snapshot regardless of any save data;
//  - view/presentation data (glb model paths, mesh size/color, icons, hand
//    offsets, tool visuals, AssetLibraryRegistry entirely) — design only
//    needs the numbers/requirements/labels that describe what the game
//    DOES, not how any of it is drawn. Each section below is picked
//    explicitly (no `...config` spreads) so a new visual field added to a
//    config type doesn't silently leak into the bake.
//
// Wired to a dev-GUI button (see PizzaScene.setupDebugGui()) rather than
// exposed any other way — this is a design/tooling aid, not a player-facing
// feature.

import { BUILDING_CONFIG } from '../data/BuildingTypes';
import { GATE_CONFIG } from '../data/GateTypes';
import { DEFAULT_QUEUE_CONFIG, QUEUE_CONFIG_BY_ID } from '../data/QueueTypes';
import { CRAFT_CONFIG_BY_ID } from '../crafting/CraftTypes';
import { ITEM_CONFIG } from '../crafting/ItemTypes';
import { BASE_ACTION_CONFIG } from '../actions/ActionTypes';
import { RESOURCE_CONFIG } from '../actions/ResourceTypes';
import { PROVIDER_CONFIG } from '../actions/ProviderTypes';
import { SHOP_CONFIG_BY_ID } from '../shop/ShopTypes';
import { DYNAMIC_RESOURCE_PLACEMENTS } from '../world/DynamicResourceTypes';

/** Plain JSON-serializable snapshot of every hand-authored design NUMBER in the game — see this file's own doc for what's deliberately excluded (live player state, all view/presentation data). */
export interface BakedGameData {
    resources: unknown;
    providers: unknown;
    dynamicResourcePlacements: unknown;
    actions: unknown;
    items: unknown;
    crafting: unknown;
    shops: unknown;
    queues: {
        default: unknown;
        byId: unknown;
    };
    buildings: unknown;
    gates: unknown;
}

/**
 * Builds the full design-data snapshot. Each section strips a specific config type down to
 * its non-visual fields (see this file's own doc) rather than spreading the config object
 * wholesale, so mesh/color/model/icon fields never end up in the output even as new configs
 * get added.
 */
export function bakeGameData(): BakedGameData {
    return {
        resources: mapRecord(RESOURCE_CONFIG, r => ({
            amountPerGather: r.amountPerGather,
            label: r.label,
        })),
        providers: mapRecord(PROVIDER_CONFIG, p => ({
            action: p.action,
            maxLife: p.maxLife,
            amountPerGather: p.amountPerGather,
            respawnSec: p.respawnSec,
            label: p.label,
            drops: p.drops,
        })),
        dynamicResourcePlacements: DYNAMIC_RESOURCE_PLACEMENTS.map(p => ({
            resourceType: p.resourceType,
            spawnerTileType: p.spawnerTileType,
            density: p.density,
            minDistance: p.minDistance,
            checkIntervalSec: p.checkIntervalSec,
        })),
        // BASE_ACTION_CONFIG (the hand-authored defaults), not the live ACTION_CONFIG, since
        // the live object is mutated by shop upgrades at runtime — a design dump should
        // reflect the authored base, not whatever level this session's save happens to be at
        // (the upgrade ladder itself is already fully captured in `shops`).
        actions: mapRecord(BASE_ACTION_CONFIG, a => ({
            hitIntervalSec: a.hitIntervalSec,
            hitScale: a.hitScale,
            resourcePerHit: a.resourcePerHit,
            cancelOnLeaveRange: a.cancelOnLeaveRange,
            tool: a.tool,
        })),
        items: mapRecord(ITEM_CONFIG, i => ({
            label: i.label,
        })),
        crafting: mapRecord(CRAFT_CONFIG_BY_ID, c => ({
            name: c.name,
            recipes: c.recipes,
            destroyOnComplete: c.destroyOnComplete,
            appearRequirement: c.appearRequirement,
        })),
        shops: mapRecord(SHOP_CONFIG_BY_ID, s => ({
            name: s.name,
            tool: s.tool,
            action: s.action,
            levels: s.levels,
            appearRequirement: s.appearRequirement,
        })),
        queues: {
            default: {
                cooldownSec: DEFAULT_QUEUE_CONFIG.cooldownSec,
                possibleTasks: DEFAULT_QUEUE_CONFIG.possibleTasks,
            },
            byId: mapRecord(QUEUE_CONFIG_BY_ID, q => ({
                cooldownSec: q.cooldownSec,
                possibleTasks: q.possibleTasks,
                appearRequirement: q.appearRequirement,
            })),
        },
        buildings: mapRecord(BUILDING_CONFIG, b => ({
            name: b.name,
            levels: b.levels.map(l => ({
                level: l.level,
                requirements: l.requirements,
                effect: l.effect,
            })),
            appearRequirement: b.appearRequirement,
        })),
        gates: mapRecord(GATE_CONFIG, g => ({
            name: g.name,
            requirement: g.requirement,
        })),
    };
}

/** Maps every present value of a (possibly partial) record through `fn`, skipping undefined entries — the shape every *_CONFIG_BY_ID map (Partial<Record<string, ...>>) needs. */
function mapRecord<K extends string, V, R>(record: Partial<Record<K, V>>, fn: (value: V) => R): Record<K, R> {
    const result = {} as Record<K, R>;
    for (const [key, value] of Object.entries(record) as [K, V | undefined][]) {
        if (value !== undefined) {
            result[key] = fn(value);
        }
    }
    return result;
}

/**
 * Serializes bakeGameData() and triggers a browser file-save via a throwaway Blob URL +
 * `<a download>` click — no existing "download a file to disk" helper elsewhere in the
 * repo to reuse (see GzipLoader.ts's Blob usage, which goes the opposite direction:
 * bytes -> loader-consumable URL, not data -> user's disk). The anchor is never attached
 * to the DOM; `.click()` works on a detached element in every evergreen browser.
 */
export function downloadGameData(): void {
    const data = bakeGameData();
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `pizza-game-data-${Date.now()}.json`;
    anchor.click();

    URL.revokeObjectURL(url);
}
