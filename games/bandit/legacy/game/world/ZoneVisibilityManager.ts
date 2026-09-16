// ZoneVisibilityManager.ts
//
// The single zone-lock authority — NOT tied to FOG_OF_WAR_CONFIG.style, unlike its name might
// suggest. WorldManager builds exactly one of these regardless of which visual style is active,
// because two things must hold true no matter how a locked zone LOOKS:
//   1. A locked zone must not be WALKABLE — see TileMap.isWalkableAt(), which now also consults
//      this via isPositionUnlocked(). A cell with no zone at all counts as locked too (the
//      "if there's no zone there, treat it as water" rule) — same default a registrant with no
//      overlapping zone gets below.
//   2. A locked zone's resources/animals must not be MATERIALIZED at all — not spawned, no
//      RigidBody, no gather/catch trigger — see WorldManager/DynamicResourceSpawner/
//      ShapeResourceSpawner's own materialize() methods, each of which now checks
//      isPositionUnlocked() before creating anything. Merely hiding an already-live node
//      (`visible = false`) neither frees its memory nor stops it from being interacted with —
//      that was the actual bug this fixes: a hidden resource could still be gathered, a hidden
//      animal still caught.
//
// On TOP of that always-on lock enforcement, FOG_OF_WAR_CONFIG.style picks how a locked zone
// is actually RENDERED: every registered THREE.Object3D (ground blob meshes from
// IslandMeshBuilder, resource nodes, buildings, shops, queues, gates, ...) gets its `visible`
// flag tied to the same zone-reveal state via register()/registerWithZones() below, regardless
// of style — under HideEntities that's the only visual treatment; under BoxCloud it runs
// ALONGSIDE FogOfWarManager's opaque box volumes, so the (now also invisible) gap left by a
// hidden zone reads as solid cloud instead of an empty hole in the world.
//
// A registrant's footprint (a world-space rect centered at a point — a point entity just
// passes a rect the size of one tile) is converted to the tile-grid cells it covers, then to
// the SET of zone numbers those cells carry (see TileMapConfig.buildZoneTileCells()) — a cell
// with no zone contributes nothing. FOG_OF_WAR_CONFIG.overlapMode decides how a registrant (or
// isPositionUnlocked() query) touching more than one zone resolves: 'any' unlocks/shows the
// moment ONE of those zones is revealed, 'all' waits for every one of them. Touching NO zone at
// all resolves to permanently locked/hidden.

import * as THREE from 'three';
import gsap from 'gsap';
import { buildZoneTileCells, DEFAULT_TILE_MAP_ALIASES, WORLD_UNITS_PER_TILE } from './TileMapConfig';
import { FOG_OF_WAR_CONFIG, ZONE_REVEAL_CONFIG } from './FogOfWarConfig';

interface Registrant {
    object: THREE.Object3D;
    zones: number[];
    /** World-space position this registrant is anchored at — used ONLY to time the rise-animation's wave delay by distance from a reveal's `origin` (see revealZone()'s own doc); the plain instant-visibility path never reads this. */
    worldX: number;
    worldZ: number;
    /** `object.position.y` at the moment this was registered — the rise animation's target, and what SETTING it should restore to whenever it plays. */
    baseY: number;
    /** Last visibility this manager actually applied — lets revealZone() tell a hidden->visible TRANSITION (which gets the rise animation) apart from a registrant that was already visible (which doesn't need to replay it). */
    visible: boolean;
    /** Flat extra delay stacked on top of the wave-travel delay — see ZONE_REVEAL_CONFIG.categoryDelaySec's own doc for why terrain/props/creatures need to rise in that order rather than all at once. */
    categoryDelaySec: number;
}

/** One past revealZone() call's own (origin, when) — see findEchoOrigin()'s own doc for why a LATE registration (a resource/animal materializing after the fact) needs to look this up instead of always popping in instantly. */
interface RevealRecord {
    origin: THREE.Vector3;
    atMs: number;
}

function cellKey(col: number, row: number): string {
    return `${col},${row}`;
}

export default class ZoneVisibilityManager {
    private readonly cellToZone = new Map<string, number>();
    private readonly revealedZones = new Set<number>();
    private readonly registrants: Registrant[] = [];
    /** zoneNumber -> every registrant that overlaps it — so revealZone() only re-checks entries that could possibly change, not the whole list. */
    private readonly registrantsByZone = new Map<number, Registrant[]>();
    /** zoneNumber -> that reveal's own (origin, when) — see findEchoOrigin()'s own doc. Only ever set by revealZone() calls that were given an `origin`; a zone revealed with none (e.g. buildGround()'s initial zone-0 reveal) just never gets an entry, so a late registration into it correctly falls back to an instant, un-delayed pop. */
    private readonly revealRecords = new Map<number, RevealRecord>();

    public constructor(
        private readonly worldUnitsPerTile: number = WORLD_UNITS_PER_TILE,
        mapAlias: string = DEFAULT_TILE_MAP_ALIASES.map,
    ) {
        for (const [zoneNumber, cells] of buildZoneTileCells(mapAlias)) {
            for (const { col, row } of cells) {
                this.cellToZone.set(cellKey(col, row), zoneNumber);
            }
        }
    }

    /**
     * Registers `object` — its `visible` flag is what this manager drives from now on; never
     * set it externally afterward, or the two will fight — with a world-space footprint
     * centered at (worldX, worldZ). width/depth default to a single tile, good enough for a
     * point entity (a resource node); pass an entity's real footprint (BuildingZone/ShopZone/
     * QueueZone/CraftZone/Gate's own `{width, depth}`) for anything bigger. Sets the object's
     * initial visibility immediately from the zones' CURRENT reveal state — see
     * ZONE_REVEAL_CONFIG.categoryDelaySec's own doc for what `categoryDelaySec` is for (default
     * 0 — pass ZONE_REVEAL_CONFIG.categoryDelaySec.props/creatures for anything that should
     * rise after plain terrain).
     */
    public register(object: THREE.Object3D, worldX: number, worldZ: number, width = this.worldUnitsPerTile, depth = this.worldUnitsPerTile, categoryDelaySec = 0): void {
        this.addRegistrant(object, this.zonesForFootprint(worldX, worldZ, width, depth), worldX, worldZ, categoryDelaySec);
    }

    /**
     * Same as register(), but for a caller that already knows exactly which zone(s) it belongs
     * to (e.g. IslandMeshBuilder, which builds one merged mesh per zone already and would
     * otherwise have to re-derive that from the mesh's own geometry bounds). Pass an empty
     * array for "belongs to no zone" (permanently hidden — see this file's own doc).
     * `worldX`/`worldZ` (a representative point — e.g. that mesh's own cells' centroid) only
     * feed the rise-animation's wave delay (see this file's own doc); default (0, 0) if
     * omitted, which just means "no wave delay" for that registrant. `categoryDelaySec` — see
     * register()'s own doc.
     */
    public registerWithZones(object: THREE.Object3D, zones: number[], worldX = 0, worldZ = 0, categoryDelaySec = 0): void {
        this.addRegistrant(object, zones, worldX, worldZ, categoryDelaySec);
    }

    /** Stops driving `object`'s visibility — call when a registered entity is torn down (e.g. WorldManager.dematerialize()) so its Registrant doesn't linger forever. Leaves `object.visible` as it last was. Also cancels any in-flight rise tween (see playRiseAnimation()) — a registrant torn down mid-rise (dematerialized right as its zone unlocks) shouldn't keep animating a position nobody's driving anymore. */
    public unregister(object: THREE.Object3D): void {
        const index = this.registrants.findIndex(r => r.object === object);
        if (index === -1) {
            return;
        }
        gsap.killTweensOf(object.position);
        const [registrant] = this.registrants.splice(index, 1);
        for (const zoneNumber of registrant.zones) {
            const list = this.registrantsByZone.get(zoneNumber);
            const zoneIndex = list?.indexOf(registrant) ?? -1;
            if (zoneIndex !== -1) {
                list!.splice(zoneIndex, 1);
            }
        }
    }

    /**
     * Reveals `zoneNumber` (0-based, see TileMapConfig.buildZoneTileCells()'s own doc —
     * "zone1" is zoneNumber 0) and updates every registrant that overlaps it. Idempotent.
     *
     * `origin` (typically the player's own position at the moment this fires — see
     * WorldManager.revealNextZone()) is what makes this a SHOCKWAVE rather than an instant
     * pop: a registrant transitioning from hidden to visible plays a rise-from-below tween
     * (see playRiseAnimation()) delayed by its own distance from `origin`, at
     * ZONE_REVEAL_CONFIG.waveSpeed — the exact same speed ZoneRevealEffect's ring travels at,
     * so the two visually line up. Omit `origin` (e.g. buildGround()'s own initial zone-0
     * reveal, with no meaningful player position yet) for an instant, un-delayed pop instead.
     * A registrant that was ALREADY visible (its zones were revealed some other way — 'any'
     * overlap mode, or FOG_OF_WAR_CONFIG changed) is left alone rather than replaying the rise.
     */
    public revealZone(zoneNumber: number, origin?: THREE.Vector3): void {
        if (this.revealedZones.has(zoneNumber)) {
            return;
        }
        this.revealedZones.add(zoneNumber);
        if (origin) {
            // See findEchoOrigin()'s own doc — a resource/animal that only gets CREATED (and
            // so only calls register()) one or more frames after this, once its own
            // materialize() gate opens, still needs to look this up to play the same wave
            // instead of popping in instantly.
            this.revealRecords.set(zoneNumber, { origin: origin.clone(), atMs: performance.now() });
        }

        for (const registrant of this.registrantsByZone.get(zoneNumber) ?? []) {
            const wasVisible = registrant.visible;
            const nowVisible = this.resolveVisible(registrant.zones);
            registrant.visible = nowVisible;

            if (nowVisible && !wasVisible) {
                this.playRiseAnimation(registrant, origin);
            } else {
                registrant.object.visible = nowVisible;
            }
        }
    }

    public isZoneRevealed(zoneNumber: number): boolean {
        return this.revealedZones.has(zoneNumber);
    }

    /** The zone number painted at this tile-grid cell — undefined if the cell has no zone at all. Exposed for IslandMeshBuilder, which needs to partition its own per-cell blobs by zone before merging (see that file's own doc), and for TileMap.isWalkableAt()'s own per-cell check. */
    public getZoneForCell(col: number, row: number): number | undefined {
        return this.cellToZone.get(cellKey(col, row));
    }

    /** getZoneForCell(), from a world-space point instead of an already-converted tile cell — the col/row math itself (worldX/worldUnitsPerTile, floored) used to be duplicated ad hoc by every caller that only had a live THREE.Vector3 (ZoneTutorialController's own currentZoneNumber(), MovementTutorialOverlay's own zone check) rather than a tile cell; this is that conversion, centralized once. */
    public getZoneForPosition(worldX: number, worldZ: number): number | undefined {
        const col = Math.floor(worldX / this.worldUnitsPerTile);
        const row = Math.floor(worldZ / this.worldUnitsPerTile);
        return this.getZoneForCell(col, row);
    }

    /**
     * True if a point (or small footprint — width/depth default to one tile) at (worldX,
     * worldZ) is unlocked right now — same zones-then-overlapMode resolution register() uses,
     * just without registering anything for later updates. This is the CORE enforcement query
     * (see this file's own doc): TileMap.isWalkableAt() calls it to block movement into a
     * locked zone, and every materialize() across WorldManager/DynamicResourceSpawner/
     * ShapeResourceSpawner calls it before creating any live node at all — a locked resource
     * is never spawned in the first place, not spawned-then-hidden.
     */
    public isPositionUnlocked(worldX: number, worldZ: number, width = this.worldUnitsPerTile, depth = this.worldUnitsPerTile): boolean {
        return this.resolveVisible(this.zonesForFootprint(worldX, worldZ, width, depth));
    }

    private addRegistrant(object: THREE.Object3D, zones: number[], worldX: number, worldZ: number, categoryDelaySec: number): void {
        const registrant: Registrant = { object, zones, worldX, worldZ, baseY: object.position.y, visible: false, categoryDelaySec };
        this.registrants.push(registrant);
        for (const zoneNumber of zones) {
            let list = this.registrantsByZone.get(zoneNumber);
            if (!list) {
                list = [];
                this.registrantsByZone.set(zoneNumber, list);
            }
            list.push(registrant);
        }

        const visible = this.resolveVisible(zones);
        registrant.visible = visible;
        if (!visible) {
            object.visible = false;
            return;
        }

        // A LATE registration (a resource/animal only just materialized, one or more frames
        // after its zone's own revealZone() already ran — see materialize()'s own doc across
        // WorldManager/DynamicResourceSpawner/ShapeResourceSpawner) still echoes that reveal's
        // wave instead of popping in instantly, as long as it's within the echo window — see
        // findEchoOrigin()'s own doc. Outside that window (a resource streamed in during
        // ordinary exploration of a long-since-revealed zone), it just appears normally — it
        // likely already played its own spawn-in tween (e.g. ResourceNode.playSpawnIn())
        // right before this call anyway.
        const echoOrigin = this.findEchoOrigin(zones);
        if (echoOrigin !== undefined) {
            this.playRiseAnimation(registrant, echoOrigin);
        } else {
            object.visible = true;
        }
    }

    /**
     * The freshest still-within-window reveal origin among `zones`, or undefined if none of
     * them were revealed recently enough (see ZONE_REVEAL_CONFIG.revealEchoWindowMs's own
     * doc) — or were revealed with no origin at all (an instant, un-delayed reveal, e.g.
     * buildGround()'s own zone-0). Only ever called for a registrant that's ALREADY resolved
     * visible=true, so every zone checked here is guaranteed revealed; this only decides
     * whether that reveal is recent enough to still be worth echoing.
     */
    private findEchoOrigin(zones: number[]): THREE.Vector3 | undefined {
        const now = performance.now();
        let freshest: RevealRecord | undefined;
        for (const zoneNumber of zones) {
            const record = this.revealRecords.get(zoneNumber);
            if (record && now - record.atMs <= ZONE_REVEAL_CONFIG.revealEchoWindowMs) {
                if (!freshest || record.atMs > freshest.atMs) {
                    freshest = record;
                }
            }
        }
        return freshest?.origin;
    }

    /** Every zone number the tile-grid cells under (worldX, worldZ, width, depth) carry — a cell with no zone contributes nothing, so a footprint entirely outside any zone resolves to an empty array (permanently locked/hidden — see this file's own doc). */
    private zonesForFootprint(worldX: number, worldZ: number, width: number, depth: number): number[] {
        const minCol = Math.floor((worldX - width / 2) / this.worldUnitsPerTile);
        const maxCol = Math.floor((worldX + width / 2) / this.worldUnitsPerTile);
        const minRow = Math.floor((worldZ - depth / 2) / this.worldUnitsPerTile);
        const maxRow = Math.floor((worldZ + depth / 2) / this.worldUnitsPerTile);

        const zones = new Set<number>();
        for (let row = minRow; row <= maxRow; row++) {
            for (let col = minCol; col <= maxCol; col++) {
                const zoneNumber = this.cellToZone.get(cellKey(col, row));
                if (zoneNumber !== undefined) {
                    zones.add(zoneNumber);
                }
            }
        }
        return [...zones];
    }

    /** Shared resolution logic — see isPositionUnlocked()'s own doc and this file's own doc for the "no zone at all" default. */
    private resolveVisible(zones: number[]): boolean {
        if (zones.length === 0) {
            return false;
        }
        return FOG_OF_WAR_CONFIG.overlapMode === 'any'
            ? zones.some(zoneNumber => this.revealedZones.has(zoneNumber))
            : zones.every(zoneNumber => this.revealedZones.has(zoneNumber));
    }

    /**
     * "Appear from the bottom" — see revealZone()'s own doc. `delay` (the object's own
     * distance from `origin` at ZONE_REVEAL_CONFIG.waveSpeed, PLUS its own categoryDelaySec —
     * see ZONE_REVEAL_CONFIG.categoryDelaySec's own doc for why terrain/props/creatures stack
     * in that order even at the SAME distance from the wave's origin) is when the RISE itself
     * should visibly start — the object stays fully HIDDEN for that entire wait (position is
     * set to its sunken start now, but visible stays false until onStart actually fires once
     * the delay elapses), not sitting there sunk-and-visible the whole time. Setting
     * `object.visible = true` up front, before the delay, was the actual bug: it rendered the
     * object motionless at its sunken position for the whole wave/category delay — reading
     * as "stuck underwater," not "about to rise" — instead of only appearing once it's
     * actually animating.
     */
    private playRiseAnimation(registrant: Registrant, origin?: THREE.Vector3): void {
        const object = registrant.object;
        object.visible = false;
        object.position.y = registrant.baseY - ZONE_REVEAL_CONFIG.riseDistance;

        const waveDelay = origin
            ? Math.hypot(registrant.worldX - origin.x, registrant.worldZ - origin.z) / ZONE_REVEAL_CONFIG.waveSpeed
            : 0;

        gsap.to(object.position, {
            y: registrant.baseY,
            duration: ZONE_REVEAL_CONFIG.riseDurationSec,
            delay: waveDelay + registrant.categoryDelaySec,
            ease: 'back.out(1.4)',
            onStart: () => { object.visible = true; },
        });
    }
}
