// IceCream.ts
//
// The ice cream station: the soft-serve machine the layout places (a prop whose model is KayKit's icecream_machine, with
// its three handles: vanilla, chocolate, strawberry), and the making of a cone at it. Super simple:
//   1. tap the stack of cones (on the machine's tray): a cone hops onto the tray, under the middle;
//   2. tap a flavour's handle: the cone slides under its nozzle, the handle's pulled and the swirl grows on the cone;
//   3. tap the cone (or SERVE) to serve it: it goes out on a plate (as a burger does), to the counter or the customer's
//      table, where it's eaten (and the plate stays, to clear, as a burger's).
// TRASH tosses the cone. What the player taps (`targets`) works as the burger kitchen's: a spot and a radius, the one
// nearest the tap on screen.
//
// Everything is placed in the machine model's own space (TRAY: KayKit's machine is 2 x 2.4, its tray 0.73 up, the nozzles
// over its front edge), so it follows wherever the machine is put and however it's turned or sized.

import * as THREE from 'three';
import gsap from 'gsap';
import { kitchenModel } from './Models';
import { CONE_MODEL, CONE_STACK_MODEL, FLAVORS, Flavor, SWIRL_MODELS } from '../data/Recipes';
import type { CameraShot } from './RestaurantLayout';

/** In the machine model's space: the tray's top, how far forward a cone stands (under the nozzles), the cone stack's spot. */
const TRAY = { y: 0.73, z: 0.72, stackX: -0.72, stackZ: 0.6 };
/** A cone's size (x its model: the swirl then fits under the nozzle); where the swirl sits on it (its model's units). */
const CONE = { scale: 0.85, swirlAt: 0.5 };
/** The swirl coming out: how long (s), how far the handle's pulled (radians, toward the front). */
const POUR = { seconds: 0.8, pull: 0.55 };
const HOP = { height: 0.45, seconds: 0.3 };
/** A served cone's plate (x the plate model), the arc to where it's served. */
const SERVE = { plate: 0.72, seconds: 0.8, height: 1.2 };
/** Tap reach round the stack, a handle, the cone (world units, across the screen). */
const REACH = { stack: 0.45, handle: 0.32, cone: 0.4 };
/** The camera on the machine: from its front, this far out and up, looking at its tray; field of view. */
const SHOT = { out: 3.3, up: 1.25, aimUp: 1.1, fov: 46 };

export type IceTarget = 'cones' | 'cone' | Flavor;

/** The machine's handle node for a flavour (KayKit's names). */
const handleName = (flavor: Flavor) => `icecream_machine_handle_${flavor}`;

export class IceCreamStation {
    /** In step with the machine model (its world transform): everything here is placed in its space. */
    private readonly group = new THREE.Group();
    public readonly targets: { kind: IceTarget; at: THREE.Vector3; radius: number }[] = [];
    private readonly handles = new Map<Flavor, THREE.Object3D>();
    /** The cone being made: its group, where it stands (x along the tray), its swirl's flavour once poured. */
    private cone: { object: THREE.Group; flavor: Flavor | null; landed: boolean; pouring: boolean } | null = null;
    /** Served cones' plates waiting at the counter (cleared when the customer goes). */
    private readonly served: THREE.Object3D[] = [];

    /** `machine`: the machine prop's object in the room (its model inside it, handles and all). */
    public constructor(private readonly scene: THREE.Object3D, machine: THREE.Object3D) {
        machine.updateWorldMatrix(true, true);
        for (const flavor of FLAVORS) {
            const handle = machine.getObjectByName(handleName(flavor));
            if (handle) this.handles.set(flavor, handle);
        }
        // The model's own space: the handles' parent (else the prop itself).
        const frame = this.handles.values().next().value?.parent ?? machine;
        frame.matrixWorld.decompose(this.group.position, this.group.quaternion, this.group.scale);
        scene.add(this.group);

        const stack = kitchenModel(CONE_STACK_MODEL);
        stack.scale.setScalar(CONE.scale);
        stack.position.set(TRAY.stackX, TRAY.y, TRAY.stackZ);
        this.group.add(stack);
        this.addTarget('cones', new THREE.Vector3(TRAY.stackX, TRAY.y + 0.6, TRAY.stackZ), REACH.stack);
        for (const [flavor, handle] of this.handles) {
            this.addTarget(flavor, new THREE.Vector3(handle.position.x, handle.position.y + 0.2, handle.position.z), REACH.handle);
        }
        this.addTarget('cone', new THREE.Vector3(0, TRAY.y + 0.5, TRAY.z), REACH.cone);
    }

    /** Whether the machine has its handles (KayKit's model): without them there's nothing to pull. */
    public get usable(): boolean {
        return this.handles.size > 0;
    }

    private addTarget(kind: IceTarget, local: THREE.Vector3, radius: number): void {
        this.targets.push({ kind, at: this.group.localToWorld(local), radius });
    }

    /** Where to point at `kind` (world: a hint's hand); the cone's own spot follows it along the tray. */
    public targetPoint(kind: IceTarget): THREE.Vector3 {
        if (kind === 'cone') return this.dishPoint;
        return this.targets.find((t) => t.kind === kind)!.at.clone();
    }

    /** The camera on the machine: from its front, looking at the tray (framed as the stations' shots). */
    public get shot(): CameraShot {
        const aim = this.group.localToWorld(new THREE.Vector3(0, SHOT.aimUp, TRAY.z));
        const front = new THREE.Vector3(0, 0, 1).applyQuaternion(this.group.quaternion).setY(0).normalize();
        const position = aim.clone().addScaledVector(front, SHOT.out).add(new THREE.Vector3(0, SHOT.up, 0));
        return { position, target: aim, fov: SHOT.fov };
    }

    // ---------------------------------------------------------------- making it

    public get hasCone(): boolean {
        return Boolean(this.cone);
    }

    /** The flavour poured (the swirl's grown), or null. */
    public get flavor(): Flavor | null {
        return this.cone && !this.cone.pouring ? this.cone.flavor : null;
    }

    /** Done: a cone with its swirl. */
    public get ready(): boolean {
        return Boolean(this.cone?.landed && this.cone.flavor && !this.cone.pouring);
    }

    /** What the ticket ticks: the cone (on the tray), its flavour (poured). */
    public get made(): string[] {
        if (!this.cone?.landed) return [];
        return this.flavor ? ['cone', this.flavor] : ['cone'];
    }

    /** Over the cone (world): where the "ready" badge and the hint go. */
    public get dishPoint(): THREE.Vector3 {
        const x = this.cone?.object.position.x ?? 0;
        return this.group.localToWorld(new THREE.Vector3(x, TRAY.y + 1.15, TRAY.z));
    }

    /** A tap on `kind`: 'done' if it did something; otherwise why not. */
    public take(kind: IceTarget): 'done' | 'busy' | 'noCone' | 'poured' | 'serve' {
        if (kind === 'cone') return this.ready ? 'serve' : this.cone ? 'busy' : 'noCone';
        if (kind === 'cones') return this.newCone();
        return this.pour(kind);
    }

    private newCone(): 'done' | 'busy' {
        if (this.cone) return 'busy';
        const object = new THREE.Group();
        object.add(kitchenModel(CONE_MODEL));
        object.scale.setScalar(CONE.scale);
        // Off the top of the stack, onto the tray under the middle.
        object.position.set(TRAY.stackX, TRAY.y + 0.55, TRAY.stackZ);
        this.group.add(object);
        const cone = { object, flavor: null as Flavor | null, landed: false, pouring: false };
        this.cone = cone;
        this.hop(object, new THREE.Vector3(0, TRAY.y, TRAY.z), () => (cone.landed = true));
        return 'done';
    }

    private pour(flavor: Flavor): 'done' | 'noCone' | 'busy' | 'poured' {
        const cone = this.cone;
        if (!cone) return 'noCone';
        if (!cone.landed || cone.pouring) return 'busy';
        if (cone.flavor) return 'poured';
        const handle = this.handles.get(flavor);
        if (!handle) return 'busy';
        cone.flavor = flavor;
        cone.pouring = true;
        const swirl = kitchenModel(SWIRL_MODELS[flavor]);
        swirl.position.y = CONE.swirlAt;
        swirl.scale.setScalar(0.001);
        cone.object.add(swirl);
        const rest = handle.userData.rest ?? (handle.userData.rest = handle.rotation.x);
        gsap.timeline()
            // Under its nozzle.
            .to(cone.object.position, { x: handle.position.x, duration: 0.2, ease: 'power2.out' })
            // The handle down, the swirl grows (turning as it comes out), the handle back up.
            .to(handle.rotation, { x: rest + POUR.pull, duration: 0.15, ease: 'power2.out' })
            .to(swirl.scale, { x: 1, y: 1, z: 1, duration: POUR.seconds, ease: 'power1.out' }, '<')
            .fromTo(swirl.rotation, { y: -Math.PI }, { y: 0, duration: POUR.seconds, ease: 'power1.out' }, '<')
            .to(handle.rotation, { x: rest, duration: 0.2, ease: 'back.out(2)' })
            .add(() => {
                cone.pouring = false;
                gsap.fromTo(cone.object.scale, { x: CONE.scale * 1.1, y: CONE.scale * 0.92, z: CONE.scale * 1.1 }, { x: CONE.scale, y: CONE.scale, z: CONE.scale, duration: 0.25, ease: 'back.out(3)' });
            });
        return 'done';
    }

    private hop(object: THREE.Object3D, to: THREE.Vector3, done: () => void): void {
        const from = object.position.clone();
        const state = { t: 0 };
        gsap.to(state, {
            t: 1, duration: HOP.seconds, ease: 'none',
            onUpdate: () => {
                object.position.lerpVectors(from, to, state.t);
                object.position.y += Math.sin(state.t * Math.PI) * HOP.height;
            },
            onComplete: done,
        });
    }

    /** The finished cone bounces gently while it waits to be served. */
    public setReadyPulse(on: boolean): void {
        const object = this.cone?.object;
        if (!object) return;
        gsap.killTweensOf(object.scale);
        object.scale.setScalar(CONE.scale);
        if (on) gsap.to(object.scale, { x: CONE.scale * 1.06, y: CONE.scale * 1.1, z: CONE.scale * 1.06, duration: 0.35, yoyo: true, repeat: -1, ease: 'sine.inOut' });
    }

    // ---------------------------------------------------------------- serving, trashing

    /**
     * The cone out on a plate, in an arc to `to` (world): the counter's served spot, or a seated customer's table. `done`
     * gets the plate (its plate model first, the cone after: Kitchen.foodOn finds the cone to eat). `stays`: false (the
     * counter) — it's cleared with clearServed when the customer goes.
     */
    public serveTo(to: THREE.Vector3, done: (plate: THREE.Object3D) => void, stays = true): void {
        const cone = this.cone;
        if (!cone) return;
        this.cone = null;
        gsap.killTweensOf(cone.object.scale);
        const plate = new THREE.Group();
        const dish = kitchenModel('plate');
        dish.scale.setScalar(SERVE.plate);
        plate.add(dish);
        this.scene.add(plate);
        cone.object.getWorldPosition(plate.position);
        // The cone on the plate, at its world size.
        const size = new THREE.Vector3();
        cone.object.getWorldScale(size);
        plate.add(cone.object);
        cone.object.position.set(0, 0.04, 0);
        cone.object.rotation.set(0, 0, 0);
        cone.object.scale.copy(size);
        if (!stays) this.served.push(plate);
        const from = plate.position.clone();
        const state = { t: 0 };
        gsap.to(state, {
            t: 1, duration: SERVE.seconds, delay: 0.1, ease: 'power1.inOut',
            onUpdate: () => {
                plate.position.lerpVectors(from, to, state.t);
                plate.position.y += Math.sin(state.t * Math.PI) * SERVE.height;
            },
            onComplete: () => {
                gsap.fromTo(plate.scale, { x: 1.08, y: 0.9, z: 1.08 }, { x: 1, y: 1, z: 1, duration: 0.22, ease: 'back.out(3)' });
                done(plate);
            },
        });
    }

    /** The counter's served cones gone (the customer took theirs). */
    public clearServed(): void {
        for (const plate of this.served.splice(0)) {
            gsap.to(plate.scale, { x: 0.01, y: 0.01, z: 0.01, duration: 0.22, ease: 'back.in(2)', onComplete: () => { plate.removeFromParent(); } });
        }
    }

    /** The cone tossed: into the trash can (`bin`, if the room has one: an arc up and in) or just gone. */
    public trash(bin: THREE.Object3D | null): void {
        const cone = this.cone;
        if (!cone) return;
        this.cone = null;
        gsap.killTweensOf(cone.object.scale);
        const object = cone.object;
        if (!bin) {
            gsap.to(object.scale, { x: 0.01, y: 0.01, z: 0.01, duration: 0.22, ease: 'back.in(2)', onComplete: () => { object.removeFromParent(); } });
            return;
        }
        bin.updateWorldMatrix(true, true);
        const box = new THREE.Box3().setFromObject(bin);
        this.scene.attach(object);
        const from = object.position.clone();
        const to = new THREE.Vector3((box.min.x + box.max.x) / 2, box.max.y, (box.min.z + box.max.z) / 2);
        const size = object.scale.x;
        const state = { t: 0 };
        gsap.to(state, {
            t: 1, duration: 0.55, ease: 'power1.in',
            onUpdate: () => {
                object.position.lerpVectors(from, to, state.t);
                object.position.y += Math.sin(state.t * Math.PI) * 0.9;
                object.rotation.z = state.t * 4;
                object.scale.setScalar(size * (1 - state.t * 0.6));
            },
            onComplete: () => {
                object.removeFromParent();
            },
        });
    }

    public destroy(): void {
        this.group.traverse((child) => gsap.killTweensOf([child.position, child.scale, child.rotation]));
        for (const handle of this.handles.values()) gsap.killTweensOf(handle.rotation);
        this.served.forEach((plate) => plate.removeFromParent());
        this.group.removeFromParent();
    }
}
