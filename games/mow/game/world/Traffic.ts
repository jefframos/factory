// Traffic.ts
//
// A few cars driving the town's roads, just to make it feel alive. How they drive is `traffic` in ui/mow.json; where,
// the level's `traffic` (levels/town.json, drawn and edited in the editor): waypoints on the roads' middles, links
// between them (two-way roads), and the cars, each starting at a waypoint. A car drives from waypoint to waypoint on
// the right-hand lane (`lane` off the middle), through each one on a curve: straight down the road in, a short
// quadratic round where the two lanes cross (TURN_REACH lanes before and after it: a tight corner, never cutting across
// the block's pavement and trees, however long the roads; on built roads — TownLevel.roads — the whole tile's curve,
// edge to edge, as its corner piece is drawn), straight on down the road out; at
// each waypoint it picks a link at random (never back, unless it's a dead end; the straightest likelier). A car only
// roams the waypoints linked to its own, so a network of its own keeps it to an area.
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
/** The straightest way on is this many times likelier than the others. */
const STRAIGHT_WEIGHT = 2;
/** Car width / length (the city kit's cars). */
const WIDTH_SHARE = 0.45;
/** The wheels' radius, as a share of the car's length. */
const WHEEL_SHARE = 0.085;
/** A turn's curve starts this many lanes before the corner (and ends as far after it). */
const TURN_REACH = 2.2;
/** Points along a turn's curve. */
const CURVE_STEPS = 14;

interface Node {
    x: number;
    z: number;
    links: Node[];
}

/** A car's way through `node`, from the road in (from `prev`) to the road out (to `next`): points, and how far along each is. */
interface Leg {
    prev: Node;
    node: Node;
    next: Node;
    points: THREE.Vector2[];
    distances: number[];
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

/** The unit heading from a to b. */
const heading = (a: Node, b: Node): THREE.Vector2 => new THREE.Vector2(b.x - a.x, b.z - a.z).normalize();
/** The right-hand side of a heading (x, z). */
const right = (dir: THREE.Vector2): THREE.Vector2 => new THREE.Vector2(-dir.y, dir.x);

/** The quadratic a -> control -> b at u. */
function quadratic(a: THREE.Vector2, control: THREE.Vector2, b: THREE.Vector2, u: number): THREE.Vector2 {
    const k = 1 - u;
    return new THREE.Vector2(k * k * a.x + 2 * u * k * control.x + u * u * b.x, k * k * a.y + 2 * u * k * control.y + u * u * b.y);
}

/** Where the car is `along` its leg, and which way it faces there (eased between the points' directions). */
function sample(leg: Leg, along: number, position: THREE.Vector2, dir: THREE.Vector2): void {
    const { points, distances } = leg;
    let i = 1;
    while (i < points.length - 1 && distances[i] < along) i++;
    const a = points[i - 1];
    const b = points[i];
    const span = Math.max(1e-6, distances[i] - distances[i - 1]);
    const u = THREE.MathUtils.clamp((along - distances[i - 1]) / span, 0, 1);
    position.copy(a).lerp(b, u);
    dir.copy(b).sub(a);
    // Half way into the next stretch, turning toward it (no snapping from one to the next).
    if (u > 0.5 && i < points.length - 1) dir.normalize().lerp(points[i + 1].clone().sub(b).normalize(), u - 0.5);
    if (dir.lengthSq() < 1e-9) dir.set(0, 1);
    dir.normalize();
}

export class Traffic {
    private readonly config?: TrafficDef;
    private readonly nodes = new Map<string, Node>();
    private readonly cars: Car[] = [];
    private readonly group = new THREE.Group();
    private readonly player = new THREE.Vector2();
    private playerRadius = 0.35;
    private destroyed = false;
    /** The asphalt's top (the road builder's pieces have their own), and how far before a corner a turn starts. */
    private roadY = 0;
    private turnReach = 0;

    /** `after`: the cars' models wait for it (the town round the player loads first). */
    public constructor(threeScene: THREE.Scene, after: Promise<unknown> = Promise.resolve()) {
        this.config = MOW.traffic;
        threeScene.add(this.group);
        if (!this.config || !TOWN.traffic) return;
        const built = Boolean(TOWN.roads && MOW.roadKit);
        this.roadY = built ? MOW.roadKit!.roadY : this.config.roadY;
        this.turnReach = built ? Infinity : this.config.lane * TURN_REACH;
        this.buildGraph();
        const config = this.config;
        void after.then(() => this.spawn(config));
    }

    // ---------------------------------------------------------------- the road graph

    private buildGraph(): void {
        const traffic = TOWN.traffic!;
        for (const point of traffic.waypoints) this.nodes.set(point.id, { x: point.x, z: point.z, links: [] });
        for (const [a, b] of traffic.links) {
            const from = this.nodes.get(a);
            const to = this.nodes.get(b);
            if (!from || !to || from === to || from.links.includes(to)) continue;
            from.links.push(to);
            to.links.push(from);
        }
    }

    /** Where to go from `node`, having come from `prev`: a link at random (the straightest likelier), back only at a dead end. */
    private pickNext(prev: Node, node: Node): Node {
        const ways = node.links.filter((link) => link !== prev);
        if (!ways.length) return prev;
        const into = heading(prev, node);
        const straightest = ways.reduce((best, link) => (heading(node, link).dot(into) > heading(node, best).dot(into) ? link : best));
        const options = ways.flatMap((link) => (link === straightest && ways.length > 1 ? Array(STRAIGHT_WEIGHT).fill(link) : [link]));
        return options[Math.floor(Math.random() * options.length)];
    }

    /**
     * The way through `node` from `prev` to `next`: half way along the road in, to half way along the road out — on the
     * right-hand lane, turning close round the corner (straight up to it, a short curve, straight on).
     */
    private leg(prev: Node, node: Node, next: Node): Leg {
        const lane = this.config!.lane;
        const centre = new THREE.Vector2(node.x, node.z);
        const inDir = heading(prev, node);
        const outDir = next === prev ? inDir.clone().negate() : heading(node, next);
        const start = new THREE.Vector2((prev.x + node.x) / 2, (prev.z + node.z) / 2).addScaledVector(right(inDir), lane);
        const end = new THREE.Vector2((node.x + next.x) / 2, (node.z + next.z) / 2).addScaledVector(right(outDir), lane);
        const cross = inDir.x * outDir.y - inDir.y * outDir.x;
        const points = [start];
        const curve = (a: THREE.Vector2, control: THREE.Vector2, b: THREE.Vector2) => {
            for (let i = 0; i <= CURVE_STEPS; i++) points.push(quadratic(a, control, b, i / CURVE_STEPS));
        };
        if (next === prev || inDir.dot(outDir) < -0.95) {
            // A dead end: round the waypoint, from its lane in to its lane out.
            const a = centre.clone().addScaledVector(right(inDir), lane);
            const b = centre.clone().addScaledVector(right(outDir), lane);
            curve(a, centre.clone().addScaledVector(inDir, lane * 2), b);
        } else if (Math.abs(cross) > 0.05) {
            // A turn: round where the lane in meets the lane out, from a little before it to a little after.
            const a = centre.clone().addScaledVector(right(inDir), lane);
            const b = centre.clone().addScaledVector(right(outDir), lane);
            const t = ((b.x - a.x) * outDir.y - (b.y - a.y) * outDir.x) / cross;
            const corner = a.addScaledVector(inDir, t);
            const reach = Math.min(this.turnReach, corner.distanceTo(start), corner.distanceTo(end));
            curve(corner.clone().addScaledVector(inDir, -reach), corner, corner.clone().addScaledVector(outDir, reach));
        }
        points.push(end);
        const distances = [0];
        for (let i = 1; i < points.length; i++) distances.push(distances[i - 1] + points[i].distanceTo(points[i - 1]));
        return { prev, node, next, points, distances, length: Math.max(distances[distances.length - 1], 1e-3) };
    }

    /** The leg after `leg`: through the waypoint it heads to. */
    private nextLeg(leg: Leg): Leg {
        return this.leg(leg.node, leg.next, this.pickNext(leg.node, leg.next));
    }

    // ---------------------------------------------------------------- cars

    /** Each of the level's cars at its waypoint, heading off down one of its links (a waypoint with none: no car). */
    private async spawn(config: TrafficDef): Promise<void> {
        const cars = TOWN.traffic?.cars ?? [];
        for (const [i, spec] of cars.entries()) {
            const node = this.nodes.get(spec.at);
            if (!node?.links.length) continue;
            const model = spec.model ?? config.models[i % config.models.length];
            let object: THREE.Object3D;
            try {
                object = await ModelLoaderManager.instance.loadModel(`${MODEL_BASE}${model}`);
            } catch (error) {
                console.warn(`[Traffic] could not load ${model}`, error);
                continue;
            }
            if (this.destroyed) return;
            const next = node.links[Math.floor(Math.random() * node.links.length)];
            // As if it came straight through (from the far side of its waypoint), so the first leg is a straight one.
            const behind: Node = { x: node.x * 2 - next.x, z: node.z * 2 - next.z, links: [] };
            const leg = this.leg(behind, node, next);
            this.cars.push(this.makeCar(i, object, leg, leg.length * 0.5, config));
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
        sample(car.leg, Math.min(car.along, car.leg.length), car.position, car.heading);
        car.root.position.set(car.position.x, this.roadY, car.position.y);
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

    /** Each car's id, where it is and how fast it goes (0..1 of its cruising speed): for its engine sound (SpatialAudio). */
    public carSounds(): { id: number; x: number; z: number; speed: number }[] {
        const cruise = this.config?.speed || 1;
        return this.cars.map((car) => ({ id: car.id, x: car.position.x, z: car.position.y, speed: car.speed / cruise }));
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
