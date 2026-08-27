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
import { ScreenAnchorHost } from '../components/ScreenAnchorComponent';
import WorldObjectRegistry, { SpawnerShape } from './WorldObjectRegistry';
import { SHAPE_RESOURCE_PLACEMENTS, ShapeResourcePlacement, shapePlacementKey } from './ShapeResourceTypes';
import { ShapeResourceStorage } from './ShapeResourceStorage';
import { PERFORMANCE_CONFIG } from '../config/PerformanceConfig';

/** Upper bound on how many candidate points tryFillDensity() will roll through in a single check — same "cheap backstop against an unlucky run of minDistance misses" reasoning as DynamicResourceSpawner's own MAX_ATTEMPTS_PER_CHECK, plus here it also has to absorb rejection-sampling misses for a polygon's bounding box. */
const MAX_ATTEMPTS_PER_CHECK = 60;

interface RuntimeRecord {
    position: THREE.Vector3;
    /** Only set while the player is within resourceLoadRadius of this record — see update(). */
    node?: LooseResourceNode;
}

interface ShapeResourceState {
    readonly placement: ShapeResourcePlacement;
    /** shapePlacementKey(placement) — ShapeResourceStorage's own persistence key for this placement's records. */
    readonly key: string;
    readonly records: RuntimeRecord[];
    /** Seconds remaining until the next density check for this placement — see update(). */
    checkTimerSec: number;
}

/** True if (x, z) falls inside `shape` — see SpawnerShape's own doc for what each kind means. Ray-casting (even-odd rule) for a polygon; plain distance/box check for circle/rect. */
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

/** The axis-aligned world-space box tryFillDensity() rejection-samples within before testing isPointInShape() — tight for 'circle'/'rect' (every sampled point is already guaranteed inside for those, see sampleRandomPointInShape()), loose for 'polygon' (its own bounding box, since there's no cheaper uniform-sampling approach for an arbitrary shape). */
function boundsOf(shape: SpawnerShape): { minX: number; maxX: number; minZ: number; maxZ: number } {
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

/** One uniformly-random point inside `shape`, or undefined if `maxAttempts` of bounding-box rejection sampling all missed (only possible for 'polygon' — 'circle'/'rect' always succeed first try, see below). */
function sampleRandomPointInShape(shape: SpawnerShape, maxAttempts: number): { x: number; z: number } | undefined {
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

    const bounds = boundsOf(shape);
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const x = bounds.minX + Math.random() * (bounds.maxX - bounds.minX);
        const z = bounds.minZ + Math.random() * (bounds.maxZ - bounds.minZ);
        if (isPointInShape(shape, x, z)) {
            return { x, z };
        }
    }
    return undefined;
}

export default class ShapeResourceSpawner {
    private readonly states: ShapeResourceState[];

    public constructor(
        private readonly world: World,
        private readonly threeScene: THREE.Scene,
        private readonly screenHost: ScreenAnchorHost,
        private readonly worldObjects: WorldObjectRegistry,
        placements: readonly ShapeResourcePlacement[] = SHAPE_RESOURCE_PLACEMENTS,
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

    private materialize(state: ShapeResourceState, record: RuntimeRecord): void {
        const node = new LooseResourceNode(state.placement.resourceType, record.position, this.screenHost, () => this.handleConsumed(state, record));
        this.world.add(node);
        this.threeScene.add(node.transform);
        record.node = node;
        node.playSpawnIn();
    }

    /** Mirrors DynamicResourceSpawner.dematerialize() — clears `record.node` immediately but defers the actual world.remove() until the despawn tween finishes. */
    private dematerialize(record: RuntimeRecord): void {
        const node = record.node;
        if (!node) {
            return;
        }
        record.node = undefined;
        node.playDespawnOut(() => this.world.remove(node));
    }

    /** LooseResourceNode's own onConsumed callback — the instance was fully harvested, so it's dropped from this placement's own runtime record list AND its persisted reservation. */
    private handleConsumed(state: ShapeResourceState, record: RuntimeRecord): void {
        const index = state.records.indexOf(record);
        if (index !== -1) {
            state.records.splice(index, 1);
        }
        record.node = undefined;
        ShapeResourceStorage.removeRecord(state.key, { x: record.position.x, z: record.position.z });
    }
}
