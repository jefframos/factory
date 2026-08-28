// ShapeResourceSpawner.ts
//
// Scatters loose, dynamically-spawned resources (see ShapeResourceTypes.ts)
// inside a hand-drawn "spawner" AREA (WorldObjectRegistry.getShape() — a
// rect, circle, or freehand polygon, e.g. "animalSpawner1") instead of a
// WorldSpawner tile cluster — sibling to DynamicResourceSpawner.ts, same
// persisted-record + load/unload-radius streaming design (see that file's
// own doc, all of which applies here unchanged), just swapping "roll a
// random CELL from the placement's spawnerTileType cluster" for "roll a
// random POINT inside the placement's own shape."
//
// Every placement gets its own independent runtime state (its own record
// list + a countdown to its next density check), keyed by
// ShapeResourceTypes.shapePlacementKey() — same per-placement isolation
// DynamicResourceSpawner.ts uses.
//
// update(playerPosition, delta) does the same two things per placement,
// every call, as DynamicResourceSpawner.update():
//   1. Streams materialize/dematerialize for every record already known
//      about (persisted or freshly spawned), using the SAME
//      PERFORMANCE_CONFIG.resourceLoadRadius/resourceUnloadRadius knobs.
//   2. Ticks that placement's own checkIntervalSec countdown; once it
//      elapses, tryFillDensity() rolls random points inside the shape
//      (rejection-sampling its bounding box for a polygon, since there's no
//      closed-form way to pick a uniform point inside an arbitrary polygon
//      otherwise) until `count` is met or MAX_ATTEMPTS_PER_CHECK runs out,
//      skipping any point that fails the minDistance check against every
//      record of that placement (not just rendered ones).
//
// `count` (see ShapeResourcePlacement's own doc) is checked against the
// placement's TOTAL record count, not just nearby ones — unlike
// DynamicResourceSpawner's density-per-nearby-cell rate, a shape is a small
// fixed area, so "how many exist right now, anywhere in the shape" is
// already the right budget without a proximity qualifier.

import * as THREE from 'three';
import World from '../ecs/World';
import LooseResourceNode from '../player/LooseResourceNode';
import AnimalNode from '../player/AnimalNode';
import { AnimalType } from '../actions/AnimalTypes';
import { ScreenAnchorHost } from '../components/ScreenAnchorComponent';
import WorldObjectRegistry, { sampleRandomPointInShape } from './WorldObjectRegistry';
import { SHAPE_RESOURCE_PLACEMENTS, ShapeResourcePlacement, shapePlacementKey } from './ShapeResourceTypes';
import { ShapeResourceStorage } from './ShapeResourceStorage';
import { PERFORMANCE_CONFIG } from '../config/PerformanceConfig';
import ZoneVisibilityManager from './ZoneVisibilityManager';

/** Upper bound on how many candidate points tryFillDensity() will roll through in a single check — same "cheap backstop against an unlucky run of minDistance misses" reasoning as DynamicResourceSpawner's own MAX_ATTEMPTS_PER_CHECK, plus here it also has to absorb rejection-sampling misses for a polygon's bounding box. */
const MAX_ATTEMPTS_PER_CHECK = 60;

interface RuntimeRecord {
    position: THREE.Vector3;
    /** Only set while the player is within resourceLoadRadius of this record — see update(). A LooseResourceNode for a 'resource' placement, an AnimalNode for an 'animal' one — see materialize()'s own branch. */
    node?: LooseResourceNode | AnimalNode;
}

interface ShapeResourceState {
    readonly placement: ShapeResourcePlacement;
    /** shapePlacementKey(placement) — ShapeResourceStorage's own persistence key for this placement's records. */
    readonly key: string;
    readonly records: RuntimeRecord[];
    /** Seconds remaining until the next density check for this placement — see update(). */
    checkTimerSec: number;
}

export default class ShapeResourceSpawner {
    private readonly states: ShapeResourceState[];

    public constructor(
        private readonly world: World,
        private readonly threeScene: THREE.Scene,
        private readonly screenHost: ScreenAnchorHost,
        private readonly worldObjects: WorldObjectRegistry,
        placements: readonly ShapeResourcePlacement[] = SHAPE_RESOURCE_PLACEMENTS,
        /** Solution 2 only (undefined under FogOfWarStyle.BoxCloud — see FogOfWarConfig.ts): a record that streams in inside a closed zone stays invisible until that zone is revealed, exactly like WorldManager's own map-painted resources. */
        private readonly zoneVisibility?: ZoneVisibilityManager,
    ) {
        // Starts every placement's countdown at 0 rather than checkIntervalSec — same "seed up
        // to target the instant the scene loads" reasoning as DynamicResourceSpawner's own
        // constructor.
        this.states = placements.map(placement => {
            const key = shapePlacementKey(placement);
            return {
                placement,
                key,
                records: ShapeResourceStorage.getRecords(key).map(record => ({
                    position: new THREE.Vector3(record.x, 0, record.z),
                })),
                checkTimerSec: 0,
            };
        });
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
            state.checkTimerSec = state.placement.checkIntervalSec;
            this.tryFillDensity(state);
        }
    }

    /** Tears down every currently-materialized node — for scene teardown, mirroring DynamicResourceSpawner.destroy(). Persisted records are untouched. */
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

    /** "Clear Data"'s reset for this system — mirrors DynamicResourceSpawner.resetAll() exactly, just against ShapeResourceStorage instead. */
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
        await ShapeResourceStorage.clearAll();
    }

    private streamRecords(state: ShapeResourceState, playerPosition: THREE.Vector3, loadRadiusSq: number, unloadRadiusSq: number): void {
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
     * Tops up `state`'s TOTAL record count toward its placement's `count` target — see
     * ShapeResourcePlacement.count's own doc for why this checks the whole shape, not just
     * nearby records (unlike DynamicResourceSpawner's proximity-scoped density). Skips
     * entirely (warn once) if `shapeId` doesn't resolve to any drawn spawner object — a level
     * designer who hasn't drawn it yet, or a placement referencing a typo'd id, shouldn't
     * throw, just produce nothing.
     */
    private tryFillDensity(state: ShapeResourceState): void {
        const shape = this.worldObjects.getShape(state.placement.shapeId);
        if (!shape) {
            console.warn(`[ShapeResourceSpawner] no spawner shape found for id "${state.placement.shapeId}" — check the mapSettings layer`);
            return;
        }

        let attempts = 0;
        while (state.records.length < state.placement.count && attempts < MAX_ATTEMPTS_PER_CHECK) {
            attempts++;
            const point = sampleRandomPointInShape(shape, MAX_ATTEMPTS_PER_CHECK - attempts);
            if (!point) {
                break;
            }
            const position = new THREE.Vector3(point.x, 0, point.z);
            if (!this.isFarEnough(position, state)) {
                continue;
            }

            const record: RuntimeRecord = { position };
            state.records.push(record);
            ShapeResourceStorage.addRecord(state.key, { x: point.x, z: point.z });
            this.materialize(state, record);
        }
    }

    /** True only if `position` is at least `state.placement.minDistance` away from EVERY other PERSISTED record of this same placement — same reasoning as DynamicResourceSpawner.isFarEnough(). */
    private isFarEnough(position: THREE.Vector3, state: ShapeResourceState): boolean {
        const minDistanceSq = state.placement.minDistance * state.placement.minDistance;
        for (const record of state.records) {
            if (record.position.distanceToSquared(position) < minDistanceSq) {
                return false;
            }
        }
        return true;
    }

    /**
     * Builds the live node for `record` — a LooseResourceNode for a 'resource' placement (the
     * default, see ShapeResourcePlacement.spawnType's own doc), an AnimalNode for an 'animal'
     * one. An animal needs its own wander shape re-fetched here (not just at spawn time,
     * since materialize() also runs every time an already-known record re-enters load
     * radius) — if the shape's gone missing (a level designer deleted/renamed the spawner
     * object since this was spawned) this just warns and skips rather than crashing, same
     * "shouldn't happen with a real map, reads better than silently showing nothing" spirit
     * WorldSpawner.ts's own gid fallback uses.
     *
     * No-ops entirely (leaves record.node undefined) if this position's zone is still locked
     * — see ZoneVisibilityManager.ts's own doc for why that has to happen HERE, before
     * creating anything, rather than spawning a real node (mesh + trigger/catch area) and
     * merely hiding it: a hidden-but-live AnimalNode could still be caught despite being
     * invisible. streamRecords()'s per-frame distance check retries this every tick a record
     * is in range, so the moment its zone unlocks, the very next tick materializes it for real.
     */
    private materialize(state: ShapeResourceState, record: RuntimeRecord): void {
        if (this.zoneVisibility && !this.zoneVisibility.isPositionUnlocked(record.position.x, record.position.z)) {
            return;
        }

        if ((state.placement.spawnType ?? 'resource') === 'animal') {
            const shape = this.worldObjects.getShape(state.placement.shapeId);
            if (!shape) {
                console.warn(`[ShapeResourceSpawner] no spawner shape found for id "${state.placement.shapeId}" — can't materialize its animal`);
                return;
            }
            const node = new AnimalNode(state.placement.animalType as AnimalType, record.position, this.screenHost, {
                shape,
                onCaught: () => this.handleConsumed(state, record),
            });
            this.world.add(node);
            this.threeScene.add(node.transform);
            record.node = node;
            node.playSpawnIn();
            this.zoneVisibility?.register(node.transform, record.position.x, record.position.z);
            return;
        }

        const node = new LooseResourceNode(state.placement.resourceType!, record.position, this.screenHost, () => this.handleConsumed(state, record));
        this.world.add(node);
        this.threeScene.add(node.transform);
        record.node = node;
        node.playSpawnIn();
        this.zoneVisibility?.register(node.transform, record.position.x, record.position.z);
    }

    /**
     * Mirrors DynamicResourceSpawner.dematerialize() — clears `record.node` immediately but
     * defers the actual world.remove() until the despawn tween finishes. For an animal
     * placement specifically: `record.position` stays whatever it was at SPAWN time, not
     * wherever the AnimalNode actually wandered to before the player walked out of range —
     * so a Pig currently "snaps back" to its original spot on re-approach rather than
     * resuming from its last wandered position. Acceptable for now (nothing relies on exact
     * position continuity); track the live AnimalNode's position back into `record` here if
     * that ever needs fixing.
     */
    private dematerialize(record: RuntimeRecord): void {
        const node = record.node;
        if (!node) {
            return;
        }
        record.node = undefined;
        this.zoneVisibility?.unregister(node.transform);
        node.playDespawnOut(() => this.world.remove(node));
    }

    /** LooseResourceNode's own onConsumed callback — the instance was fully harvested, so it's dropped from this placement's own runtime record list AND its persisted reservation. */
    private handleConsumed(state: ShapeResourceState, record: RuntimeRecord): void {
        const index = state.records.indexOf(record);
        if (index !== -1) {
            state.records.splice(index, 1);
        }
        if (record.node) {
            this.zoneVisibility?.unregister(record.node.transform);
        }
        record.node = undefined;
        ShapeResourceStorage.removeRecord(state.key, { x: record.position.x, z: record.position.z });
    }
}
