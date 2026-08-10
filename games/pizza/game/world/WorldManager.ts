// WorldManager.ts
//
// Owns "what's in the world and where" — the ground, plus every resource
// node's position (normally read straight off the Tiled map's resourcesLayer,
// see TileMapConfig.buildResourceSpawnsFromTileMap()) and its gather/respawn
// state. Resources near the player get a real ResourceNode
// (mesh + physics, see ../player/ResourceNode.ts); everything else is just a
// lightweight ResourceRecord that WorldManager keeps simulating on its own.
//
// That's the actual point of this class: a resource that's out of range
// still needs its respawn timer ticking (see update()'s "not materialized"
// branch below) — someone who chopped a tree, walked off, and comes back
// five minutes later should find it grown back exactly on schedule, not
// frozen at the moment it went out of range and only resuming once
// rendered again. Gather damage, by contrast, can only happen to a
// materialized node (nothing else can hit it), so there's nothing to
// simulate there — materialize()/dematerialize() just hand life back and
// forth with the live ResourceNode instance.
//
// One WorldManager per scene, constructed with the scene's World (ECS +
// physics, see ../ecs/World.ts) and THREE.Scene, then driven every frame:
//   worldManager.update(player.transform.position, delta)
// Call buildGround() once during scene build(), same spot PizzaScene used
// to call buildFloor()/setupGround().

import * as THREE from 'three';
import World from '../ecs/World';
import RigidBody from '../physics/RigidBody';
import { Layers } from '../physics/PhysicsConstants';
import ResourceNode from '../player/ResourceNode';
import { RESOURCE_CONFIG } from '../actions/ResourceTypes';
import {
    FLOOR_SIZE, GROUND_HALF_THICKNESS,
    ResourceSpawnDef
} from './WorldConfig';
import TileMap from './TileMap';
import IslandMeshBuilder from './IslandMeshBuilder';
import { buildResourceSpawnsFromTileMap, DEFAULT_TILE_MAP_ALIASES } from './TileMapConfig';
import { ScreenAnchorHost } from '../components/ScreenAnchorComponent';
import { PERFORMANCE_CONFIG } from '../config/PerformanceConfig';

/** Flip to false to fall back to TileMap's own flat-color quad paint instead of IslandMeshBuilder's raised, rounded-corner island + water — see buildGround(). */
const USE_ISLAND_MESH = true;

interface ResourceRecord {
    readonly def: ResourceSpawnDef;
    life: number;
    /** undefined means available; set while depleted and off-screen — see update()'s own doc. */
    respawnRemainingSec?: number;
    /** The live Entity, only while the player is within LOAD_RADIUS of def.position — see materialize()/dematerialize(). */
    node?: ResourceNode;
}

export default class WorldManager {
    private readonly records = new Map<string, ResourceRecord>();
    private readonly tileMap: TileMap;
    /** Builds 3D island geometry + water from tileMap's parsed ground cells — see its own doc. Reassign `USE_ISLAND_MESH` below to `false` to go back to TileMap's own flat-color paint instead. */
    private readonly islandMeshBuilder: IslandMeshBuilder;

    /**
     * `spawns` defaults to reading the map's resourcesLayer (see
     * TileMapConfig.buildResourceSpawnsFromTileMap()) — the Tiled map is the normal source
     * of truth for where resources sit. Pass an explicit list (e.g.
     * WorldConfig.generateProceduralResourceSpawns()) to override that for tests or a
     * boundless mode with no hand-painted map.
     */
    public constructor(
        private readonly world: World,
        private readonly threeScene: THREE.Scene,
        private readonly screenHost: ScreenAnchorHost,
        tileMapAliases = DEFAULT_TILE_MAP_ALIASES,
        spawns: ResourceSpawnDef[] = buildResourceSpawnsFromTileMap(tileMapAliases.map, tileMapAliases.tiles),
    ) {
        for (const def of spawns) {
            this.records.set(def.id, { def, life: RESOURCE_CONFIG[def.resourceType].maxLife });
        }
        this.tileMap = new TileMap(threeScene, tileMapAliases.map, tileMapAliases.tiles);
        this.islandMeshBuilder = new IslandMeshBuilder(threeScene);
    }

    /**
     * Grid-textured visual plane + a matching static physics slab, top face at world Y=0 —
     * the "one large plane, that's ok for now" ground/collision floor — plus the Tiled tile
     * map's data built on top of it (see TileMap.ts) and, when USE_ISLAND_MESH is on (the
     * default), IslandMeshBuilder's raised rounded-corner island geometry + moving water
     * plane instead of TileMap's own flat-color paint (see build()'s own doc for exactly
     * what stays running either way — walkability, resource spawns, etc. never depend on
     * which one is actually drawn). Call once from the scene's build().
     */
    public buildGround(): void {
        // const material = new THREE.MeshStandardMaterial({
        //     map: FloorBuilder.makeGridTexture(FLOOR_SIZE),
        //     roughness: 1,
        // });
        // BendService.applyBend(material);
        // const geometry = new THREE.PlaneGeometry(FLOOR_SIZE, FLOOR_SIZE, FLOOR_SEGMENTS, FLOOR_SEGMENTS);
        // geometry.rotateX(-Math.PI / 2);
        // this.threeScene.add(new THREE.Mesh(geometry, material));

        const ground = this.world.spawn();
        ground.addComponent(new RigidBody({
            halfExtents: new THREE.Vector3(FLOOR_SIZE / 2, GROUND_HALF_THICKNESS, FLOOR_SIZE / 2),
            isStatic: true,
            layer: Layers.Environment,
            centerOffset: new THREE.Vector3(0, -GROUND_HALF_THICKNESS, 0),
        }));
        this.threeScene.add(ground.transform);

        // paintVisible=false when the island mesh is taking over the visuals: the flat quad
        // paint still gets built (cellDefs/cellList/walkability all still populate normally,
        // see TileMap.build()'s own doc) — it's just not drawn under the raised island.
        this.tileMap.build(!USE_ISLAND_MESH);

        if (USE_ISLAND_MESH) {
            this.islandMeshBuilder.build(this.tileMap);
        }
    }

    /**
     * Streams resource nodes in/out around the player and keeps every off-screen respawn
     * timer ticking regardless of whether it's currently materialized — see this file's
     * own doc for why that second part matters.
     */
    public update(playerPosition: THREE.Vector3, delta: number): void {
        // Read fresh each call, not cached — PERFORMANCE_CONFIG's radii are a live dat.GUI
        // slider target (see PerformanceConfig.ts's own doc), so a cached squared value
        // would freeze at whatever it was on the first frame.
        const loadRadiusSq = PERFORMANCE_CONFIG.resourceLoadRadius * PERFORMANCE_CONFIG.resourceLoadRadius;
        const unloadRadiusSq = PERFORMANCE_CONFIG.resourceUnloadRadius * PERFORMANCE_CONFIG.resourceUnloadRadius;

        for (const record of this.records.values()) {
            const distanceSq = record.def.position.distanceToSquared(playerPosition);

            if (record.node) {
                // The live node is the source of truth while materialized — pull its
                // current state into the record so dematerializing never loses progress.
                record.life = record.node.remainingLife;
                record.respawnRemainingSec = record.node.respawnRemaining;

                if (distanceSq > unloadRadiusSq) {
                    this.dematerialize(record);
                }
                continue;
            }

            if (record.respawnRemainingSec !== undefined) {
                record.respawnRemainingSec -= delta;
                if (record.respawnRemainingSec <= 0) {
                    record.respawnRemainingSec = undefined;
                    record.life = RESOURCE_CONFIG[record.def.resourceType].maxLife;
                }
            }

            if (distanceSq <= loadRadiusSq) {
                this.materialize(record);
            }
        }
    }

    /** Tears down every currently-materialized node plus the tile map mesh — for scene teardown, mirroring World.remove() cleanup elsewhere. */
    public destroy(): void {
        for (const record of this.records.values()) {
            if (record.node) {
                this.world.remove(record.node);
                record.node = undefined;
            }
        }
        this.tileMap.destroy();
        this.islandMeshBuilder.destroy();
    }

    private materialize(record: ResourceRecord): void {
        const node = new ResourceNode(record.def.resourceType, record.def.position, record.life, record.respawnRemainingSec, this.screenHost);
        this.world.add(node);
        this.threeScene.add(node.transform);
        record.node = node;
        // See RESOURCE_POP_IN_SEC's own doc (WorldConfig.ts) — scales in instead of
        // snapping straight to full size the instant this streams into LOAD_RADIUS.
        node.playSpawnIn();
    }

    /**
     * Clears `record.node` immediately (so update()'s streaming loop won't touch this
     * record again — see LOAD_RADIUS_SQ's own doc on the load/unload hysteresis gap) but
     * defers the actual world.remove() until the node's playDespawnOut() tween finishes, so
     * it visibly shrinks away instead of vanishing the instant the player drifts past
     * UNLOAD_RADIUS.
     */
    private dematerialize(record: ResourceRecord): void {
        const node = record.node;
        if (!node) {
            return;
        }
        record.life = node.remainingLife;
        record.respawnRemainingSec = node.respawnRemaining;
        record.node = undefined;
        node.playDespawnOut(() => this.world.remove(node));
    }
}
