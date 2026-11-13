// Traffic.ts
//
// Cars driving a road network (waypoints and links: core/roads/RoadGrid's roadNetwork() for painted roads), for any game
// (the UFO game's Cars, without its eating). Each drives on the right-hand lane, from half way along the road in to half
// way along the road out, curving round corners (a U-turn at a dead end), choosing the straightest way twice as often as
// any other. They queue behind each other; two blocking each other, the older goes first.
//
// The game hands in how a car's model is loaded (`loadModel`) and anything it does to one (`prepare`: a bend, shadows).

import * as THREE from 'three';

export interface TrafficSettings {
    /** Car models (the game's loadModel takes these). */
    models: string[];
    /** Units a second, top speed; speeding up and braking (units a second, a second). */
    speed: number;
    accel: number;
    brake: number;
    /** A car's length (its model is fitted to it), how far right of the road's middle it drives, the gap kept to the one ahead. */
    length: number;
    lane: number;
    gap: number;
}

export interface TrafficNetwork {
    waypoints: { id: string; x: number; z: number }[];
    links: [string, string][];
}

/** A car: the waypoint it starts at, and its model (else the settings' next). */
export interface TrafficCar {
    at: string;
    model?: string;
}

export interface TrafficOptions {
    settings: TrafficSettings;
    network: TrafficNetwork;
    cars: TrafficCar[];
    /** Where the wheels are (the asphalt's height). */
    roadY: number;
    /** A copy of a car model. */
    loadModel: (name: string) => Promise<THREE.Object3D>;
    /** Anything the game does to a car once it's made (a bend, shadows). */
    prepare?: (root: THREE.Object3D) => void;
}

const STRAIGHT_WEIGHT = 2;
const WIDTH_SHARE = 0.45;
const CURVE_STEPS = 14;

interface Node {
    x: number;
    z: number;
    links: Node[];
}

interface Leg {
    node: Node;
    next: Node;
    points: THREE.Vector2[];
    distances: number[];
    length: number;
}

interface Car {
    id: number;
    root: THREE.Group;
    leg: Leg;
    along: number;
    speed: number;
    position: THREE.Vector2;
    heading: THREE.Vector2;
}

const headingOf = (a: Node, b: Node) => new THREE.Vector2(b.x - a.x, b.z - a.z).normalize();
const rightOf = (dir: THREE.Vector2) => new THREE.Vector2(-dir.y, dir.x);

/** Cars spread over a network: `count` of them, each on a different waypoint that leads somewhere (models in turn). */
export function spreadCars(network: TrafficNetwork, count: number, models: string[]): TrafficCar[] {
    const linked = new Set(network.links.flat());
    const spots = network.waypoints.filter((point) => linked.has(point.id));
    if (!spots.length) return [];
    const step = spots.length / Math.min(count, spots.length);
    return Array.from({ length: Math.min(count, spots.length) }, (_, i) => ({ at: spots[Math.floor(i * step)].id, model: models.length ? models[i % models.length] : undefined }));
}

export class Traffic {
    public readonly group = new THREE.Group();
    private readonly config: TrafficSettings;
    private readonly nodes = new Map<string, Node>();
    private readonly cars: Car[] = [];
    private readonly roadY: number;
    private destroyed = false;
    /** Resolves once every car has loaded (or failed: the rest drive on without it). */
    public readonly ready: Promise<void>;

    public constructor(private readonly options: TrafficOptions) {
        this.group.name = 'traffic';
        this.config = options.settings;
        this.roadY = options.roadY;
        for (const point of options.network.waypoints) this.nodes.set(point.id, { x: point.x, z: point.z, links: [] });
        for (const [a, b] of options.network.links) {
            const from = this.nodes.get(a);
            const to = this.nodes.get(b);
            if (!from || !to || from === to || from.links.includes(to)) continue;
            from.links.push(to);
            to.links.push(from);
        }
        const specs = options.cars.filter((spec) => this.nodes.get(spec.at)?.links.length);
        this.ready = Promise.all(specs.map((spec, i) => this.spawn(i, spec.at, spec.model ?? this.config.models[i % this.config.models.length]))).then(() => undefined);
    }

    private pickNext(prev: Node, node: Node): Node {
        const ways = node.links.filter((link) => link !== prev);
        if (!ways.length) return prev;
        const into = headingOf(prev, node);
        const straightest = ways.reduce((best, link) => (headingOf(node, link).dot(into) > headingOf(node, best).dot(into) ? link : best));
        const options = ways.flatMap((link) => (link === straightest && ways.length > 1 ? Array<Node>(STRAIGHT_WEIGHT).fill(link) : [link]));
        return options[Math.floor(Math.random() * options.length)];
    }

    /** Half way along the road in to half way along the road out, on the right-hand lane, curving round the corner. */
    private leg(prev: Node, node: Node, next: Node): Leg {
        const lane = this.config.lane;
        const centre = new THREE.Vector2(node.x, node.z);
        const inDir = headingOf(prev, node);
        const outDir = next === prev ? inDir.clone().negate() : headingOf(node, next);
        const start = new THREE.Vector2((prev.x + node.x) / 2, (prev.z + node.z) / 2).addScaledVector(rightOf(inDir), lane);
        const end = new THREE.Vector2((node.x + next.x) / 2, (node.z + next.z) / 2).addScaledVector(rightOf(outDir), lane);
        const cross = inDir.x * outDir.y - inDir.y * outDir.x;
        const points = [start];
        const curve = (a: THREE.Vector2, control: THREE.Vector2, b: THREE.Vector2) => {
            for (let i = 0; i <= CURVE_STEPS; i++) {
                const u = i / CURVE_STEPS;
                const k = 1 - u;
                points.push(new THREE.Vector2(k * k * a.x + 2 * u * k * control.x + u * u * b.x, k * k * a.y + 2 * u * k * control.y + u * u * b.y));
            }
        };
        if (next === prev || inDir.dot(outDir) < -0.95) {
            const a = centre.clone().addScaledVector(rightOf(inDir), lane);
            const b = centre.clone().addScaledVector(rightOf(outDir), lane);
            curve(a, centre.clone().addScaledVector(inDir, lane * 2), b);
        } else if (Math.abs(cross) > 0.05) {
            const a = centre.clone().addScaledVector(rightOf(inDir), lane);
            const b = centre.clone().addScaledVector(rightOf(outDir), lane);
            const t = ((b.x - a.x) * outDir.y - (b.y - a.y) * outDir.x) / cross;
            const corner = a.addScaledVector(inDir, t);
            const reach = Math.min(corner.distanceTo(start), corner.distanceTo(end));
            curve(corner.clone().addScaledVector(inDir, -reach), corner, corner.clone().addScaledVector(outDir, reach));
        }
        points.push(end);
        const distances = [0];
        for (let i = 1; i < points.length; i++) distances.push(distances[i - 1] + points[i].distanceTo(points[i - 1]));
        return { node, next, points, distances, length: Math.max(distances[distances.length - 1], 1e-3) };
    }

    private async spawn(id: number, at: string, model: string): Promise<void> {
        const node = this.nodes.get(at)!;
        let object: THREE.Object3D;
        try {
            object = await this.options.loadModel(model);
        } catch (error) {
            console.warn(`[Traffic] could not load ${model}`, error);
            return;
        }
        if (this.destroyed) return;
        const next = node.links[Math.floor(Math.random() * node.links.length)];
        const behind: Node = { x: node.x * 2 - next.x, z: node.z * 2 - next.z, links: [] };
        const leg = this.leg(behind, node, next);
        // Fitted to the car length (its z), centred, its wheels on the ground.
        object.updateWorldMatrix(true, true);
        const box = new THREE.Box3().setFromObject(object);
        const size = box.getSize(new THREE.Vector3());
        const scale = this.config.length / Math.max(1e-4, size.z);
        object.scale.multiplyScalar(scale);
        object.position.set(-((box.min.x + box.max.x) / 2) * scale, -box.min.y * scale, -((box.min.z + box.max.z) / 2) * scale);
        const root = new THREE.Group();
        root.add(object);
        this.options.prepare?.(root);
        this.group.add(root);
        const car: Car = { id, root, leg, along: leg.length * 0.5, speed: this.config.speed, position: new THREE.Vector2(), heading: new THREE.Vector2(0, 1) };
        this.place(car);
        this.cars.push(car);
    }

    private place(car: Car): void {
        const { points, distances, length } = car.leg;
        const along = Math.min(car.along, length);
        let i = 1;
        while (i < points.length - 1 && distances[i] < along) i++;
        const a = points[i - 1];
        const b = points[i];
        const u = THREE.MathUtils.clamp((along - distances[i - 1]) / Math.max(1e-6, distances[i] - distances[i - 1]), 0, 1);
        car.position.copy(a).lerp(b, u);
        car.heading.copy(b).sub(a);
        if (u > 0.5 && i < points.length - 1) car.heading.normalize().lerp(points[i + 1].clone().sub(b).normalize(), u - 0.5);
        if (car.heading.lengthSq() < 1e-9) car.heading.set(0, 1);
        car.heading.normalize();
        car.root.position.set(car.position.x, this.roadY, car.position.y);
        car.root.rotation.y = Math.atan2(car.heading.x, car.heading.y);
    }

    private inFront(car: Car, other: Car): boolean {
        const { length, gap } = this.config;
        const radius = (length * WIDTH_SHARE) / 2;
        const dx = other.position.x - car.position.x;
        const dz = other.position.y - car.position.y;
        const ahead = dx * car.heading.x + dz * car.heading.y;
        const side = Math.abs(dx * car.heading.y - dz * car.heading.x);
        return ahead > 0 && ahead < length / 2 + gap + radius && side < radius * 2 + 0.2;
    }

    public update(delta: number): void {
        const { speed, accel, brake } = this.config;
        const ahead = this.cars.map((car) => this.cars.filter((other) => other !== car && this.inFront(car, other)));
        this.cars.forEach((car, i) => {
            const blocked = ahead[i].some((other) => !(ahead[this.cars.indexOf(other)].includes(car) && car.id < other.id));
            const target = blocked ? 0 : speed;
            car.speed = target < car.speed ? Math.max(target, car.speed - brake * delta) : Math.min(target, car.speed + accel * delta);
            const moved = car.speed * delta;
            if (moved <= 0) return;
            car.along += moved;
            while (car.along >= car.leg.length) {
                car.along -= car.leg.length;
                const { node, next } = car.leg;
                car.leg = this.leg(node, next, this.pickNext(node, next));
            }
            this.place(car);
        });
    }

    /** Whether any car is within `radius` of the stretch a to b (people wait at the kerb while one is). */
    public anyNear(ax: number, az: number, bx: number, bz: number, radius: number): boolean {
        const dx = bx - ax;
        const dz = bz - az;
        const lengthSq = dx * dx + dz * dz || 1;
        return this.cars.some(({ position }) => {
            const t = Math.min(1, Math.max(0, ((position.x - ax) * dx + (position.y - az) * dz) / lengthSq));
            return Math.hypot(position.x - (ax + dx * t), position.y - (az + dz * t)) < radius;
        });
    }

    public destroy(): void {
        this.destroyed = true;
        this.group.removeFromParent();
        this.cars.length = 0;
    }
}
