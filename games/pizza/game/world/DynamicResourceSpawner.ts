// DynamicResourceSpawner.ts
//
// Scatters loose, dynamically-spawned resources (see DynamicResourceTypes.ts
// — currently just a test "bark") across WorldSpawner's own tile
// clusters, one config-driven bucket at a time — but, unlike a plain
// "spawn N and forget," every instance is tracked as PERSISTED DATA
// (DynamicResourceStorage.ts) independent of whether it's currently
// rendered, and only gets a live LooseResourceNode (mesh + physics) while
// the player is actually nearby. Same load/unload-radius streaming idea
// WorldManager.ts already uses for map-painted resources, reusing the exact
// same PERFORMANCE_CONFIG.resourceLoadRadius/resourceUnloadRadius knobs (and
// their dev-GUI sliders) rather than inventing a second, parallel radius
// setting — an area nobody's near never carries a live mesh OR live physics,
// no matter how much loot has actually been reserved there.
//
// This is also what makes reload-persistence and "only spawn near the
// player" the SAME mechanism rather than two separate features: a cell only
// ever gets reserved (DynamicResourceStorage.addRecord()) at the moment it's
// actually spawned, which itself only happens within loadRadius of wherever
// the player is standing RIGHT NOW — so the persisted record set for a
// config is always exactly "whatever's near player(s) at some point," never
// a precomputed layout for the whole map. A cell's reservation survives
// however long it takes the player to wander back (see the constructor,
// which reads every already-persisted record back in before anything else
// happens) — it does NOT survive being picked up (see handleConsumed()).
//
// Every DYNAMIC_RESOURCE_CONFIG entry gets its own independent runtime
// state (its own record list + a countdown to its next density check) —
// configs never compete for each other's density budget or interfere with
// each other's minDistance check.
//
// update(playerPosition, delta) does two independent things per config,
// every call:
//   1. Streams materialize/dematerialize for every record already known
//      about (persisted or freshly spawned) — see the load/unload radius
//      doc above.
//   2. Ticks that config's own checkIntervalSec countdown; once it elapses,
//      tryFillDensity() re-rolls it and tops the NEARBY record count up
//      toward `density`'s own target (see DynamicResourceTypes.ts), one
//      candidate cell at a time, skipping any that fails the minDistance
//      check against every record of that config (not just rendered ones).
//      The very first call (countdown starts at 0 — see the constructor)
//      does this immediately, which is what seeds an area up to its target
//      density the moment the player first arrives, with no separate
//      "starting density" step required.

import * as THREE from 'three';
import World from '../ecs/World';
import LooseResourceNode from '../player/LooseResourceNode';
import { ScreenAnchorHost } from '../components/ScreenAnchorComponent';
import { tileCellToWorldPosition, WORLD_UNITS_PER_TILE } from './TileMapConfig';
import WorldSpawner from './WorldSpawner';
import { DYNAMIC_RESOURCE_CONFIG, DynamicResourceConfig } from './DynamicResourceTypes';
import { DynamicResourceStorage } from './DynamicResourceStorage';
import { PERFORMANCE_CONFIG } from '../config/PerformanceConfig';

/** Upper bound on how many candidate cells tryFillDensity() will roll through in a single check — a cheap backstop against an unlucky run of minDistance misses, not a normal-case limit (a healthy area fills well within this). */
const MAX_ATTEMPTS_PER_CHECK = 40;

interface RuntimeRecord {
    col: number;
    row: number;
    position: THREE.Vector3;
    /** Only set while the player is within resourceLoadRadius of this record — see update(). */
    node?: LooseResourceNode;
}

interface DynamicResourceState {
    readonly config: DynamicResourceConfig;
    readonly records: RuntimeRecord[];
    /** Seconds remaining until the next density check for this config — see update(). */
    checkTimerSec: number;
}

export default class DynamicResourceSpawner {
    private readonly states: DynamicResourceState[];
    /** Every eligible (col, row) cell for a given spawnerTileType, resolved ONCE from WorldSpawner (the map's own painted layout never changes at runtime) — see collectCellsForType(). Populated lazily per distinct spawnerTileType actually used by a config, not eagerly for every cluster on the map. */
    private readonly cellsByTileType = new Map<string, { col: number; row: number; position: THREE.Vector3 }[]>();

    public constructor(
        private readonly world: World,
        private readonly threeScene: THREE.Scene,
        private readonly screenHost: ScreenAnchorHost,
        private readonly worldSpawner: WorldSpawner,
        configs: readonly DynamicResourceConfig[] = DYNAMIC_RESOURCE_CONFIG,
    ) {
        // Starts every config's countdown at 0 rather than checkIntervalSec — see this file's
        // own doc on why that's what seeds an area up to its target density the instant the
        // player first gets near it, with no separate "starting density" concept needed.
        this.states = configs.map(config => ({
            config,
            records: DynamicResourceStorage.getRecords(config.id).map(record => ({
                col: record.col,
                row: record.row,
                position: cellToWorldVector(record.col, record.row),
            })),
            checkTimerSec: 0,
        }));
    }

    public update(playerPosition: THREE.Vector3, delta: number): void {
        const loadRadiusSq = PERFORMANCE_CONFIG.resourceLoadRadius * PERFORMANCE_CONFIG.resourceLoadRadius;
        const unloadRadiusSq = PERFORMANCE_CONFIG.resourceUnloadRadius * PERFORMANCE_CONFIG.resourceUnloadRadius;

        for (const state of this.states) {
            this.streamRecords(state, playerPosition, loadRadiusSq, unloadRadiusSq);

            state.checkTimerSec -= delta;
            if (state.checkTimerSec > 0) {
                continue;
            }
            state.checkTimerSec = state.config.checkIntervalSec;
            this.tryFillDensity(state, playerPosition, loadRadiusSq);
        }
    }

    /** Tears down every currently-materialized node — for scene teardown, mirroring WorldManager.destroy(). Persisted records are untouched (this is a normal scene unload, not a data reset — see resetAll() for that). */
    public destroy(): void {
        for (const state of this.states) {
            for (const record of state.records) {
                if (record.node) {
                    this.world.remove(record.node);
                    record.node = undefined;
                }
            }
        }
    }

    /**
     * "Clear Data"'s actual reset for this system — wired into both the dev-GUI "Reset
     * Everything"/"Clear Dynamic Resources" buttons AND the real in-game Settings popup (see
     * SettingsPopup.ts). Removes every currently-live node (same as destroy()), wipes every
     * config's in-memory record list back to empty, resets each check timer to 0 (so the very
     * next update() re-seeds density near the player immediately, same as a brand new scene —
     * see the constructor's own doc), and clears the persisted save so a reload doesn't bring
     * any of it back.
     */
    public async resetAll(): Promise<void> {
        for (const state of this.states) {
            for (const record of state.records) {
                if (record.node) {
                    this.world.remove(record.node);
                }
            }
            state.records.length = 0;
            state.checkTimerSec = 0;
        }
        await DynamicResourceStorage.clearAll();
    }

    /** Materializes/dematerializes every already-known record for `state` by distance to the player — same load/unload hysteresis gap WorldManager.update() uses, and the same reasoning: a record right at one exact radius shouldn't load/unload every frame as the player jitters across it. */
    private streamRecords(state: DynamicResourceState, playerPosition: THREE.Vector3, loadRadiusSq: number, unloadRadiusSq: number): void {
        for (const record of state.records) {
            const distanceSq = record.position.distanceToSquared(playerPosition);

            if (record.node) {
                if (distanceSq > unloadRadiusSq) {
                    this.dematerialize(record);
                }
                continue;
            }

            if (distanceSq <= loadRadiusSq) {
                this.materialize(state, record);
            }
        }
    }

    /**
     * Tops up `state`'s NEARBY (within loadRadius) record count toward its density target —
     * see DynamicResourceConfig.density's own doc for the "rate against however much eligible
     * terrain happens to be nearby right now" framing. Rolls random candidate cells (also
     * restricted to loadRadius, so this never has to consider — or even look at — the rest of
     * the map) until the gap closes or MAX_ATTEMPTS_PER_CHECK runs out; running out is a
     * normal outcome (a dense enough area, or bad luck this round), not an error — the next
     * checkIntervalSec tick just tries again.
     */
    private tryFillDensity(state: DynamicResourceState, playerPosition: THREE.Vector3, loadRadiusSq: number): void {
        const nearbyCells = this.collectCellsForType(state.config.spawnerTileType)
            .filter(cell => cell.position.distanceToSquared(playerPosition) <= loadRadiusSq);
        if (nearbyCells.length === 0) {
            return;
        }

        const targetCount = Math.round(nearbyCells.length * state.config.density);
        let nearbyRecordCount = state.records.reduce(
            (count, record) => count + (record.position.distanceToSquared(playerPosition) <= loadRadiusSq ? 1 : 0),
            0,
        );

        let attempts = 0;
        while (nearbyRecordCount < targetCount && attempts < MAX_ATTEMPTS_PER_CHECK) {
            attempts++;
            const cell = nearbyCells[Math.floor(Math.random() * nearbyCells.length)];
            if (!this.isFarEnough(cell.position, state)) {
                continue;
            }

            const record: RuntimeRecord = { col: cell.col, row: cell.row, position: cell.position };
            state.records.push(record);
            DynamicResourceStorage.addRecord(state.config.id, { col: cell.col, row: cell.row });
            this.materialize(state, record);
            nearbyRecordCount++;
        }
    }

    /** Every (col, row, world position) cell belonging to a cluster whose resolved type matches `spawnerTileType`, across every spawner layer (never merged — see WorldSpawner.ts's own doc) — resolved once and cached, since the map's own painted layout never changes at runtime. */
    private collectCellsForType(spawnerTileType: string): { col: number; row: number; position: THREE.Vector3 }[] {
        let cells = this.cellsByTileType.get(spawnerTileType);
        if (cells) {
            return cells;
        }

        cells = [];
        for (const layer of this.worldSpawner.getLayers()) {
            for (const cluster of layer.clusters) {
                if (cluster.type !== spawnerTileType) {
                    continue;
                }
                for (const cell of cluster.cells) {
                    cells.push({ col: cell.col, row: cell.row, position: cellToWorldVector(cell.col, cell.row) });
                }
            }
        }
        this.cellsByTileType.set(spawnerTileType, cells);
        return cells;
    }

    /** True only if `position` is at least `state.config.minDistance` away from EVERY other PERSISTED record of this same config — checked regardless of whether that other record is currently rendered, so density/spacing stays honest for cells outside the player's view too. */
    private isFarEnough(position: THREE.Vector3, state: DynamicResourceState): boolean {
        const minDistanceSq = state.config.minDistance * state.config.minDistance;
        for (const record of state.records) {
            if (record.position.distanceToSquared(position) < minDistanceSq) {
                return false;
            }
        }
        return true;
    }

    private materialize(state: DynamicResourceState, record: RuntimeRecord): void {
        const node = new LooseResourceNode(state.config.resourceType, record.position, this.screenHost, () => this.handleConsumed(state, record));
        this.world.add(node);
        this.threeScene.add(node.transform);
        record.node = node;
        node.playSpawnIn();
    }

    /** Mirrors WorldManager.dematerialize() — clears `record.node` immediately (so update() won't touch this record again until it's back in range) but defers the actual world.remove() until the despawn tween finishes. */
    private dematerialize(record: RuntimeRecord): void {
        const node = record.node;
        if (!node) {
            return;
        }
        record.node = undefined;
        node.playDespawnOut(() => this.world.remove(node));
    }

    /** LooseResourceNode's own onConsumed callback (see that file's own doc) — the instance was fully harvested, not just walked away from, so its cell is freed for good: dropped from this config's own runtime record list AND its persisted reservation, unlike dematerialize() above. */
    private handleConsumed(state: DynamicResourceState, record: RuntimeRecord): void {
        const index = state.records.indexOf(record);
        if (index !== -1) {
            state.records.splice(index, 1);
        }
        record.node = undefined;
        DynamicResourceStorage.removeRecord(state.config.id, { col: record.col, row: record.row });
    }
}

function cellToWorldVector(col: number, row: number): THREE.Vector3 {
    const { x, z } = tileCellToWorldPosition(col, row, WORLD_UNITS_PER_TILE);
    return new THREE.Vector3(x, 0, z);
}
