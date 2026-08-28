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
import { buildZoneTileCells, DEFAULT_TILE_MAP_ALIASES, WORLD_UNITS_PER_TILE } from './TileMapConfig';
import { FOG_OF_WAR_CONFIG } from './FogOfWarConfig';

interface Registrant {
    object: THREE.Object3D;
    zones: number[];
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
     * initial visibility immediately from the zones' CURRENT reveal state.
     */
    public register(object: THREE.Object3D, worldX: number, worldZ: number, width = this.worldUnitsPerTile, depth = this.worldUnitsPerTile): void {
        this.addRegistrant(object, this.zonesForFootprint(worldX, worldZ, width, depth));
    }

    /**
     * Same as register(), but for a caller that already knows exactly which zone(s) it belongs
     * to (e.g. IslandMeshBuilder, which builds one merged mesh per zone already and would
     * otherwise have to re-derive that from the mesh's own geometry bounds). Pass an empty
     * array for "belongs to no zone" (permanently hidden — see this file's own doc).
     */
    public registerWithZones(object: THREE.Object3D, zones: number[]): void {
        this.addRegistrant(object, zones);
    }

    /** Stops driving `object`'s visibility — call when a registered entity is torn down (e.g. WorldManager.dematerialize()) so its Registrant doesn't linger forever. Leaves `object.visible` as it last was. */
    public unregister(object: THREE.Object3D): void {
        const index = this.registrants.findIndex(r => r.object === object);
        if (index === -1) {
            return;
        }
        const [registrant] = this.registrants.splice(index, 1);
        for (const zoneNumber of registrant.zones) {
            const list = this.registrantsByZone.get(zoneNumber);
            const zoneIndex = list?.indexOf(registrant) ?? -1;
            if (zoneIndex !== -1) {
                list!.splice(zoneIndex, 1);
            }
        }
    }

    /** Reveals `zoneNumber` (0-based, see TileMapConfig.buildZoneTileCells()'s own doc — "zone1" is zoneNumber 0) and updates every registrant that overlaps it. Idempotent. */
    public revealZone(zoneNumber: number): void {
        if (this.revealedZones.has(zoneNumber)) {
            return;
        }
        this.revealedZones.add(zoneNumber);
        for (const registrant of this.registrantsByZone.get(zoneNumber) ?? []) {
            this.applyVisibility(registrant);
        }
    }

    public isZoneRevealed(zoneNumber: number): boolean {
        return this.revealedZones.has(zoneNumber);
    }

    /** The zone number painted at this tile-grid cell — undefined if the cell has no zone at all. Exposed for IslandMeshBuilder, which needs to partition its own per-cell blobs by zone before merging (see that file's own doc), and for TileMap.isWalkableAt()'s own per-cell check. */
    public getZoneForCell(col: number, row: number): number | undefined {
        return this.cellToZone.get(cellKey(col, row));
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

    private addRegistrant(object: THREE.Object3D, zones: number[]): void {
        const registrant: Registrant = { object, zones };
        this.registrants.push(registrant);
        for (const zoneNumber of zones) {
            let list = this.registrantsByZone.get(zoneNumber);
            if (!list) {
                list = [];
                this.registrantsByZone.set(zoneNumber, list);
            }
            list.push(registrant);
        }
        this.applyVisibility(registrant);
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

    private applyVisibility(registrant: Registrant): void {
        registrant.object.visible = this.resolveVisible(registrant.zones);
    }
}
