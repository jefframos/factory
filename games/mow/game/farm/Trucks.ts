// Trucks.ts
//
// The den's trucks (TruckDockDef): they come one after another (every `everySec`, up to `queue` on the way at once),
// pop in at the start of their way in, drive it and line up behind each other; the front one parks (the end of the way
// in: the park point) and asks for a load of trays (a bubble over it, counting down). Loaded, it's happy (a heart) and
// drives on along the way out (not back through the queue), popping out at its end; the next one moves up and parks.
// Each is one of the dock's `models` (small cargo trucks now; container trucks, boats... later), at its `length`.

import * as THREE from 'three';
import gsap from 'gsap';
import ModelLoaderManager from 'core/three/ModelLoaderManager';
import { BendService } from '../services/BendService';
import { TruckDockDef } from '../data/MowConfig';
import { drawOrderBubble, Order, OrderItem, randomOrder } from './Customers';

const TURN_SPEED = 3;
/** Its bubble, over the cab. */
const BUBBLE = { width: 1.6, height: 1.28 };
/** The gap left to the truck ahead in the queue (on top of a truck's length). */
const QUEUE_GAP = 1.2;
/** Slowing to a stop over this distance (behind the one ahead, or at the park point). */
const EASE_DISTANCE = 1.5;

type State = 'arriving' | 'parked' | 'leaving';

/** A path as distances along it: its points, each stretch's length, and the whole. */
interface Way {
    points: THREE.Vector3[];
    lengths: number[];
    total: number;
}

function way(points: THREE.Vector3[]): Way {
    const lengths = points.slice(1).map((p, i) => p.distanceTo(points[i]));
    return { points, lengths, total: lengths.reduce((a, b) => a + b, 0) };
}

/** The point `s` along a way, and the way it heads there (radians round y). */
function along(w: Way, s: number, out: THREE.Vector3): number {
    let left = Math.max(0, Math.min(w.total, s));
    for (let i = 0; i < w.lengths.length; i++) {
        if (left <= w.lengths[i] || i === w.lengths.length - 1) {
            const a = w.points[i];
            const b = w.points[i + 1];
            out.lerpVectors(a, b, w.lengths[i] > 0 ? Math.min(1, left / w.lengths[i]) : 0);
            return Math.atan2(b.x - a.x, b.z - a.z);
        }
        left -= w.lengths[i];
    }
    out.copy(w.points[0]);
    return 0;
}

/** One truck: its model, its bubble, where it is (`s` along its way in or out) and its load. */
class Truck {
    public readonly root = new THREE.Group();
    private readonly bubble: THREE.Sprite;
    private readonly canvas = document.createElement('canvas');
    private readonly texture: THREE.CanvasTexture;
    private drawn = '';
    public height = 2;
    public state: State = 'arriving';
    public s = 0;
    public heading = 0;
    public wants = 0;
    public got = 0;
    public gone = false;
    /** What it wants of several goods (the cows' trucks), else a count of trays. */
    public order?: Order;

    public constructor(parent: THREE.Object3D, model: string, length: number, wants: number) {
        this.wants = wants;
        this.canvas.width = 160;
        this.canvas.height = 128;
        this.texture = new THREE.CanvasTexture(this.canvas);
        this.texture.colorSpace = THREE.SRGBColorSpace;
        this.bubble = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.texture, depthWrite: false, depthTest: false }));
        this.bubble.scale.set(BUBBLE.width, BUBBLE.height, 1);
        this.bubble.renderOrder = 30;
        this.bubble.visible = false;
        this.root.add(this.bubble);
        parent.add(this.root);
        this.root.scale.setScalar(0.01);
        gsap.to(this.root.scale, { x: 1, y: 1, z: 1, duration: 0.5, ease: 'back.out(2)' });
        void ModelLoaderManager.instance.loadModel(`./mow/models/${model}`).then((object) => {
            if (this.gone) return;
            object.traverse((child) => {
                if (!(child instanceof THREE.Mesh)) return;
                child.material = [child.material].flat().map((m) => {
                    const copy = m.clone();
                    BendService.applyBend(copy);
                    return copy;
                });
                if ((child.material as THREE.Material[]).length === 1) child.material = (child.material as THREE.Material[])[0];
            });
            const box = new THREE.Box3().setFromObject(object);
            const size = box.getSize(new THREE.Vector3());
            const scale = length / Math.max(1e-4, size.z);
            object.scale.multiplyScalar(scale);
            object.position.set(-(box.min.x + box.max.x) / 2 * scale, -box.min.y * scale, -(box.min.z + box.max.z) / 2 * scale);
            this.height = size.y * scale;
            this.bubble.position.set(0, this.height + 0.9, 0);
            this.root.add(object);
        }).catch((error) => console.warn('[Trucks] model', model, error));
    }

    public turnTo(angle: number, delta: number): void {
        const difference = Math.atan2(Math.sin(angle - this.heading), Math.cos(angle - this.heading));
        this.heading += Math.sign(difference) * Math.min(Math.abs(difference), TURN_SPEED * delta);
        this.root.rotation.y = this.heading;
    }

    public drawBubble(): void {
        const key = this.state === 'leaving' ? 'happy' : this.order ? this.order.map((line) => `${line.item}${line.left}`).join(',') : `${this.wants - this.got}`;
        if (key !== this.drawn) {
            this.drawn = key;
            drawOrderBubble(this.canvas, this.wants - this.got, this.state === 'leaving', this.order);
            this.texture.needsUpdate = true;
        }
        this.bubble.visible = this.state === 'parked' || (this.state === 'leaving' && this.s < 4);
    }

    /** Pops out and is gone. */
    public leave(): void {
        this.gone = true;
        gsap.to(this.root.scale, { x: 0.01, y: 0.01, z: 0.01, duration: 0.35, ease: 'back.in(2)', onComplete: () => this.destroy() });
    }

    public destroy(): void {
        gsap.killTweensOf(this.root.scale);
        this.texture.dispose();
        this.bubble.material.dispose();
        this.root.removeFromParent();
    }
}

export class Trucks {
    private readonly group = new THREE.Group();
    private readonly inWay: Way;
    private readonly outWay: Way;
    /** On the way in (front first, the parked one among them), and on the way out. */
    private readonly queue: Truck[] = [];
    private readonly leaving: Truck[] = [];
    private timer = 1;
    private nextModel = 0;
    /** How hungry the market is (Customers.demand): bigger loads, more often, with a big stock waiting. */
    public demand: () => number = () => 1;

    /**
     * `path`: from where they pop in to where they park (its last point); `out`: from the park point on to where they
     * pop out; `parkFacing`: the way a parked one faces (radians round y).
     */
    public constructor(threeScene: THREE.Scene, private readonly config: TruckDockDef, path: THREE.Vector3[], out: THREE.Vector3[],
        private readonly parkFacing: number, private readonly items?: readonly OrderItem[]) {
        this.inWay = way(path);
        this.outWay = way(out.length >= 2 ? out : [...path].reverse());
        threeScene.add(this.group);
    }

    /** The front truck, parked at the dock and still wanting trays. */
    private get front(): Truck | undefined {
        const truck = this.queue[0];
        return truck && truck.state === 'parked' && truck.got < truck.wants ? truck : undefined;
    }

    public get parked(): boolean {
        return !!this.front;
    }

    /** What the parked truck wants in all. */
    public get wants(): number {
        return this.queue[0]?.wants ?? 0;
    }

    /** Where a tray lands in the parked truck: its bed, behind the cab. */
    public bed(out = new THREE.Vector3()): THREE.Vector3 {
        const truck = this.queue[0];
        if (!truck) return out.set(0, 0, 0);
        const back = -this.length * 0.22;
        return out.set(truck.root.position.x + Math.sin(truck.heading) * back, truck.height * 0.55, truck.root.position.z + Math.cos(truck.heading) * back);
    }

    /** Whether the parked truck still wants `item` (an order of several goods), or anything (a count of trays). */
    public wantsItem(item?: OrderItem): boolean {
        const truck = this.front;
        if (!truck) return false;
        return !truck.order || truck.order.some((line) => line.item === item && line.left > 0);
    }

    /** A tray (or, an order of goods, an `item`) reached the parked truck: counted; true when that was the last (it pays, then drives on out). */
    public give(item?: OrderItem): boolean {
        const truck = this.front;
        if (!truck) return false;
        const line = item ? truck.order?.find((entry) => entry.item === item && entry.left > 0) : undefined;
        if (line) line.left--;
        truck.got++;
        if (truck.got < truck.wants) return false;
        truck.state = 'leaving';
        truck.s = 0;
        this.queue.shift();
        this.leaving.push(truck);
        return true;
    }

    private get length(): number {
        return this.config.length;
    }

    /** A new truck at the start of the way in (the next of the dock's models), wanting a load. */
    private arrive(): void {
        const models = this.config.models?.length ? this.config.models : [this.config.model];
        const model = models[this.nextModel++ % models.length];
        const [low, high] = this.config.wants;
        const truck = new Truck(this.group, model, this.length, Math.round((low + Math.floor(Math.random() * (high - low + 1))) * Math.max(1, this.demand())));
        if (this.items?.length) truck.order = randomOrder(this.items, truck.wants);
        truck.heading = along(this.inWay, 0, truck.root.position);
        truck.root.rotation.y = truck.heading;
        this.queue.push(truck);
    }

    public update(delta: number): void {
        // The next one, while the queue has room and the start is clear.
        this.timer -= delta;
        const last = this.queue[this.queue.length - 1];
        const startClear = !last || last.s > this.length + QUEUE_GAP;
        if (this.timer <= 0 && this.queue.length < (this.config.queue ?? 3) && startClear && this.inWay.total > 0) {
            this.timer = this.config.everySec / Math.max(1, this.demand());
            this.arrive();
        }
        // On the way in: each up to the park point, or a gap behind the one ahead, easing to a stop.
        const position = new THREE.Vector3();
        this.queue.forEach((truck, i) => {
            const stop = i === 0 ? this.inWay.total : this.queue[i - 1].s - this.length - QUEUE_GAP;
            const room = stop - truck.s;
            if (truck.state === 'arriving' && room > 0.01) {
                const speed = this.config.speed * Math.min(1, Math.max(0.15, room / EASE_DISTANCE));
                truck.s = Math.min(stop, truck.s + speed * delta);
            }
            const heading = along(this.inWay, truck.s, position);
            truck.root.position.copy(position);
            if (i === 0 && truck.s >= this.inWay.total - 0.01) {
                truck.state = 'parked';
                truck.turnTo(this.parkFacing, delta);
            } else {
                truck.turnTo(heading, delta);
            }
            truck.drawBubble();
        });
        // On the way out: along it, popping out at its end.
        for (let i = this.leaving.length - 1; i >= 0; i--) {
            const truck = this.leaving[i];
            truck.s = Math.min(this.outWay.total, truck.s + this.config.speed * delta);
            const heading = along(this.outWay, truck.s, position);
            truck.root.position.copy(position);
            truck.turnTo(heading, delta);
            truck.drawBubble();
            if (truck.s >= this.outWay.total - 0.01) {
                this.leaving.splice(i, 1);
                truck.leave();
            }
        }
    }

    public destroy(): void {
        [...this.queue, ...this.leaving].forEach((truck) => truck.destroy());
        this.group.removeFromParent();
    }
}
