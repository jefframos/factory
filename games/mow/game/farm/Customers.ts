// Customers.ts
//
// The chicken den's customers: the restaurant game's people (People.ts: eight skinned models dressed in random
// colours, with their walk and idle clips), as tall as the player, who walk up a path outside the den's fence
// to its SELL counter and queue there. The one at the counter asks for a few trays (a bubble over their head, always
// drawn on top: a tray and how many are still wanted); each tray handed over counts down, and with the last one
// they're happy (a heart), pay, and walk off down the path, the next stepping up. Walk and idle blend, the walk played
// at the pace that keeps the feet from sliding.

import * as THREE from 'three';
import gsap from 'gsap';
import { playerScale } from '../player/MowPlayer';
import { CanvasArt } from '../ui/CanvasArt';
import { loadPeople, People, PERSON_COUNT, PERSON_HEIGHT, PERSON_MODEL_HEIGHT, personCopy, randomOutfit } from './People';

/** How far the walk clip carries a model of PERSON_MODEL_HEIGHT a second (feet don't slide at this pace). */
const CLIP_WALK_SPEED = 1.38;
const WALK_SPEED = 1.5;
const BLEND_SPEED = 6;
const TURN_SPEED = 8;
const ARRIVE = 0.05;
/** The bubble over the head. */
const BUBBLE = { above: 0.45, width: 0.95, height: 0.76 };

type State = 'arriving' | 'waiting' | 'leaving' | 'gone';

/**
 * An order bubble on `canvas` (160 x 128): white with a tail, a tray of eggs and how many (`left`), or a heart (`happy`).
 * The customers' and the trucks'.
 */
export function drawOrderBubble(canvas: HTMLCanvasElement, left: number, happy: boolean): void {
    const g = canvas.getContext('2d')!;
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.fillStyle = '#ffffff';
    g.strokeStyle = 'rgba(20, 25, 35, 0.85)';
    g.lineWidth = 6;
    g.beginPath();
    g.roundRect(8, 8, 144, 86, 26);
    g.moveTo(70, 94);
    g.lineTo(80, 118);
    g.lineTo(92, 94);
    g.fill();
    g.stroke();
    if (happy) {
        CanvasArt.drawIcon(g, 'ItemIcon_Heart_Red', 80, 51, 64);
        return;
    }
    g.fillStyle = '#e2c48e';
    g.beginPath();
    g.roundRect(20, 54, 70, 22, 6);
    g.fill();
    g.fillStyle = '#fff3d6';
    g.strokeStyle = '#b9925a';
    g.lineWidth = 3;
    for (let i = 0; i < 3; i++) {
        g.beginPath();
        g.ellipse(34 + i * 21, 48, 10, 13, 0, 0, Math.PI * 2);
        g.fill();
        g.stroke();
    }
    CanvasArt.text(g, `x${left}`, 120, 52, 42, '#ffffff', 56);
}

export class Customer {
    public readonly root = new THREE.Group();
    public readonly position = new THREE.Vector3();
    public readonly target = new THREE.Vector3();
    /** Points to walk through before `target` (the path's end, on the way in or out). */
    public route: THREE.Vector3[] = [];
    /** With an in path: how far along it their place in the queue is (Customers.walkTo()), and the way they face there. */
    public arc = 0;
    public readonly face = new THREE.Vector3();
    /** Where they popped in (and pop out again). */
    public readonly home = new THREE.Vector3();
    public state: State = 'arriving';
    public got = 0;
    private readonly mixer: THREE.AnimationMixer;
    private readonly walkAction: THREE.AnimationAction;
    private readonly idleAction: THREE.AnimationAction;
    private walkWeight = 0;
    private readonly geometries: THREE.BufferGeometry[] = [];
    private readonly bubble: THREE.Sprite;
    /** The rig's head bone: the bubble follows it sideways (the clips lean the head off the model's middle). */
    private head?: THREE.Object3D;
    private static readonly headAt = new THREE.Vector3();
    private readonly canvas = document.createElement('canvas');
    private readonly texture: THREE.CanvasTexture;
    private drawn = '';

    public constructor(parent: THREE.Object3D, source: People, at: THREE.Vector3, public readonly wants: number) {
        const { model, meshes } = personCopy(source, Math.floor(Math.random() * PERSON_COUNT), randomOutfit());
        meshes.forEach(({ mesh }) => this.geometries.push(mesh.geometry));
        const scale = (PERSON_HEIGHT * playerScale()) / PERSON_MODEL_HEIGHT;
        model.scale.setScalar(scale);
        this.root.add(model);
        model.traverse((node) => {
            if (!this.head && (node as THREE.Bone).isBone && /head$/i.test(node.name)) this.head = node;
        });
        this.mixer = new THREE.AnimationMixer(model);
        this.walkAction = this.mixer.clipAction(source.clips.walk);
        this.idleAction = this.mixer.clipAction(source.clips.idle);
        this.walkAction.timeScale = (WALK_SPEED * playerScale()) / (CLIP_WALK_SPEED * scale);
        this.walkAction.setEffectiveWeight(0);
        this.idleAction.time = Math.random() * source.clips.idle.duration;
        this.walkAction.play();
        this.idleAction.play();

        this.canvas.width = 160;
        this.canvas.height = 128;
        this.texture = CanvasArt.texture(this.canvas);
        // Always over the heads (the queue stands one behind the other on screen).
        this.bubble = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.texture, depthWrite: false, depthTest: false }));
        this.bubble.scale.set(BUBBLE.width, BUBBLE.height, 1);
        this.bubble.renderOrder = 30;
        this.root.add(this.bubble);
        this.bubble.position.y = (PERSON_HEIGHT + BUBBLE.above) * playerScale();

        this.position.copy(at);
        this.home.copy(at);
        this.root.position.copy(at);
        parent.add(this.root);
        // Popping in, as if arriving from somewhere.
        this.root.scale.setScalar(0.01);
        gsap.to(this.root.scale, { x: 1, y: 1, z: 1, duration: 0.45, ease: 'back.out(2)' });
    }

    /** Walks through `route` to `target`, blending walk and idle, turning to the way they go (or `facing` once there). */
    public update(delta: number, facing: THREE.Vector3): boolean {
        while (this.route.length && Math.hypot(this.route[0].x - this.position.x, this.route[0].z - this.position.z) <= ARRIVE) this.route.shift();
        const goal = this.route[0] ?? this.target;
        const dx = goal.x - this.position.x;
        const dz = goal.z - this.position.z;
        const distance = Math.hypot(dx, dz);
        const walking = distance > ARRIVE;
        if (walking) {
            const step = Math.min(distance, WALK_SPEED * playerScale() * delta);
            this.position.x += (dx / distance) * step;
            this.position.z += (dz / distance) * step;
        }
        const heading = walking ? Math.atan2(dx, dz) : Math.atan2(facing.x, facing.z);
        const difference = Math.atan2(Math.sin(heading - this.root.rotation.y), Math.cos(heading - this.root.rotation.y));
        this.root.rotation.y += Math.sign(difference) * Math.min(Math.abs(difference), TURN_SPEED * delta);
        this.root.position.copy(this.position);
        this.walkWeight += ((walking ? 1 : 0) - this.walkWeight) * Math.min(1, BLEND_SPEED * delta);
        this.walkAction.setEffectiveWeight(this.walkWeight);
        this.idleAction.setEffectiveWeight(1 - this.walkWeight);
        this.mixer.update(delta);
        // The bubble stays upright whichever way they turn (a sprite), right over their head (the bone, as animated).
        if (this.head) {
            this.root.updateWorldMatrix(true, false);
            this.head.updateWorldMatrix(true, false);
            const at = this.root.worldToLocal(this.head.getWorldPosition(Customer.headAt));
            // (Unscaled by the pop-in: the root's own scale's in worldToLocal.)
            this.bubble.position.x = at.x;
            this.bubble.position.z = at.z;
        }
        this.drawBubble();
        return walking;
    }

    private drawBubble(): void {
        const happy = this.state === 'leaving';
        const key = happy ? 'happy' : `${this.wants - this.got}`;
        if (key === this.drawn) return;
        this.drawn = key;
        drawOrderBubble(this.canvas, this.wants - this.got, happy);
        this.texture.needsUpdate = true;
    }

    /** Popping out (gone where they came from), then removed. */
    public popOut(done: () => void): void {
        gsap.to(this.root.scale, { x: 0.01, y: 0.01, z: 0.01, duration: 0.35, ease: 'back.in(2)', onComplete: done });
    }

    public destroy(): void {
        gsap.killTweensOf(this.root.scale);
        this.mixer.stopAllAction();
        this.geometries.forEach((geometry) => geometry.dispose());
        this.texture.dispose();
        this.bubble.material.dispose();
        this.root.removeFromParent();
    }
}

export class Customers {
    private readonly group = new THREE.Group();
    /** The queue, front (at the counter) first, and those walking off. */
    private readonly queue: Customer[] = [];
    private readonly leaving: Customer[] = [];
    private timer = 0;
    private source?: People;

    /** Popping out, then removed. */
    private readonly gone = new Set<Customer>();

    /**
     * With an in path: the way in (its points, then the counter's place) and how far along it each point is. The queue
     * runs back along it from the counter, a place every `gap`: someone further back stops at their place on the way.
     */
    private readonly way?: { points: THREE.Vector3[]; at: number[]; length: number; gap: number };

    /**
     * `slots`: the queue's places, the counter's first; `entry`: the path's end (they come and go through it);
     * `from()`: where one pops in (a `people` spawn area; the path's end without one); `facing`: the way the one at the
     * counter looks (toward it).
     */
    public constructor(threeScene: THREE.Scene, private readonly slots: THREE.Vector3[], private readonly entry: THREE.Vector3,
        private readonly from: () => THREE.Vector3, private readonly facing: THREE.Vector3,
        private readonly config: { wants: [number, number]; queue: number; everySec: number },
        private readonly paths?: { in: THREE.Vector3[]; out: THREE.Vector3[] }) {
        threeScene.add(this.group);
        if (paths) {
            const points = [...paths.in.map((p) => p.clone()), slots[0].clone()];
            const at = [0];
            for (let i = 1; i < points.length; i++) at.push(at[i - 1] + points[i].distanceTo(points[i - 1]));
            const gap = slots.length > 1 ? slots[1].distanceTo(slots[0]) : 1.5;
            this.way = { points, at, length: at[at.length - 1], gap };
        }
        void loadPeople().then((source) => (this.source = source)).catch((error) => console.warn('[Customers] people', error));
    }

    /** The point `arc` along the way in (before its start: on back along its first stretch), and the way it heads there. */
    private wayPoint(arc: number, out: THREE.Vector3, heading: THREE.Vector3): THREE.Vector3 {
        const { points, at } = this.way!;
        let i = 1;
        while (i < points.length - 1 && at[i] < arc) i++;
        const a = points[i - 1];
        const b = points[i];
        const span = Math.max(1e-6, at[i] - at[i - 1]);
        heading.subVectors(b, a).setY(0).normalize();
        return out.copy(a).lerp(b, (arc - at[i - 1]) / span);
    }

    /**
     * Sends `customer` to place `index` in the queue: straight to its slot, or (with an in path) on along the path to
     * its place there, through the path's corners between where they're headed now (`from`, along it) and there.
     */
    private walkTo(customer: Customer, index: number, from: number): void {
        if (!this.way) {
            customer.target.copy(this.slots[index]);
            return;
        }
        const arc = this.way.length - index * this.way.gap;
        // The corners still ahead of them, then those past where they were headed up to the new place.
        const corners = this.way.points.filter((_, i) => this.way!.at[i] > from + 1e-3 && this.way!.at[i] < arc - 1e-3);
        customer.route.push(...corners.map((p) => p.clone()));
        this.wayPoint(arc, customer.target, customer.face);
        customer.arc = arc;
        // The one at the counter looks at it; the rest along the way (at the one ahead).
        if (index === 0) customer.face.copy(this.facing);
    }

    /** The one at the counter, if they're there and still want trays. */
    public get front(): Customer | undefined {
        const first = this.queue[0];
        return first && first.state === 'waiting' && first.got < first.wants && first.position.distanceTo(this.slots[0]) < 0.2 ? first : undefined;
    }

    /** Where a tray handed to `customer` lands (their hands). */
    public handsOf(customer: Customer, out = new THREE.Vector3()): THREE.Vector3 {
        return out.copy(customer.position).setY(0.6 * PERSON_HEIGHT * playerScale());
    }

    /** A tray reached `customer`: counted; true when that was their last (they pay, then go). */
    public give(customer: Customer): boolean {
        customer.got++;
        if (customer.got < customer.wants) return false;
        customer.state = 'leaving';
        if (this.paths) {
            // Out along the out path, popping out at its end.
            const out = this.paths.out;
            customer.route = out.slice(0, -1).map((p) => p.clone());
            customer.target.copy(out[out.length - 1]);
        } else {
            customer.route = [this.entry.clone()];
            customer.target.copy(customer.home);
        }
        this.queue.splice(this.queue.indexOf(customer), 1);
        this.leaving.push(customer);
        this.queue.forEach((other, i) => this.walkTo(other, i, other.arc));
        return true;
    }

    public update(delta: number): void {
        this.timer -= delta;
        if (this.source && this.timer <= 0 && this.queue.length < this.config.queue) {
            this.timer = this.config.everySec;
            const [low, high] = this.config.wants;
            const start = this.paths ? this.paths.in[0].clone() : this.from();
            const customer = new Customer(this.group, this.source, start, low + Math.floor(Math.random() * (high - low + 1)));
            // With an in path: along it only as far as their place in the queue (walkTo() adds the corners on the way).
            customer.route = this.paths ? [] : [this.entry.clone()];
            this.walkTo(customer, this.queue.length, 0);
            this.queue.push(customer);
        }
        for (const customer of this.queue) {
            const walking = customer.update(delta, this.way ? customer.face : this.facing);
            if (!walking && customer.state === 'arriving') customer.state = 'waiting';
        }
        for (let i = this.leaving.length - 1; i >= 0; i--) {
            const customer = this.leaving[i];
            if (customer.update(delta, this.facing) || this.gone.has(customer)) continue;
            this.gone.add(customer);
            customer.popOut(() => {
                customer.destroy();
                this.gone.delete(customer);
                this.leaving.splice(this.leaving.indexOf(customer), 1);
            });
        }
    }

    public destroy(): void {
        [...this.queue, ...this.leaving].forEach((customer) => customer.destroy());
        this.group.removeFromParent();
    }
}
