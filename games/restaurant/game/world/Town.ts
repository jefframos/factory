// Town.ts
//
// The street round the restaurant, at a stage: the layout's road cells laid as road tiles, its lawns, cars driving the
// roads and areas of people wandering about (core/town: the UFO game's city pieces; levels/restaurant.json says where,
// settings.json `town` how they look and move). People keep off the walls and the roads; the doors don't open for them.
// Everything bends with the rest (the scene's bendAll).

import * as THREE from 'three';
import { roadCellAt, roadCellKey, roadNetwork } from 'core/roads/RoadGrid';
import { buildLawn, buildRoads } from 'core/town/Ground';
import { Traffic, spreadCars } from 'core/town/Traffic';
import { Crowd, type CrowdArea, type CrowdPaths } from 'core/town/Crowd';
import { shownAt } from 'core/rooms/Room';
import { SETTINGS } from '../data/Settings';
import { LAYOUT_DATA } from './RestaurantLayout';
import { crowdAssets, townModel } from './Models';

export type TownMode = 'restaurant' | 'delivery';

/** Lawns sit a hair over the street floor, each a hair over the last (so overlapping ones don't flicker). */
const LAWN_Y = 0.025;
const LAWN_STEP = 0.002;
/** People stay this far from a wall's middle line (past half its thickness), and off a road tile's edge by this. */
const WALL_CLEARANCE = 0.45;
const ROAD_MARGIN = 0.3;
/** And this far from a prop's footprint. */
const BLOCKER_CLEARANCE = 0.4;

export class Town {
    public readonly group = new THREE.Group();
    private traffic: Traffic | null = null;
    private crowd: Crowd | null = null;
    private gone = false;
    private readonly roadCells = new Set<string>();
    /** Where road cell (0, 0)'s middle is. */
    private readonly origin: { x: number; z: number };
    /** The walls standing at this stage, as segments with their half thickness. */
    private readonly walls: { ax: number; az: number; bx: number; bz: number; half: number }[] = [];
    /** What stands on the ground (a prop's footprint, `collider`: an imported town's buildings, trees ...), as boxes. */
    private readonly blockers: { x: number; z: number; halfX: number; halfZ: number }[] = [];
    /** Resolves once the road tiles and cars are in (the people come straight away). */
    public readonly ready: Promise<void>;

    /** `mode`: 'restaurant' (a few people about: settings.json town.people.restaurant), or 'delivery' (the whole town's). */
    public constructor(stage: number, mode: TownMode = 'restaurant') {
        this.group.name = 'town';
        const layout = LAYOUT_DATA;
        const areas = layout.areas ?? [];
        this.origin = layout.roads?.origin ?? { x: 0, z: 0 };
        for (const [i, j] of layout.roads?.cells ?? []) this.roadCells.add(roadCellKey(i, j));
        this.collectWalls(stage);
        this.collectBlockers(stage);

        // Lawns.
        (layout.lawns ?? []).filter((lawn) => shownAt(lawn, stage, areas, lawn.points[0])).forEach((lawn, i) => {
            const mesh = buildLawn(lawn, LAWN_Y + i * LAWN_STEP);
            if (mesh) this.group.add(mesh);
        });

        // Roads (their models first), then the cars on them.
        this.ready = this.buildRoadsAndCars();

        // People: wandering their areas, kept off the walls and the roads (the light crowd models, loaded on the way).
        let crowdAreas = (layout.people?.areas ?? []).filter((area) => shownAt(area, stage, areas));
        const allPaths = layout.people?.paths;
        let walkers = allPaths?.walkers ?? 0;
        const cap = SETTINGS.town.people.restaurant;
        if (mode === 'restaurant' && cap) {
            crowdAreas = this.nearestPeople(crowdAreas, cap.people);
            walkers = Math.min(walkers, cap.walkers);
        }
        const paths = allPaths && { ...allPaths, walkers };
        if (crowdAreas.length || walkers) void this.buildCrowd(crowdAreas, paths);
    }

    /**
     * The crowd's areas trimmed to `max` people, the areas nearest the restaurant (the middle of its walls standing at this
     * stage) first: the restaurant only needs a few people about; the delivery mode has the whole town's.
     */
    private nearestPeople(areas: CrowdArea[], max: number): CrowdArea[] {
        const middle = { x: 0, z: 0 };
        if (this.walls.length) {
            const xs = this.walls.flatMap((w) => [w.ax, w.bx]);
            const zs = this.walls.flatMap((w) => [w.az, w.bz]);
            middle.x = (Math.min(...xs) + Math.max(...xs)) / 2;
            middle.z = (Math.min(...zs) + Math.max(...zs)) / 2;
        }
        const byDistance = [...areas].sort((a, b) => Math.hypot(a.x - middle.x, a.z - middle.z) - Math.hypot(b.x - middle.x, b.z - middle.z));
        const kept: CrowdArea[] = [];
        let left = max;
        for (const area of byDistance) {
            if (left <= 0) break;
            const count = Math.min(area.count, left);
            kept.push({ ...area, count });
            left -= count;
        }
        return kept;
    }

    private async buildCrowd(areas: CrowdArea[], paths: CrowdPaths | undefined): Promise<void> {
        let assets;
        try {
            assets = await crowdAssets();
        } catch (error) {
            console.warn('[Town] no crowd models', error);
            return;
        }
        if (this.gone) return;
        this.crowd = new Crowd({
            settings: SETTINGS.town.people,
            assets,
            areas,
            paths,
            canStand: (x, z) => !this.isRoad(x, z) && !this.nearWall(x, z) && !this.blocked(x, z),
            isRoad: (x, z) => this.isRoad(x, z),
            carNear: (ax, az, bx, bz, radius) => this.traffic?.anyNear(ax, az, bx, bz, radius) ?? false,
        });
        this.group.add(this.crowd.group);
    }

    private async buildRoadsAndCars(): Promise<void> {
        const layout = LAYOUT_DATA;
        const kit = SETTINGS.town.roadKit;
        if (!layout.roads?.cells.length) return;
        const names = [...new Set(kit.pieces.flatMap((piece) => piece.models))];
        const loaded = new Map<string, THREE.Object3D>();
        await Promise.all(names.map(async (name) => {
            try {
                loaded.set(name, await townModel(name));
            } catch (error) {
                console.warn(`[Town] no road model ${name}`, error);
            }
        }));
        if (this.gone) return;
        // A fresh copy of a loaded tile per cell (the first use takes the loaded copy itself).
        const used = new Set<string>();
        const roads = buildRoads(layout.roads, kit, (name) => {
            const source = loaded.get(name);
            if (!source) return null;
            if (!used.has(name)) {
                used.add(name);
                return source;
            }
            return source.clone(true);
        });
        roads.position.set(this.origin.x, 0, this.origin.z);
        this.group.add(roads);
        const count = layout.traffic?.count ?? 0;
        if (!count) return;
        const grid = roadNetwork(layout.roads, kit.tile);
        const network = { ...grid, waypoints: grid.waypoints.map((point) => ({ ...point, x: point.x + this.origin.x, z: point.z + this.origin.z })) };
        this.traffic = new Traffic({
            settings: SETTINGS.town.traffic,
            network,
            cars: spreadCars(network, count, SETTINGS.town.traffic.models),
            roadY: kit.roadY ?? 0.03,
            loadModel: (name) => townModel(name),
            prepare: (root) => root.traverse((child) => {
                if (child instanceof THREE.Mesh) child.castShadow = child.receiveShadow = true;
            }),
        });
        this.group.add(this.traffic.group);
        await this.traffic.ready;
    }

    /** The walls standing at `stage`, as segments (for keeping people off them). */
    private collectWalls(stage: number): void {
        const areas = LAYOUT_DATA.areas ?? [];
        for (const wall of LAYOUT_DATA.walls) {
            if (!shownAt(wall, stage, areas, wall.points[0])) continue;
            const setup = (wall.setup && LAYOUT_DATA.setups[wall.setup]) || Object.values(LAYOUT_DATA.setups)[0];
            const half = (setup?.thickness ?? 0.2) / 2;
            const count = wall.closed ? wall.points.length : wall.points.length - 1;
            for (let s = 0; s < count; s++) {
                const a = wall.points[s];
                const b = wall.points[(s + 1) % wall.points.length];
                this.walls.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z, half });
            }
        }
    }

    /** The props with a footprint (`collider`: half sizes, along the prop's own axes) at `stage`, as world boxes. */
    private collectBlockers(stage: number): void {
        const areas = LAYOUT_DATA.areas ?? [];
        for (const prop of LAYOUT_DATA.props as (typeof LAYOUT_DATA.props[number] & { collider?: { halfX: number; halfZ: number } })[]) {
            if (!prop.collider || !shownAt(prop, stage, areas)) continue;
            // Turned a quarter: its sides swap.
            const quarter = Math.abs(Math.sin(prop.rotationY ?? 0)) > 0.7;
            this.blockers.push({ x: prop.x, z: prop.z, halfX: quarter ? prop.collider.halfZ : prop.collider.halfX, halfZ: quarter ? prop.collider.halfX : prop.collider.halfZ });
        }
    }

    private blocked(x: number, z: number): boolean {
        return this.blockers.some((box) => Math.abs(x - box.x) <= box.halfX + BLOCKER_CLEARANCE && Math.abs(z - box.z) <= box.halfZ + BLOCKER_CLEARANCE);
    }

    private isRoad(x: number, z: number): boolean {
        if (!this.roadCells.size) return false;
        const tile = SETTINGS.town.roadKit.tile;
        // The cell under (x, z), and a little past its edge.
        for (const [dx, dz] of [[0, 0], [ROAD_MARGIN, 0], [-ROAD_MARGIN, 0], [0, ROAD_MARGIN], [0, -ROAD_MARGIN]]) {
            const [i, j] = roadCellAt(x + dx - this.origin.x, z + dz - this.origin.z, tile);
            if (this.roadCells.has(roadCellKey(i, j))) return true;
        }
        return false;
    }

    private nearWall(x: number, z: number): boolean {
        return this.walls.some(({ ax, az, bx, bz, half }) => {
            const dx = bx - ax;
            const dz = bz - az;
            const lengthSq = dx * dx + dz * dz || 1;
            const t = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / lengthSq));
            return Math.hypot(x - (ax + dx * t), z - (az + dz * t)) < half + WALL_CLEARANCE;
        });
    }

    public update(delta: number): void {
        this.traffic?.update(delta);
        this.crowd?.update(delta);
    }

    public dispose(): void {
        this.gone = true;
        this.traffic?.destroy();
        this.crowd?.destroy();
        this.group.traverse((child) => {
            if (child instanceof THREE.Mesh && child.parent?.name !== 'roads') {
                // Lawns own their geometry and material; road tiles and cars share theirs with the loaded models.
                if ((child.material as THREE.Material)?.customProgramCacheKey?.() === 'town-grass') {
                    child.geometry.dispose();
                    (child.material as THREE.Material).dispose();
                }
            }
        });
        this.group.removeFromParent();
    }
}
