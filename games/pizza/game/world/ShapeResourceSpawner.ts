// ShapeResourceSpawner.ts
//
// Scatters loose, dynamically-spawned resources (see ShapeResourceTypes.ts)
// inside a hand-drawn "spawner" AREA (WorldObjectRegistry.getShapes() — a
// rect, circle, or freehand polygon, e.g. "animalSpawner1") instead of a
// WorldSpawner tile cluster — sibling to DynamicResourceSpawner.ts, same
// persisted-record + load/unload-radius streaming design (see that file's
// own doc, all of which applies here unchanged), just swapping "roll a
// random CELL from the placement's spawnerTileType cluster" for "roll a
// random POINT inside the placement's own shape."
//
// One placement can drive MULTIPLE independent spawn areas — every spawner
// object sharing the placement's own `shapeId` gets its OWN runtime state
// (see WorldObjectRegistry.getShapes()'s own doc: a spawner id deliberately
// collects every instance drawn with it, not just the last one). This is
// what lets a designer draw "treeSpawner" five times across five different
// forest clearings and configure it ONCE (one ShapeResourcePlacement, one
// count/density/minDistance) instead of needing five uniquely-named spawner
// objects and five near-identical placement entries — each clearing still
// fills to the SAME target independently, they just don't share a budget
// with each other. A placement whose shapeId matches exactly one drawn
// object (the common case, and every placement predating this) behaves
// exactly as before.
//
// Every (placement, shape instance) PAIR gets its own independent runtime
// state (its own record list + a countdown to its next density check),
// keyed by ShapeResourceTypes.shapePlacementKey() — suffixed with an
// instance index ONLY when more than one shape shares that shapeId, so a
// single-instance placement's already-persisted records aren't orphaned by
// this — same per-placement isolation DynamicResourceSpawner.ts uses,
// just one level finer.
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
import ResourceNode from '../player/ResourceNode';
import { AnimalType } from '../actions/AnimalTypes';
import { PROVIDER_CONFIG } from '../actions/ProviderTypes';
import { ScreenAnchorHost } from '../components/ScreenAnchorComponent';
import WorldObjectRegistry, { SpawnerShape, sampleRandomPointInShape, shapeArea } from './WorldObjectRegistry';
import { SHAPE_RESOURCE_PLACEMENTS, ShapeResourcePlacement, shapePlacementKey } from './ShapeResourceTypes';
import { ShapeResourceStorage } from './ShapeResourceStorage';
import { WORLD_UNITS_PER_TILE } from './TileMapConfig';
import { PERFORMANCE_CONFIG } from '../config/PerformanceConfig';
import ZoneVisibilityManager from './ZoneVisibilityManager';
import { ZONE_REVEAL_CONFIG } from './FogOfWarConfig';
import { collectFarmFootprints, FarmFootprint, isInsideAnyFarmFootprint } from './FarmFootprints';

/** Upper bound on how many candidate points tryFillDensity() will roll through in a single check — same "cheap backstop against an unlucky run of minDistance misses" reasoning as DynamicResourceSpawner's own MAX_ATTEMPTS_PER_CHECK, plus here it also has to absorb rejection-sampling misses for a polygon's bounding box. */
const MAX_ATTEMPTS_PER_CHECK = 60;

interface RuntimeRecord {
    position: THREE.Vector3;
    /** Only set while the player is within resourceLoadRadius of this record — see update(). A LooseResourceNode for a 'resource' placement, an AnimalNode for an 'animal' one, a real gatherable ResourceNode for a 'provider' one — see materialize()'s own branch. */
    node?: LooseResourceNode | AnimalNode | ResourceNode;
    /** `spawnType: 'provider'` records ONLY — mirrors DynamicResourceSpawner's own RuntimeRecord.life/respawnRemainingSec (see that file's own doc): a provider depletes then respawns on a timer FOREVER rather than being consumed-and-gone, so this has to persist across materialize/dematerialize cycles. Always undefined for a 'resource'/'animal' record. */
    life?: number;
    respawnRemainingSec?: number;
}

interface ShapeResourceState {
    readonly placement: ShapeResourcePlacement;
    /** THIS state's own shape instance, resolved once at construction — see WorldObjectRegistry.getShapes()'s own doc. Every method below reads this directly instead of re-looking it up by shapeId, which would be ambiguous once more than one instance can share an id. */
    readonly shape: SpawnerShape;
    /** shapePlacementKey(placement) — ShapeResourceStorage's own persistence key for this state's own records — suffixed with this instance's own index when its shapeId matched more than one drawn object (see this file's own doc), so sibling instances never share (or fight over) each other's persisted records/budget. */
    readonly key: string;
    readonly records: RuntimeRecord[];
    /** Seconds remaining until the next density check for this placement — see update(). */
    checkTimerSec: number;
}

export default class ShapeResourceSpawner {
    private readonly states: ShapeResourceState[];
    /** Every farm plot's own AABB, resolved ONCE (see FarmFootprints.ts's own doc) — tryFillDensity() rejects any candidate point landing inside one, same as it already rejects a too-close-to-another-record candidate. */
    private readonly farmFootprints: FarmFootprint[];

    public constructor(
        private readonly world: World,
        private readonly threeScene: THREE.Scene,
        private readonly screenHost: ScreenAnchorHost,
        private readonly worldObjects: WorldObjectRegistry,
        placements: readonly ShapeResourcePlacement[] = SHAPE_RESOURCE_PLACEMENTS,
        /** Solution 2 only (undefined under FogOfWarStyle.BoxCloud — see FogOfWarConfig.ts): a record that streams in inside a closed zone stays invisible until that zone is revealed, exactly like WorldManager's own map-painted resources. */
        private readonly zoneVisibility?: ZoneVisibilityManager,
    ) {
        this.farmFootprints = collectFarmFootprints(worldObjects);
        // Starts every state's countdown at 0 rather than checkIntervalSec — same "seed up to
        // target the instant the scene loads" reasoning as DynamicResourceSpawner's own
        // constructor. flatMap: a placement whose shapeId matches N drawn objects (see this
        // file's own doc) becomes N independent states here, one per object; a placement
        // matching zero (a typo'd id, or one not drawn yet) contributes nothing at all —
        // warned once here rather than every tryFillDensity() tick the old single-shape
        // lookup used to warn on.
        this.states = placements.flatMap(placement => {
            const shapes = this.worldObjects.getShapes(placement.shapeId);
            if (shapes.length === 0) {
                console.warn(`[ShapeResourceSpawner] no spawner shape found for id "${placement.shapeId}" — check the mapSettings layer`);
                return [];
            }

            return shapes.map((shape, shapeIndex) => {
                const baseKey = shapePlacementKey(placement);
                const key = shapes.length > 1 ? `${baseKey}#${shapeIndex}` : baseKey;
                return {
                    placement,
                    shape,
                    key,
                    records: ShapeResourceStorage.getRecords(key).map(record => ({
                        position: new THREE.Vector3(record.x, 0, record.z),
                    })),
                    checkTimerSec: 0,
                };
            });
        });
    }

    public update(playerPosition: THREE.Vector3, delta: number): void {
        const loadRadiusSq = PERFORMANCE_CONFIG.resourceLoadRadius * PERFORMANCE_CONFIG.resourceLoadRadius;
        const unloadRadiusSq = PERFORMANCE_CONFIG.resourceUnloadRadius * PERFORMANCE_CONFIG.resourceUnloadRadius;

        for (const state of this.states) {
            this.streamRecords(state, playerPosition, delta, loadRadiusSq, unloadRadiusSq);

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

    /** See DynamicResourceSpawner.streamRecords()'s own doc for the 'provider'-specific life/respawn bookkeeping this mirrors — pulling a live ResourceNode's own state into the record every tick, and ticking an off-screen depleted one's respawn countdown here so it comes back on schedule instead of freezing while out of range. */
    private streamRecords(state: ShapeResourceState, playerPosition: THREE.Vector3, delta: number, loadRadiusSq: number, unloadRadiusSq: number): void {
        for (const record of state.records) {
            const distanceSq = record.position.distanceToSquared(playerPosition);

            if (record.node) {
                if (record.node instanceof ResourceNode) {
                    record.life = record.node.remainingLife;
                    record.respawnRemainingSec = record.node.respawnRemaining;
                }

                if (distanceSq > unloadRadiusSq) {
                    this.dematerialize(record);
                }
                continue;
            }

            if ((state.placement.spawnType ?? 'resource') === 'provider' && record.respawnRemainingSec !== undefined) {
                record.respawnRemainingSec -= delta;
                if (record.respawnRemainingSec <= 0) {
                    record.respawnRemainingSec = undefined;
                    record.life = PROVIDER_CONFIG[state.placement.providerType!].maxLife;
                }
            }

            if (distanceSq <= loadRadiusSq) {
                this.materialize(state, record);
            }
        }
    }

    /**
     * Tops up `state`'s TOTAL record count toward its placement's own target — `count` for a
     * small fixed-size shape (the default), or a density-derived target for a large one when
     * `density` is set and greater than 0 (see ShapeResourcePlacement.density's own doc) — see
     * that field's own doc for why this checks the whole shape, not just nearby records
     * (unlike DynamicResourceSpawner's proximity-scoped density). `state.shape` is always
     * present by this point (see the constructor's own doc — a state is only ever created for
     * a shapeId that actually resolved to at least one drawn object), so there's no
     * missing-shape case to guard here anymore.
     */
    private tryFillDensity(state: ShapeResourceState): void {
        const targetCount = state.placement.density
            ? Math.round((shapeArea(state.shape) / (WORLD_UNITS_PER_TILE * WORLD_UNITS_PER_TILE)) * state.placement.density)
            : state.placement.count;

        let attempts = 0;
        while (state.records.length < targetCount && attempts < MAX_ATTEMPTS_PER_CHECK) {
            attempts++;
            const point = sampleRandomPointInShape(state.shape, MAX_ATTEMPTS_PER_CHECK - attempts);
            if (!point) {
                break;
            }
            const position = new THREE.Vector3(point.x, 0, point.z);
            if (!this.isFarEnough(position, state) || isInsideAnyFarmFootprint(position.x, position.z, this.farmFootprints)) {
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
     * one (wandering within `state.shape`, its OWN resolved shape instance — see the
     * constructor's own doc), or a real gatherable ResourceNode (carrying this record's own
     * persisted life/respawnRemainingSec, same as DynamicResourceSpawner's own provider
     * branch) for a 'provider' one.
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

        if ((state.placement.spawnType ?? 'resource') === 'provider') {
            const node = new ResourceNode(state.placement.providerType!, record.position, record.life, record.respawnRemainingSec, this.screenHost);
            this.world.add(node);
            this.threeScene.add(node.transform);
            record.node = node;
            node.playSpawnIn();
            this.zoneVisibility?.register(
                node.transform, record.position.x, record.position.z,
                undefined, undefined, ZONE_REVEAL_CONFIG.categoryDelaySec.props,
            );
            return;
        }

        if ((state.placement.spawnType ?? 'resource') === 'animal') {
            const node = new AnimalNode(state.placement.animalType as AnimalType, record.position, this.screenHost, {
                shape: state.shape,
                onCaught: () => this.handleConsumed(state, record),
            });
            this.world.add(node);
            this.threeScene.add(node.transform);
            record.node = node;
            node.playSpawnIn();
            // `creatures` category delay — see ZONE_REVEAL_CONFIG.categoryDelaySec's own doc —
            // so an animal rises LAST, after terrain and props, when echoing a fresh reveal
            // (see ZoneVisibilityManager.addRegistrant()'s own doc).
            this.zoneVisibility?.register(
                node.transform, record.position.x, record.position.z,
                undefined, undefined, ZONE_REVEAL_CONFIG.categoryDelaySec.creatures,
            );
            return;
        }

        const node = new LooseResourceNode(state.placement.resourceType!, record.position, this.screenHost, () => this.handleConsumed(state, record));
        this.world.add(node);
        this.threeScene.add(node.transform);
        record.node = node;
        node.playSpawnIn();
        this.zoneVisibility?.register(
            node.transform, record.position.x, record.position.z,
            undefined, undefined, ZONE_REVEAL_CONFIG.categoryDelaySec.props,
        );
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
