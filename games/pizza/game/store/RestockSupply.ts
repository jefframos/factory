// RestockSupply.ts
//
// Where store RESTOCKER workers (StoreRestockerWorker.ts) pick items up to refill shelves:
//   - every ripe farm cell (FarmPlotTile.getAll()) — crops;
//   - every registered supply STORAGE — an animal stall's box (eggs, milk) or a mix station's
//     dispenser (butter, bread): PizzaScene registers one per built stall/station
//     (StorageSupplySource), and a restocker takes one item at a time out of its StorageInventory.
// Store.ts claims sources per worker (one restocker per source at a time) — see
// Store.claimReadySource().

import * as THREE from 'three';
import { ResourceType } from '../actions/ResourceTypes';
import { StorageInventory } from '../data/StorageInventory';
import FarmPlotTile from '../world/FarmPlotTile';

export interface RestockYield {
    resourceType: ResourceType;
    amount: number;
}

/** One place a restocker can pick items up from. */
export interface RestockSource {
    /** Where the worker walks to pick up (the nav grid snaps it next to a solid source). */
    readonly walkPoint: THREE.Vector3;
    /** Where picked items fly from toward its back. */
    readonly launchPoint: THREE.Vector3;
    /** What one pickup would give right now — undefined when there's nothing. */
    getReadyYield(): RestockYield | undefined;
    /** Takes one pickup — undefined if it's gone by now. */
    takeForWorker(): RestockYield | undefined;
}

/** Ripe crops fly from this high above the cell. */
const FARM_LAUNCH_HEIGHT = 0.4;

/** A farm cell as a RestockSource — cached per cell so claims (keyed by source) stay stable. */
const farmSources = new WeakMap<FarmPlotTile, RestockSource>();
function farmSource(tile: FarmPlotTile): RestockSource {
    let source = farmSources.get(tile);
    if (!source) {
        source = {
            walkPoint: tile.transform.position,
            launchPoint: tile.transform.position.clone().setY(tile.transform.position.y + FARM_LAUNCH_HEIGHT),
            getReadyYield: () => tile.getReadyYield(),
            takeForWorker: () => tile.harvestForWorker(),
        };
        farmSources.set(tile, source);
    }
    return source;
}

/** A storage something else fills (a stall's box, a mix station's dispenser) — one item per pickup. */
export class StorageSupplySource implements RestockSource {
    public readonly walkPoint: THREE.Vector3;
    public readonly launchPoint: THREE.Vector3;
    private readonly storageId: string;
    private readonly resourceType: ResourceType;

    public constructor(storageId: string, resourceType: ResourceType, walkPoint: THREE.Vector3, launchPoint: THREE.Vector3) {
        this.storageId = storageId;
        this.resourceType = resourceType;
        this.walkPoint = walkPoint;
        this.launchPoint = launchPoint;
    }

    public getReadyYield(): RestockYield | undefined {
        return StorageInventory.getCount(this.storageId, this.resourceType) > 0 ? { resourceType: this.resourceType, amount: 1 } : undefined;
    }

    public takeForWorker(): RestockYield | undefined {
        return StorageInventory.remove(this.storageId, this.resourceType, 1) > 0 ? { resourceType: this.resourceType, amount: 1 } : undefined;
    }
}

const supplies: RestockSource[] = [];

export const RestockSupply = {
    /** A built stall's box / mix station's dispenser becomes a source (see this file's own doc). */
    register(source: RestockSource): void {
        supplies.push(source);
    },

    /** Every source right now — farm cells first, then the registered storages. */
    getAll(): RestockSource[] {
        return [...[...FarmPlotTile.getAll()].map(farmSource), ...supplies];
    },
};
