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
import { Signal } from 'signals';
import World from '../ecs/World';
import RigidBody from '../physics/RigidBody';
import { Layers } from '../physics/PhysicsConstants';
import ResourceNode from '../player/ResourceNode';
import { PROVIDER_CONFIG } from '../actions/ProviderTypes';
import {
    FLOOR_SIZE, GROUND_HALF_THICKNESS,
    ResourceSpawnDef
} from './WorldConfig';
import TileMap from './TileMap';
import IslandMeshBuilder from './IslandMeshBuilder';
import { buildResourceSpawnsFromTileMap, DEFAULT_TILE_MAP_ALIASES } from './TileMapConfig';
import FogOfWarManager from './FogOfWarManager';
import ZoneVisibilityManager from './ZoneVisibilityManager';
import { playZoneRevealShockwave } from './ZoneRevealEffect';
import { FOG_OF_WAR_CONFIG, FogOfWarStyle, ZONE_REVEAL_CONFIG } from './FogOfWarConfig';
import { ScreenAnchorHost } from '../components/ScreenAnchorComponent';
import { PERFORMANCE_CONFIG } from '../config/PerformanceConfig';
import { ZONE_CONFIG } from '../data/ZoneTypes';
import { isMilestoneRequirementMet } from '../data/MilestoneRequirement';
import { DebugZoneRevealCookie } from '../utils/DebugZoneRevealCookie';

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
    /** Opaque box-volume visual (FOG_OF_WAR_CONFIG.style === BoxCloud only) — runs ALONGSIDE zoneVisibility, not instead of it (see ZoneVisibilityManager.ts's own doc for why lock enforcement is always on regardless of style). undefined under HideEntities. */
    private readonly fogOfWarManager?: FogOfWarManager;
    /** The zone-lock authority — ALWAYS constructed regardless of FOG_OF_WAR_CONFIG.style, since walkability and materialize-gating (see ZoneVisibilityManager.ts's own doc) must hold no matter how a locked zone is rendered. Exposed via getZoneVisibilityManager() so PizzaScene can register buildings/shops/queues/gates the same way WorldManager registers its own ground/resources. */
    private readonly zoneVisibility: ZoneVisibilityManager;
    /** zone1 (zoneNumber 0) is revealed in the constructor — see this file's own doc — so this starts at 1: the next zoneNumber revealNextZone() reveals. Purely a debug/test convenience (see PizzaScene's "Open Next Zone"/"Teleport: Next" buttons) for walking through the unlock sequence one zone at a time without a real requirement/trigger system yet. Actually seeded from DebugZoneRevealCookie in buildGround() (catching zoneVisibility itself up to match, since a fresh page load starts THAT with a blank revealedZones set regardless of this counter) — 1 here is just the pre-catch-up default. */
    private nextZoneToReveal = 1;
    /** The player's own position as of the most recent update() call — see revealNextZone()'s own doc for why it needs this: the shockwave/rise-animation effect (ZoneRevealEffect.ts, ZoneVisibilityManager.revealZone()'s `origin` param) has to expand from wherever the player is actually standing, not from world origin. Starts at world origin (a reasonable stand-in before the first update() call, e.g. if a debug button somehow fires before the first frame ticks). */
    private lastPlayerPosition = new THREE.Vector3();
    /** Dispatched (with the revealed zoneNumber) every time revealZoneWithEffect() actually reveals one — PizzaScene subscribes to briefly freeze player movement, same reasoning Gate.playUnlockSequence()'s own focusCameraOn() call already freezes it for a gate's camera trip: give the shockwave/rise animation a moment to finish before the player can walk off mid-reveal. */
    public readonly onZoneRevealed: Signal = new Signal();

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
            this.records.set(def.id, { def, life: PROVIDER_CONFIG[def.providerType].maxLife });
        }
        // Built BEFORE tileMap so TileMap.isWalkableAt() can consult it from the start —
        // always constructed regardless of FOG_OF_WAR_CONFIG.style, see this field's own doc.
        this.zoneVisibility = new ZoneVisibilityManager(undefined, tileMapAliases.map);
        this.tileMap = new TileMap(threeScene, tileMapAliases.map, tileMapAliases.tiles, undefined, this.zoneVisibility);
        this.islandMeshBuilder = new IslandMeshBuilder(threeScene);

        // FOG_OF_WAR_CONFIG.style only picks the ADDITIONAL visual on top of always-on lock
        // enforcement (see ZoneVisibilityManager.ts's own doc) — a one-line config edit, not a
        // code change, to compare the two looks.
        if (FOG_OF_WAR_CONFIG.style === FogOfWarStyle.BoxCloud) {
            this.fogOfWarManager = new FogOfWarManager(threeScene, undefined, tileMapAliases.map);
        }
    }

    /** The zone-lock authority (see its own doc) — PizzaScene reads this to register buildings/shops/queues/gates so their visibility tracks zone reveal state the same way WorldManager's own ground/resources do. */
    public getZoneVisibilityManager(): ZoneVisibilityManager {
        return this.zoneVisibility;
    }

    /**
     * Debug/test convenience (see PizzaScene's "Open Next Zone" button, InGameButtonList.ts) —
     * reveals whichever zoneNumber comes after the last one this called revealed (starting at
     * 1, since zone 0 is already revealed at buildGround() — see nextZoneToReveal's own doc).
     * No-op past the last zone the map's "zones" layer actually paints (revealZoneWithEffect()
     * itself just finds nothing to reveal); doesn't warn, since "already fully unlocked" is a
     * completely normal state to call this in, not a mistake. Bypasses ZONE_CONFIG entirely —
     * this is for manually walking through the sequence while testing, independent of whatever
     * real requirement (if any) a zone's own ZoneTypes.ts entry has configured.
     */
    public revealNextZone(): void {
        this.revealZoneWithEffect(this.nextZoneToReveal++);
        // Persisted on every debug reveal (not just once at the end of a revealUpToZone() loop)
        // so even a single "Open Next Zone" click survives a reload — see
        // DebugZoneRevealCookie.ts's own doc.
        DebugZoneRevealCookie.setNextZoneToReveal(this.nextZoneToReveal);
    }

    /**
     * Debug/test convenience (see the "Teleport" button, InGameButtonList.ts) — reveals every
     * zone from wherever revealNextZone() last left off up through `zoneNumber` (inclusive), so
     * a debug-teleport straight into e.g. zone 5 doesn't strand the player in a bubble of
     * revealed ground surrounded by locked/hidden zones 1-4 it never walked through normally.
     * Just a loop over the same revealNextZone() path (same shockwave/rise treatment per zone,
     * same bypass-ZONE_CONFIG debug semantics) — no separate reveal logic of its own. A no-op
     * for a zoneNumber already covered by a prior reveal (nextZoneToReveal already past it).
     */
    public revealUpToZone(zoneNumber: number): void {
        while (this.nextZoneToReveal <= zoneNumber) {
            this.revealNextZone();
        }
    }

    /**
     * Checks every zoneNumber with a `requirement` configured in ZONE_CONFIG (see
     * ZoneTypes.ts's own doc — set from the pizza web editor's Zones tab) and reveals any
     * that's both not-yet-revealed and now met, through the same revealZoneWithEffect() path
     * revealNextZone() uses (same shockwave/rise treatment either way). Called every frame
     * from update() — cheap (ZONE_CONFIG only ever has as many entries as the map has zones,
     * and isMilestoneRequirementMet() is a single storage lookup), same "just rescan, no
     * event wiring needed" reasoning update()'s own resource-streaming loop already uses.
     */
    private checkZoneRequirements(): void {
        for (const [zoneNumberKey, entry] of Object.entries(ZONE_CONFIG)) {
            if (!entry?.requirement) {
                continue;
            }
            const zoneNumber = Number(zoneNumberKey);
            if (this.zoneVisibility.isZoneRevealed(zoneNumber)) {
                continue;
            }
            if (isMilestoneRequirementMet(entry.requirement)) {
                this.revealZoneWithEffect(zoneNumber);
            }
        }
    }

    /**
     * The actual reveal, shared by revealNextZone() and checkZoneRequirements() — through
     * BOTH the always-on zoneVisibility AND, when active, fogOfWarManager (same pair
     * buildGround() reveals zone 0 through), passing lastPlayerPosition as the reveal's
     * `origin` (see ZoneVisibilityManager.revealZone()'s own doc) and firing the matching
     * shockwave ring (ZoneRevealEffect.ts) from that same point, at the same
     * ZONE_REVEAL_CONFIG.waveSpeed — that's what makes the newly-visible ground/resources/
     * buildings rise up in sync with the ring sweeping past them, instead of just popping in
     * all at once.
     *
     * A zone gated on a 'trigger' MilestoneRequirement (see MilestoneRequirement.ts/
     * Trigger.ts) goes through this exact same path too, with zero code of its own — it's just
     * another requirement kind checkZoneRequirements() already polls every frame, same as
     * building/item/resource/gate.
     */
    private revealZoneWithEffect(zoneNumber: number): void {
        this.fogOfWarManager?.revealZone(zoneNumber);
        this.zoneVisibility.revealZone(zoneNumber, this.lastPlayerPosition);
        playZoneRevealShockwave(this.threeScene, this.lastPlayerPosition);
        console.log(`[WorldManager] revealed zone${zoneNumber + 1} (zoneNumber ${zoneNumber})`);
        this.onZoneRevealed.dispatch(zoneNumber);
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
            this.islandMeshBuilder.build(this.tileMap, this.zoneVisibility);
        }

        this.fogOfWarManager?.build(this.tileMap);
        // zone1 (zoneNumber 0, see TileMapConfig.ZONE_LAYER_NAME's own doc) is unlocked from
        // the moment the game starts — every other zone stays locked (unwalkable, nothing
        // materializes in it, and hidden/fogged depending on style) until something else (a
        // future unlock flow) calls revealZone() for it.
        this.fogOfWarManager?.revealZone(0);
        this.zoneVisibility.revealZone(0);

        // Catches zoneVisibility (and nextZoneToReveal itself) up to match whatever a PRIOR
        // session's debug reveals had already unlocked (see DebugZoneRevealCookie.ts's own
        // doc) — a fresh page load always starts zoneVisibility.revealedZones as a blank Set
        // regardless of this cookie, so without this a tester who'd debug-unlocked through
        // zone 5 last session would reload back into a locked zone 1. No origin passed (see
        // revealZone()'s own doc) — an instant, un-delayed pop for every zone being caught up
        // at once, not a travelling shockwave from nowhere meaningful.
        const persistedNextZoneToReveal = DebugZoneRevealCookie.getNextZoneToReveal();
        for (let zone = 1; zone < persistedNextZoneToReveal; zone++) {
            this.fogOfWarManager?.revealZone(zone);
            this.zoneVisibility.revealZone(zone);
        }
        this.nextZoneToReveal = persistedNextZoneToReveal;
    }

    /**
     * True if a NOT-YET-DEPLETED resource sits within `radius` of `(worldX, worldZ)` — checked
     * against every record's own `def.position` (see the ResourceRecord interface's own doc),
     * not just currently-materialized ResourceNode entities, so this stays correct for a
     * resource that's out of range and dematerialized but still very much occupying its tile.
     * A record mid-respawn (`respawnRemainingSec !== undefined`) is skipped — there's nothing
     * actually standing there right now — same "depleted means gone until it respawns"
     * distinction update() itself already draws. Used by PizzaScene's "is the player on a
     * stable tile" check (see PlayerPositionStorage.ts's own doc) to rule out saving a
     * respawn point sitting on top of a tree/deposit/bush.
     */
    public hasResourceAt(worldX: number, worldZ: number, radius: number): boolean {
        const radiusSq = radius * radius;
        for (const record of this.records.values()) {
            if (record.respawnRemainingSec !== undefined) {
                continue;
            }
            const dx = record.def.position.x - worldX;
            const dz = record.def.position.z - worldZ;
            if (dx * dx + dz * dz <= radiusSq) {
                return true;
            }
        }
        return false;
    }

    /**
     * Streams resource nodes in/out around the player and keeps every off-screen respawn
     * timer ticking regardless of whether it's currently materialized — see this file's
     * own doc for why that second part matters.
     */
    public update(playerPosition: THREE.Vector3, delta: number): void {
        // See lastPlayerPosition's own doc — revealNextZone() needs a recent player position
        // to expand the reveal shockwave from, and this is the only place one's available.
        this.lastPlayerPosition.copy(playerPosition);

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
                    record.life = PROVIDER_CONFIG[record.def.providerType].maxLife;
                }
            }

            if (distanceSq <= loadRadiusSq) {
                this.materialize(record);
            }
        }

        this.checkZoneRequirements();
        this.fogOfWarManager?.update(delta);
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
        this.fogOfWarManager?.destroy();
    }

    /**
     * No-ops entirely (leaves record.node undefined) if this position's zone is still locked
     * — see ZoneVisibilityManager.ts's own doc for why that has to happen HERE, before
     * creating anything, rather than creating a real ResourceNode (mesh + RigidBody + gather
     * trigger) and merely hiding it: a hidden-but-live node still has a working trigger area,
     * so it could still be gathered despite being invisible. update()'s per-frame distance
     * check retries this every frame a record is in range, so the moment its zone unlocks
     * (revealZone()), the very next tick materializes it for real — no extra reveal hook
     * needed.
     */
    private materialize(record: ResourceRecord): void {
        if (!this.zoneVisibility.isPositionUnlocked(record.def.position.x, record.def.position.z)) {
            return;
        }

        const node = new ResourceNode(record.def.providerType, record.def.position, record.life, record.respawnRemainingSec, this.screenHost);
        this.world.add(node);
        this.threeScene.add(node.transform);
        record.node = node;
        // See RESOURCE_POP_IN_SEC's own doc (WorldConfig.ts) — scales in instead of
        // snapping straight to full size the instant this streams into LOAD_RADIUS.
        node.playSpawnIn();
        // Only matters under FogOfWarStyle.HideEntities (BoxCloud's opaque box already
        // covers this) — registered anyway since it's a harmless no-op otherwise, and this
        // point is already known unlocked so it's immediately visible. `props` category delay
        // — see ZONE_REVEAL_CONFIG.categoryDelaySec's own doc — so a resource rising as part
        // of a fresh zone reveal's echo (see ZoneVisibilityManager.addRegistrant()'s own doc)
        // rises AFTER the terrain it's standing on, not at the same instant.
        this.zoneVisibility.register(
            node.transform, record.def.position.x, record.def.position.z,
            undefined, undefined, ZONE_REVEAL_CONFIG.categoryDelaySec.props,
        );
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
        this.zoneVisibility.unregister(node.transform);
        node.playDespawnOut(() => this.world.remove(node));
    }
}
