// PlaytestTuning.ts
//
// Config overrides from the page URL, for trying a balance change in a playtest without editing
// the source: `&set=<tab>.<id>.<field>=<value>` (repeat `&set=` for several). <tab> is the web
// editor's tab name (see TABS below), <id> the entry id, then any path into the entry —
// object keys or array indices, dot-separated. <value> is JSON (30, 1.5, true, "text", [..]),
// else taken as a plain string. Examples:
//
//   &set=animalStalls.cowStall.produceIntervalSec=30
//   &set=mixStations.butterStation.outputAmount=2
//   &set=stores.farmStore1.restockerWorker.levels.0.carryCapacity=2
//   &set=resources.milk.storeDemand=0.4
//
// An id the by-id table doesn't have yet starts as a copy of the tab's default entry (the same
// one the game falls back to). Applied once by index.ts before anything loads; whatever it changed
// is listed by getAppliedTuning() (shown in the playtest report). A bad path logs a console.error —
// which the playtest report surfaces.
//
// tools/playtest/run-playtest.mjs passes these through (--set, --compare).

import { ANIMAL_STALL_CONFIG_BY_ID, DEFAULT_ANIMAL_STALL_CONFIG } from '../data/AnimalStallTypes';
import { BUILDING_CONFIG } from '../data/BuildingTypes';
import { CROP_CONFIG } from '../data/CropTypes';
import { DEFAULT_FARM_DESK_CONFIG, FARM_DESK_CONFIG_BY_ID } from '../data/FarmDeskTypes';
import { DEFAULT_FARM_PLOT_CONFIG, FARM_PLOT_CONFIG_BY_ID } from '../data/FarmTypes';
import { DEFAULT_FARM_UPGRADE_CONFIG, FARM_UPGRADE_CONFIG_BY_ID } from '../data/FarmUpgradeTypes';
import { GATE_CONFIG } from '../data/GateTypes';
import { DEFAULT_MART_CONFIG, MART_CONFIG_BY_ID } from '../data/MartTypes';
import { DEFAULT_MIX_STATION_CONFIG, MIX_STATION_CONFIG_BY_ID } from '../data/MixStationTypes';
import { PLAYER_CONFIG_BY_ID } from '../data/PlayerConfig';
import { DEFAULT_QUEUE_CONFIG, QUEUE_CONFIG_BY_ID } from '../data/QueueTypes';
import { SEED_CONFIG } from '../data/SeedTypes';
import { DEFAULT_STORAGE_CONFIG, STORAGE_CONFIG_BY_ID } from '../data/StorageTypes';
import { ZONE_CONFIG } from '../data/ZoneTypes';
import { DEFAULT_STORE_CONFIG, STORE_CONFIG_BY_ID } from '../store/StoreTypes';
import { RESOURCE_CONFIG } from '../actions/ResourceTypes';
import { PROVIDER_CONFIG } from '../actions/ProviderTypes';
import { ACTION_CONFIG } from '../actions/ActionTypes';
import { SHOP_CONFIG_BY_ID } from '../shop/ShopTypes';

type Table = Record<string, unknown>;

/** Editor tab name -> the table its entries live in, and the default an unknown id starts from. */
const TABS: Record<string, { table: Table; fallback?: unknown }> = {
    stores: { table: STORE_CONFIG_BY_ID as Table, fallback: DEFAULT_STORE_CONFIG },
    storages: { table: STORAGE_CONFIG_BY_ID as Table, fallback: DEFAULT_STORAGE_CONFIG },
    animalStalls: { table: ANIMAL_STALL_CONFIG_BY_ID as Table, fallback: DEFAULT_ANIMAL_STALL_CONFIG },
    mixStations: { table: MIX_STATION_CONFIG_BY_ID as Table, fallback: DEFAULT_MIX_STATION_CONFIG },
    farms: { table: FARM_PLOT_CONFIG_BY_ID as Table, fallback: DEFAULT_FARM_PLOT_CONFIG },
    farmUpgrades: { table: FARM_UPGRADE_CONFIG_BY_ID as Table, fallback: DEFAULT_FARM_UPGRADE_CONFIG },
    farmDesks: { table: FARM_DESK_CONFIG_BY_ID as Table, fallback: DEFAULT_FARM_DESK_CONFIG },
    queues: { table: QUEUE_CONFIG_BY_ID as Table, fallback: DEFAULT_QUEUE_CONFIG },
    marts: { table: MART_CONFIG_BY_ID as Table, fallback: DEFAULT_MART_CONFIG },
    shops: { table: SHOP_CONFIG_BY_ID as Table },
    buildings: { table: BUILDING_CONFIG as unknown as Table },
    crops: { table: CROP_CONFIG as unknown as Table },
    seeds: { table: SEED_CONFIG as unknown as Table },
    gates: { table: GATE_CONFIG as unknown as Table },
    zones: { table: ZONE_CONFIG as unknown as Table },
    playerConfig: { table: PLAYER_CONFIG_BY_ID as Table },
    resources: { table: RESOURCE_CONFIG as unknown as Table },
    providers: { table: PROVIDER_CONFIG as unknown as Table },
    actions: { table: ACTION_CONFIG as unknown as Table },
};

const applied: string[] = [];

/** Every `&set=` in the page URL, applied in order — see this file's own doc. */
export function applyTuningFromUrl(): void {
    for (const entry of new URLSearchParams(window.location.search).getAll('set')) {
        const eq = entry.indexOf('=');
        if (eq <= 0) {
            console.error(`[PlaytestTuning] "${entry}" isn't <tab>.<id>.<path>=<value> — ignored`);
            continue;
        }
        applyOne(entry.slice(0, eq).trim(), entry.slice(eq + 1).trim());
    }
    if (applied.length > 0) {
        console.log(`[PlaytestTuning] ${applied.join(' · ')}`);
    }
}

/** What applyTuningFromUrl() changed — "path: old -> new" per override. */
export function getAppliedTuning(): readonly string[] {
    return applied;
}

function applyOne(path: string, rawValue: string): void {
    const [tabName, id, ...rest] = path.split('.');
    const tab = TABS[tabName];
    if (!tab || !id || rest.length === 0) {
        console.error(`[PlaytestTuning] "${path}": unknown tab or no field (tabs: ${Object.keys(TABS).join(', ')}) — ignored`);
        return;
    }
    if (tab.table[id] === undefined) {
        if (tab.fallback === undefined) {
            console.error(`[PlaytestTuning] "${path}": no "${id}" in ${tabName} — ignored`);
            return;
        }
        tab.table[id] = structuredClone(tab.fallback);
    }
    let target = tab.table[id] as Table;
    for (const key of rest.slice(0, -1)) {
        if (target[key] === undefined || target[key] === null || typeof target[key] !== 'object') {
            console.error(`[PlaytestTuning] "${path}": "${key}" isn't an object/array there — ignored`);
            return;
        }
        target = target[key] as Table;
    }
    const field = rest[rest.length - 1];
    const value = parseValue(rawValue);
    const before = JSON.stringify(target[field]);
    target[field] = value;
    applied.push(`${path}: ${before ?? 'unset'} -> ${JSON.stringify(value)}`);
}

function parseValue(raw: string): unknown {
    try {
        return JSON.parse(raw);
    } catch {
        return raw;
    }
}
