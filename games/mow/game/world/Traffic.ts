// Traffic.ts
//
// A few cars driving the town's roads, just to make it feel alive (`traffic` in ui/mow.json). The lanes come from the
// level's road tiles (props whose model has `road_`, on a `tile` grid): each tile is a node, linked to the tiles next
// to it. A car crosses one tile at a time on the right-hand lane (`lane` off the middle): straight on, or curving
// into the side road (a quadratic curve between the lanes, so corners and junctions turn smoothly), picking where to
// go at random at each tile (never back, unless it's a dead end; straight on likelier).
//
// Cars stop for the player: anything within `gap` of a car's front (its lane ahead) and it brakes, and it drives on
// once the way is clear. Same for the car ahead (they queue); two cars blocking each other at a junction: the older
// one goes first. They're solid (blockers(): the player can't walk into one), except one the player is already in.

import * as THREE from 'three';
import ModelLoaderManager from 'core/three/ModelLoaderManager';
import { MOW, TOWN, TrafficDef } from '../data/MowConfig';
import { BendService } from '../services/BendService';
import type { Box } from './Town';

const MODEL_BASE = './mow/models/';
/** The four ways a car can head on the grid (x, z). */
const DIRS: readonly [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
/** Straight on is this many times likelier than a turn. */
const STRAIGHT_WEIGHT = 2;
/** Car width / length (the city kit's cars). */
const WIDTH_SHARE = 0.45;
/** The wheels' radius, as a share of the car's length. */
const WHEEL_SHARE = 0.085;

interface Node {
    x: number;
    z: number;
    /** Neighbour by direction index (DIRS), if there's a road tile that way. */
    links: (Node | undefined)[];
}

/** A car's way across one tile: in heading `inDir`, out heading `outDir`, along a quadratic curve p0 -> p1 -> p2. */
interface Leg {
    node: Node;
    outDir: number;
    p0: THREE.Vector2;
    p1: THREE.Vector2;
    p2: THREE.Vector2;
    length: number;
}

interface Car {
    id: number;
    root: THREE.Group;
    wheels: THREE.Object3D[];
    wheelRadius: number;
    leg: Leg;
    /** Distance along the leg. */
    along: number;
    speed: number;
    position: THREE.Vector2;
    heading: THREE.Vector2;
}

const opposite = (dir: number): number => dir ^ 1;
const right = (dir: number): THREE.Vector2 => new THREE.Vector2(-DIRS[dir][1], DIRS[dir][0]);

function bezier(leg: Leg, u: number, out: THREE.Vector2): THREE.Vector2 {
    const a = (1 - u) * (1 - u);
    const b = 2 * u * (1 - u);
    const c = u * u;
    return out.set(a * leg.p0.x + b * leg.p1.x + c * leg.p2.x, a * leg.p0.y + b * leg.p1.y + c * leg.p2.y);
}

function tangent(leg: Leg, u: number, out: THREE.Vector2): THREE.Vector2 {
    out.set(2 * (1 - u) * (leg.p1.x - leg.p0.x) + 2 * u * (leg.p2.x - leg.p1.x), 2 * (1 - u) * (leg.p1.y - leg.p0.y) + 2 * u * (leg.p2.y - leg.p1.y));
    return out.lengthSq() > 1e-9 ? out.normalize() : out.set(0, 1);
}

export class Traffic {
    private readonly config?: TrafficDef;
    private readonly nodes: Node[] = [];
    private readonly cars: Car[] = [];
    private readonly group = new THREE.Group();
    private readonly player = new THREE.Vector2();
    private playerRadius = 0.35;
    private destroyed = false;

    public constructor(threeScene: THREE.Scene) {
        this.config = MOW.traffic;
        threeScene.add(this.group);
        if (!this.config || this.config.count <= 0) return;
        this.buildGraph(this.config);
        if (this.nodes.length < 2) return;
        void this.spawn(this.config);
    }

    // ---------------------------------------------------------------- the road graph

    private buildGraph(config: TrafficDef): void {
        const byKey = new Map<string, Node>();
        const key = (x: number, z: number) => `${Math.round(x * 10)},${Math.round(z * 10)}`;
        for (const prop of TOWN.props) {
            if (!prop.model.includes('road_') || byKey.has(key(prop.x, prop.z))) continue;
            const node: Node = { x: prop.x, z: prop.z, links: [] };
            byKey.set(key(prop.x, prop.z), node);
            this.nodes.push(node);
        }
        for (const node of this.nodes) {
            node.links = DIRS.map(([dx, dz]) => byKey.get(key(node.x + dx * config.tile, node.z + dz * config.tile)));
        }
    }

    /** Where to head out of `node`, having come in heading `inDir`: on at random (straight likelier), back only at a dead end. */
    private pickOut(node: Node, inDir: number): number {
        const options: number[] = [];
        node.links.forEach((link, dir) => {
            if (!link || dir === opposite(inDir)) return;
            for (let n = dir === inDir ? STRAIGHT_WEIGHT : 1; n > 0; n--) options.push(dir);
        });
        return options.length ? options[Math.floor(Math.random() * options.length)] : opposite(inDir);
    }

    /** The way across `node` coming in heading `inDir`, out heading `outDir`. */
    private leg(node: Node, inDir: number, outDir: number): Leg {
        const config = this.config!;
        const half = config.tile / 2;
        const center = new THREE.Vector2(node.x, node.z);
        const inVec = new THREE.Vector2(...DIRS[inDir]);
        const outVec = new THREE.Vector2(...DIRS[outDir]);
        const p0 = center.clone().addScaledVector(inVec, -half).addScaledVector(right(inDir), config.lane);
        const p2 = center.clone().addScaledVector(outVec, half).addScaledVector(right(outDir), config.lane);
        let p1: THREE.Vector2;
        if (outDir === inDir) p1 = p0.clone().add(p2).multiplyScalar(0.5);
        // A turn: where the two lanes cross.
        else if (outDir !== opposite(inDir)) p1 = center.clone().addScaledVector(right(inDir), config.lane).addScaledVector(right(outDir), config.lane);
        // A dead end: round the tile's middle.
        else p1 = center.clone().addScaledVector(inVec, half);
        const leg: Leg = { node, outDir, p0, p1, p2, length: 0 };
        const a = new THREE.Vector2();
        const b = bezier(leg, 0, new THREE.Vector2());
        for (let i = 1; i <= 8; i++) {
            bezier(leg, i / 8, a);
            leg.length += a.distanceTo(b);
            b.copy(a);
        }
        return leg;
    }

    /** The leg after `leg`: the tile it heads out to. */
    private nextLeg(leg: Leg): Leg {
        const node = leg.node.links[leg.outDir] ?? leg.node;
        const inDir = node === leg.node ? opposite(leg.outDir) : leg.outDir;
        return this.leg(node, inDir, this.pickOut(node, inDir));
    }

    // ---------------------------------------------------------------- cars

    private async spawn(config: TrafficDef): Promise<void> {
        // Spread over the network: distinct tiles, shuffled.
        const tiles = [...this.nodes].sort(() => Math.random() - 0.5);
        const count = Math.min(config.count, Math.floor(tiles.length / 3));
        for (let i = 0; i < count; i++) {
            const model = config.models[i % config.models.length];
            let object: THREE.Object3D;
            try {
                object = await ModelLoaderManager.instance.loadModel(`${MODEL_BASE}${model}`);
            } catch (error) {
                console.warn(`[Traffic] could not load ${model}`, error);
                continue;
            }
            if (this.destroyed) return;
            const node = tiles[i * 3];
            const ways = node.links.map((link, dir) => (link ? dir : -1)).filter((dir) => dir >= 0);
            const outDir = ways[Math.floor(Math.random() * ways.length)];
            // Enters heading where it leaves (as if it came straight through), so the first leg is a straight one.
            const leg = this.leg(node, outDir, outDir);
            this.cars.push(this.makeCar(i, object, leg, Math.random() * leg.length, config));
        }
    }

    private makeCar(id: number, object: THREE.Object3D, leg: Leg, along: number, config: TrafficDef): Car {
        object.traverse((child) => {
            if (!(child instanceof THREE.Mesh)) return;
            child.material = Array.isArray(child.material) ? child.material.map((m) => m.clone()) : child.material.clone();
            (Array.isArray(child.material) ? child.material : [child.material]).forEach((m) => BendService.applyBend(m));
        });
        object.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(object);
        const size = box.getSize(new THREE.Vector3());
        const scale = config.length / Math.max(1e-4, size.z);
        object.scale.multiplyScalar(scale);
        object.position.set(-(box.min.x + box.max.x) / 2 * scale, -box.min.y * scale, -(box.min.z + box.max.z) / 2 * scale);
        const wheels: THREE.Object3D[] = [];
        object.traverse((child) => {
            if (/wheel/i.test(child.name) && !(child.parent && /wheel/i.test(child.parent.name))) wheels.push(child);
        });
        const root = new THREE.Group();
        root.add(object);
        this.group.add(root);
        const car: Car = {
            id, root, wheels, wheelRadius: config.length * WHEEL_SHARE, leg, along, speed: config.speed,
            position: new THREE.Vector2(), heading: new THREE.Vector2(0, 1),
        };
        this.place(car, 0);
        return car;
    }

    /** Puts the car where it is along its leg, facing its way. */
    private place(car: Car, moved: number): void {
        const u = Math.min(1, car.along / car.leg.length);
        bezier(car.leg, u, car.position);
        tangent(car.leg, u, car.heading);
        car.root.position.set(car.position.x, this.config!.roadY, car.position.y);
        car.root.rotation.y = Math.atan2(car.heading.x, car.heading.y);
        if (moved) car.wheels.forEach((wheel) => (wheel.rotation.x += moved / car.wheelRadius));
    }

    /** Whether (x, z), `radius` round, is in the car's lane ahead (within `gap` of its front) or under its front. */
    private inFront(car: Car, x: number, z: number, radius: number, reach: number): boolean {
        const config = this.config!;
        const dx = x - car.position.x;
        const dz = z - car.position.y;
        const ahead = dx * car.heading.x + dz * car.heading.y;
        const side = Math.abs(dx * car.heading.y - dz * car.heading.x);
        const halfWidth = (config.length * WIDTH_SHARE) / 2;
        return ahead > 0 && ahead < config.length / 2 + reach + radius && side < halfWidth + radius + 0.2;
    }

    /** `player`: where the player stands, and how big (its walking footprint). */
    public update(delta: number, player: THREE.Vector3, playerRadius: number): void {
        const config = this.config;
        this.player.set(player.x, player.z);
        this.playerRadius = playerRadius;
        if (!config || !this.cars.length) return;
        const carRadius = (config.length * WIDTH_SHARE) / 2;
        // Who's blocked by whom: a car stops for any car in front of it, unless they block each other and it's the older one.
        const ahead = this.cars.map((car) => this.cars.filter((other) => other !== car
            && this.inFront(car, other.position.x, other.position.y, carRadius, config.gap)));
        this.cars.forEach((car, i) => {
            const forPlayer = this.inFront(car, player.x, player.z, playerRadius, config.gap);
            const forCar = ahead[i].some((other) => !(ahead[this.cars.indexOf(other)].includes(car) && car.id < other.id));
            const target = forPlayer || forCar ? 0 : config.speed;
            car.speed = target < car.speed ? Math.max(target, car.speed - config.brake * delta) : Math.min(target, car.speed + config.accel * delta);
            const moved = car.speed * delta;
            if (moved <= 0) return;
            car.along += moved;
            while (car.along >= car.leg.length) {
                car.along -= car.leg.length;
                car.leg = this.nextLeg(car.leg);
            }
            this.place(car, moved);
        });
    }

    /**
     * The cars as obstacles to walking (Town's walkability): each one's footprint, square to the grid by its heading
     * (near enough; they're only off it mid-turn). One the player is already in isn't, so they can always walk out.
     */
    public blockers(): Box[] {
        const config = this.config;
        if (!config) return [];
        const halfLength = config.length / 2;
        const halfWidth = (config.length * WIDTH_SHARE) / 2;
        const out: Box[] = [];
        for (const car of this.cars) {
            const alongX = Math.abs(car.heading.x) > Math.abs(car.heading.y);
            const box = { x: car.position.x, z: car.position.y, halfX: alongX ? halfLength : halfWidth, halfZ: alongX ? halfWidth : halfLength };
            const r = this.playerRadius;
            if (Math.abs(this.player.x - box.x) <= box.halfX + r && Math.abs(this.player.y - box.z) <= box.halfZ + r) continue;
            out.push(box);
        }
        return out;
    }

    public destroy(): void {
        this.destroyed = true;
        this.group.removeFromParent();
        this.group.traverse((child) => {
            if (child instanceof THREE.Mesh) (Array.isArray(child.material) ? child.material : [child.material]).forEach((m) => m.dispose());
        });
        this.cars.length = 0;
    }
}
