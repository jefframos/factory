// Trucks.ts
//
// The den's truck (TruckDockDef): one at a time, it pops in at a `trucks` spawn area, drives the roads (Roads.ts) to
// the den's dock, parks there and asks for a big load of trays (a bubble over it, counting down); loaded, it's happy
// (a heart), turns round and drives back to pop out where it came from. Then, after `everySec`, the next one.

import * as THREE from 'three';
import gsap from 'gsap';
import ModelLoaderManager from 'core/three/ModelLoaderManager';
import { BendService } from '../services/BendService';
import { TruckDockDef } from '../data/MowConfig';
import { drawOrderBubble } from './Customers';

const TURN_SPEED = 3;
const ARRIVE = 0.15;
/** Its bubble, over the cab. */
const BUBBLE = { width: 1.6, height: 1.28 };

type State = 'gone' | 'arriving' | 'parked' | 'leaving';

export class Trucks {
    private readonly root = new THREE.Group();
    private readonly body = new THREE.Group();
    private readonly bubble: THREE.Sprite;
    private readonly canvas = document.createElement('canvas');
    private readonly texture: THREE.CanvasTexture;
    private drawn = '';
    private height = 2;
    private state: State = 'gone';
    private route: THREE.Vector3[] = [];
    private leg = 0;
    private timer = 1;
    private heading = 0;
    public wants = 0;
    public got = 0;

    /**
     * `path`: from the spawn (first) over the roads to where it parks (last); `back`: from there out again (its own
     * lane); `parkFacing`: the way it faces parked (radians round y).
     */
    public constructor(threeScene: THREE.Scene, private readonly config: TruckDockDef, private readonly path: THREE.Vector3[],
        private readonly back: THREE.Vector3[], private readonly parkFacing: number) {
        this.root.add(this.body);
        this.root.visible = false;
        this.canvas.width = 160;
        this.canvas.height = 128;
        this.texture = new THREE.CanvasTexture(this.canvas);
        this.texture.colorSpace = THREE.SRGBColorSpace;
        this.bubble = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.texture, depthWrite: false, depthTest: false }));
        this.bubble.scale.set(BUBBLE.width, BUBBLE.height, 1);
        this.bubble.renderOrder = 30;
        this.root.add(this.bubble);
        threeScene.add(this.root);
        void ModelLoaderManager.instance.loadModel(`./mow/models/${config.model}`).then((object) => {
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
            const scale = config.length / Math.max(1e-4, size.z);
            object.scale.multiplyScalar(scale);
            object.position.set(-(box.min.x + box.max.x) / 2 * scale, -box.min.y * scale, -(box.min.z + box.max.z) / 2 * scale);
            this.height = size.y * scale;
            this.bubble.position.set(0, this.height + 0.9, 0);
            this.body.add(object);
        }).catch((error) => console.warn('[Trucks] model', config.model, error));
    }

    /** The truck parked at the dock, still wanting trays. */
    public get parked(): boolean {
        return this.state === 'parked' && this.got < this.wants;
    }

    /** Where a tray lands in it: its bed, behind the cab. */
    public bed(out = new THREE.Vector3()): THREE.Vector3 {
        const back = -this.config.length * 0.22;
        return out.set(this.root.position.x + Math.sin(this.heading) * back, this.height * 0.55, this.root.position.z + Math.cos(this.heading) * back);
    }

    /** A tray reached it: counted; true when that was the last (it pays, then goes). */
    public give(): boolean {
        this.got++;
        if (this.got < this.wants) return false;
        this.state = 'leaving';
        this.route = this.back;
        this.leg = 0;
        return true;
    }

    public update(delta: number): void {
        if (this.state === 'gone') {
            this.timer -= delta;
            if (this.timer > 0 || this.path.length < 2) return;
            this.arrive();
            return;
        }
        if (this.state === 'arriving' || this.state === 'leaving') this.drive(delta);
        else this.turnTo(this.parkFacing, delta);
        this.root.rotation.y = this.heading;
        const key = this.state === 'leaving' ? 'happy' : `${this.wants - this.got}`;
        if (key !== this.drawn) {
            this.drawn = key;
            drawOrderBubble(this.canvas, this.wants - this.got, this.state === 'leaving');
            this.texture.needsUpdate = true;
        }
        this.bubble.visible = this.state === 'parked' || this.state === 'leaving';
    }

    /** A new truck: pops in at the spawn, wanting a load. */
    private arrive(): void {
        const [low, high] = this.config.wants;
        this.wants = low + Math.floor(Math.random() * (high - low + 1));
        this.got = 0;
        this.state = 'arriving';
        this.route = this.path;
        this.leg = 1;
        this.root.position.copy(this.path[0]);
        this.heading = Math.atan2(this.path[1].x - this.path[0].x, this.path[1].z - this.path[0].z);
        this.root.visible = true;
        this.root.scale.setScalar(0.01);
        gsap.to(this.root.scale, { x: 1, y: 1, z: 1, duration: 0.5, ease: 'back.out(2)' });
    }

    /** Along the route, turning into each leg; at its end: parked, or (leaving) gone. */
    private drive(delta: number): void {
        const to = this.route[this.leg];
        if (!to) return;
        const position = this.root.position;
        const dx = to.x - position.x;
        const dz = to.z - position.z;
        const distance = Math.hypot(dx, dz);
        // Leaving: turn round on the spot first (the way back starts where it's parked).
        this.turnTo(Math.atan2(dx, dz), delta);
        const facing = Math.abs(Math.atan2(Math.sin(Math.atan2(dx, dz) - this.heading), Math.cos(Math.atan2(dx, dz) - this.heading)));
        const speed = this.config.speed * (facing > 0.8 ? 0.15 : 1);
        if (distance > ARRIVE) {
            const step = Math.min(distance, speed * delta);
            position.x += (dx / distance) * step;
            position.z += (dz / distance) * step;
            return;
        }
        this.leg++;
        if (this.leg < this.route.length) return;
        if (this.state === 'arriving') {
            this.state = 'parked';
            return;
        }
        // Back at the spawn: pops out; the next comes in a while.
        this.state = 'gone';
        this.timer = this.config.everySec;
        gsap.to(this.root.scale, { x: 0.01, y: 0.01, z: 0.01, duration: 0.35, ease: 'back.in(2)', onComplete: () => void (this.root.visible = false) });
    }

    private turnTo(angle: number, delta: number): void {
        const difference = Math.atan2(Math.sin(angle - this.heading), Math.cos(angle - this.heading));
        this.heading += Math.sign(difference) * Math.min(Math.abs(difference), TURN_SPEED * delta);
    }

    public destroy(): void {
        gsap.killTweensOf(this.root.scale);
        this.texture.dispose();
        this.bubble.material.dispose();
        this.root.removeFromParent();
    }
}
