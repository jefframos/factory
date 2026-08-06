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
import { FloorBuilder } from '../builders/FloorBuilder';
import { BendService } from '../services/BendService';
import ResourceNode from '../player/ResourceNode';
import { RESOURCE_CONFIG } from '../actions/ResourceTypes';
import {
    FLOOR_SIZE,
    FLOOR_SEGMENTS,
    GROUND_HALF_THICKNESS,
    LOAD_RADIUS_SQ,
    UNLOAD_RADIUS_SQ,
    ResourceSpawnDef,
} from './WorldConfig';
import TileMap from './TileMap';
import { buildResourceSpawnsFromTileMap, DEFAULT_TILE_MAP_ALIASES } from './TileMapConfig';
import { ScreenAnchorHost } from '../components/ScreenAnchorComponent';

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
    }

    /** Grid-textured visual plane + a matching static physics slab, top face at world Y=0 — the "one large plane, that's ok for now" ground — plus the Tiled tile map painted just above it (see TileMap.ts). Call once from the scene's build(). */
    public buildGround(): void {
        const material = new THREE.MeshStandardMaterial({
            map: FloorBuilder.makeGridTexture(FLOOR_SIZE),
            roughness: 1,
        });
        BendService.applyBend(material);
        const geometry = new THREE.PlaneGeometry(FLOOR_SIZE, FLOOR_SIZE, FLOOR_SEGMENTS, FLOOR_SEGMENTS);
        geometry.rotateX(-Math.PI / 2);
        this.threeScene.add(new THREE.Mesh(geometry, material));

        const ground = this.world.spawn();
        ground.addComponent(new RigidBody({
            halfExtents: new THREE.Vector3(FLOOR_SIZE / 2, GROUND_HALF_THICKNESS, FLOOR_SIZE / 2),
            isStatic: true,
            layer: Layers.Environment,
            centerOffset: new THREE.Vector3(0, -GROUND_HALF_THICKNESS, 0),
        }));
        this.threeScene.add(ground.transform);

        this.tileMap.build();
    }

    /**
     * Streams resource nodes in/out around the player and keeps every off-screen respawn
     * timer ticking regardless of whether it's currently materialized — see this file's
     * own doc for why that second part matters.
     */
    public update(playerPosition: THREE.Vector3, delta: number): void {
        for (const record of this.records.values()) {
            const distanceSq = record.def.position.distanceToSquared(playerPosition);

            if (record.node) {
                // The live node is the source of truth while materialized — pull its
                // current state into the record so dematerializing never loses progress.
                record.life = record.node.remainingLife;
                record.respawnRemainingSec = record.node.respawnRemaining;

                if (distanceSq > UNLOAD_RADIUS_SQ) {
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

            if (distanceSq <= LOAD_RADIUS_SQ) {
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
    }

    private materialize(record: ResourceRecord): void {
        const node = new ResourceNode(record.def.resourceType, record.def.position, record.life, record.respawnRemainingSec, this.screenHost);
        this.world.add(node);
        this.threeScene.add(node.transform);
        record.node = node;
    }

    private dematerialize(record: ResourceRecord): void {
        const node = record.node;
        if (!node) {
            return;
        }
        record.life = node.remainingLife;
        record.respawnRemainingSec = node.respawnRemaining;
        this.world.remove(node);
        record.node = undefined;
    }
}
