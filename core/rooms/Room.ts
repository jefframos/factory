// Room.ts
//
// A room built from a layout (RoomLayout: Dig's hub.json shape, the format an editor writes): checker floors, walls
// (PolyWallBuilder: mitered corners; windows, doors and gaps cut out), the doors hung in them (RoomDoor: swinging or
// sliding, opening as someone walks up, closing behind them) and props (a model, placed: position, turn, size, height
// off the floor, stretch).
//
// Growth: everything can be limited to stages — `from` (shown from that stage on) and `until` (gone from that stage on).
// An area (a rect with its own from / until) passes them to whatever stands in it that doesn't say its own. Built for one
// stage; a new stage builds a new Room (the walls themselves change: a truck's gone, a room's knocked through).
//
// The game hands in how a prop's model is made (`instantiate`: a copy of a loaded model, by the name the layout uses),
// and each frame where everyone who opens doors is (update).

import * as THREE from 'three';
import { PolyWallBuilder } from './PolyWallBuilder';
import { CheckerFloorBuilder } from './CheckerFloorBuilder';
import RoomDoor from './RoomDoor';
import { RoomHooks } from './RoomHooks';
import type { DoorStyleConfig, FloorCheckerConfig, StoreWallOpening, StoreWallPlacement, WallSetupConfig, WallStyleConfig } from './RoomTypes';

/** Shown from stage `from` on, gone from stage `until` on (both optional). */
export interface StageRange {
    from?: number;
    until?: number;
}

export interface LayoutFloor extends StageRange {
    x: number;
    z: number;
    width: number;
    depth: number;
    rotationY?: number;
    /** Tile size (world units): a checker square is `scale` tiles. */
    tileSize?: number;
    style?: string;
    /** Lifted off the floor (a floor drawn over another: a hair higher, or they flicker). */
    elevation?: number;
}

/** A wall opening as the layout writes it (Dig's: the rect's bounds inline). */
export interface LayoutOpening {
    kind: StoreWallOpening['kind'];
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
    double?: boolean;
    high?: boolean;
    sliding?: boolean;
    fitToCeiling?: boolean;
    /** A door's style (layout.styles.doors). */
    style?: string;
    facing?: { x: number; z: number };
}

export interface LayoutWall extends StageRange {
    points: { x: number; z: number }[];
    closed?: boolean;
    openings?: LayoutOpening[];
    /** Its look (layout.styles.walls) and size (layout.setups); unset: the first of each. */
    style?: string;
    setup?: string;
}

export interface LayoutProp extends StageRange {
    /** The model's name (the game's `instantiate` makes it). */
    model: string;
    id?: string;
    x: number;
    z: number;
    rotationY?: number;
    /** Fitted to this height (world units); unset: the model's own size x `scale`. */
    height?: number;
    scale?: number;
    /** Lifted off the floor. */
    elevation?: number;
    /** Stretched across (x) and along (z), after the fit. */
    stretch?: { x?: number; z?: number };
}

export interface LayoutArea extends StageRange {
    id: string;
    name?: string;
    x: number;
    z: number;
    width: number;
    depth: number;
}

export interface RoomLayout {
    /** Wall sizes by name. */
    setups: Record<string, WallSetupConfig>;
    styles: {
        walls: Record<string, WallStyleConfig>;
        floors: Record<string, FloorCheckerConfig>;
        doors?: Record<string, DoorStyleConfig>;
    };
    floors: LayoutFloor[];
    walls: LayoutWall[];
    props: LayoutProp[];
    areas?: LayoutArea[];
}

export interface RoomOptions {
    /** A copy of the model named in the layout. */
    instantiate: (model: string) => THREE.Object3D;
    /** Things cast and take shadows. */
    shadows?: boolean;
}

const DEFAULT_DOOR: DoorStyleConfig = { color: '#9fd8ff', opacity: 0.35 };
const first = <T>(record: Record<string, T> | undefined, key: string | undefined): T | undefined =>
    record ? (key && record[key]) || Object.values(record)[0] : undefined;

/** Whether `item` (or the area it stands in, when it says nothing itself) is there at `stage`. */
export function shownAt(item: StageRange & { x?: number; z?: number }, stage: number, areas: readonly LayoutArea[] = [], at?: { x: number; z: number }): boolean {
    let range: StageRange = item;
    if (item.from === undefined && item.until === undefined) {
        const point = at ?? (item.x !== undefined && item.z !== undefined ? { x: item.x, z: item.z } : undefined);
        const area = point && areas.find((a) => Math.abs(point.x - a.x) <= a.width / 2 && Math.abs(point.z - a.z) <= a.depth / 2);
        if (area) range = area;
    }
    return (range.from === undefined || stage >= range.from) && (range.until === undefined || stage < range.until);
}

export class Room {
    public readonly group = new THREE.Group();
    private readonly doors: RoomDoor[] = [];
    /** The meshes this room made itself (its walls and floors): disposed with it. */
    private readonly owned: THREE.Mesh[] = [];
    /** Props by id (the game finds its pieces: a station's counter, a table). */
    public readonly props = new Map<string, THREE.Object3D>();

    public constructor(layout: RoomLayout, stage: number, options: RoomOptions) {
        const areas = layout.areas ?? [];
        const origin = new THREE.Vector3(0, 0, 0);
        const shadows = options.shadows ?? true;

        for (const floor of layout.floors) {
            if (!shownAt(floor, stage, areas)) continue;
            const checker = first(layout.styles.floors, floor.style);
            if (!checker) continue;
            const mesh = CheckerFloorBuilder.build({ x: floor.x, z: floor.z, width: floor.width, depth: floor.depth, rotationY: floor.rotationY ?? 0, tileSize: floor.tileSize ?? 1, style: floor.style }, origin, checker);
            mesh.position.y += floor.elevation ?? 0;
            mesh.receiveShadow = shadows;
            this.owned.push(mesh);
            this.group.add(mesh);
        }

        for (const wall of layout.walls) {
            if (!shownAt(wall, stage, areas, wall.points[0])) continue;
            const setup = first(layout.setups, wall.setup);
            const style = first(layout.styles.walls, wall.style);
            if (!setup || !style) continue;
            const placement: StoreWallPlacement = {
                points: wall.points,
                closed: wall.closed ?? false,
                openings: (wall.openings ?? []).map((o) => ({
                    kind: o.kind,
                    rect: { minX: o.minX, maxX: o.maxX, minZ: o.minZ, maxZ: o.maxZ },
                    double: o.double, high: o.high, sliding: o.sliding, fitToCeiling: o.fitToCeiling, style: o.style, facing: o.facing,
                })),
                style: wall.style,
                setup: wall.setup,
            };
            const mesh = PolyWallBuilder.build(placement, origin, setup, style);
            mesh.castShadow = mesh.receiveShadow = shadows;
            this.owned.push(mesh);
            this.group.add(mesh);
            // Its doors (a door opening's leaves), in their style.
            const openings = placement.openings ?? [];
            for (const frame of PolyWallBuilder.doorFrames(placement, setup)) {
                const opening = openings.find((o) => o.kind === 'door' && o.style === frame.style) ?? openings.find((o) => o.kind === 'door');
                const doorStyle = first(layout.styles.doors, opening?.style) ?? DEFAULT_DOOR;
                const door = new RoomDoor(frame, origin, RoomHooks.floorY, doorStyle);
                this.doors.push(door);
                this.group.add(door.object);
            }
        }

        for (const prop of layout.props) {
            if (!shownAt(prop, stage, areas)) continue;
            const object = this.place(prop, options);
            if (!object) continue;
            object.traverse((child) => {
                if (child instanceof THREE.Mesh) child.castShadow = child.receiveShadow = shadows;
            });
            this.group.add(object);
            if (prop.id) this.props.set(prop.id, object);
        }
    }

    /** A prop's model, placed. */
    private place(prop: LayoutProp, options: RoomOptions): THREE.Object3D | null {
        let model: THREE.Object3D;
        try {
            model = options.instantiate(prop.model);
        } catch (error) {
            console.warn(`[Room] no model "${prop.model}"`, error);
            return null;
        }
        const holder = new THREE.Group();
        holder.add(model);
        // Fitted to its height (or scaled), its bottom on the floor, then stretched.
        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        const scale = prop.height !== undefined && size.y > 1e-4 ? prop.height / size.y : prop.scale ?? 1;
        model.scale.multiplyScalar(scale);
        model.position.y -= box.min.y * scale;
        holder.scale.set(prop.stretch?.x ?? 1, 1, prop.stretch?.z ?? 1);
        holder.position.set(prop.x, RoomHooks.floorY + (prop.elevation ?? 0), prop.z);
        holder.rotation.y = prop.rotationY ?? 0;
        holder.name = prop.id ?? prop.model;
        return holder;
    }

    /** The doors open for anyone at them (`openers`: where everyone who opens doors is, world). */
    public update(delta: number, openers: readonly THREE.Vector3[]): void {
        for (const door of this.doors) door.update(delta, openers);
    }

    public dispose(): void {
        this.doors.forEach((door) => door.dispose());
        for (const mesh of this.owned) {
            mesh.geometry.dispose();
            mesh.traverse((child) => {
                if (child instanceof THREE.Mesh) [child.material].flat().forEach((m) => m.dispose());
            });
        }
        this.group.removeFromParent();
    }
}
