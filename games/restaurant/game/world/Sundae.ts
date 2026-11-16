// Sundae.ts
//
// The sundae bar: scooped ice cream, in a cone or a bowl (the soft-serve machine's cones are world/IceCream.ts). Two props
// in the layout make it:
//   - the freezer (id SUNDAE_FREEZER: any model as big as the freezer — the editor shows a freezer there too): the game
//     hides it and builds a freezer in its place — a box at counter height, its top open, six tubs of ice cream set in
//     it (two rows of three: vanilla, chocolate, strawberry; mint, blueberry, mango);
//   - the bar (id SUNDAE_BAR: a kitchen table, say): at the front the stack of cones, the stack of bowls and the spot
//     the sundae's made on; behind, the sauces (chocolate, caramel, strawberry: bowls of them) and the toppings
//     (sprinkles, cherries, cookie sticks, waffles: bowls of them), in rows.
// Making one: tap the cones or the bowls (one hops onto the spot), tap a tub for each scoop (up to MAX_SCOOPS), a sauce
// (one), the toppings (each once), then the sundae (or SERVE). TRASH starts it again. Taps work as the other stations':
// a spot and a radius, the nearest on screen. It looks as world/SundaeLook.ts builds it (rebuilt as it grows).

import * as THREE from 'three';
import gsap from 'gsap';
import { kitchenModel } from './Models';
import { SCOOP_FLAVORS, SUNDAE_SAUCES, SUNDAE_TOPPINGS, ScoopFlavor, Sundae, SundaeBase, SundaeSauce, SundaeTopping } from '../data/Recipes';
import { SHOT_ASPECT, type CameraShot } from './RestaurantLayout';
import { sauceBowlModel, scoopModel, sundaeModel, toppingSourceModel, tubModel } from './SundaeLook';

/** At most this many scoops. */
export const MAX_SCOOPS = 3;
/** The freezer: its body's height (to the rim), the rim's width and its colours; the well's colour; tub size (x the kit's). */
/**
 * The freezer: sized round its tubs (not its stand-in prop: that's only where it stands) — each tub `tub` x the kit's
 * (1 x 1.6), turned its long side across, `gap` apart, `pad` from the rim; its body's height, the rim, the colours.
 */
const FREEZER = { height: 0.92, rim: 0.12, rimHeight: 0.1, body: '#eaf6fb', trim: '#7bbfdc', well: '#2e3f4a', tub: 0.5, gap: 0.06, pad: 0.04 };
/** The sundae on the bar (x the kit's); the bar's things: each this big across; the rows' depth (x the bar's). */
/** The sundae's size (x the kit's) — the stacks of cones and bowls on the bar are this size too. */
const SUNDAE = { scale: 0.55 };
const BAR = { size: 0.42, frontRow: 0.24, backRows: [-0.08, -0.33], columns: 4 };
const HOP = { seconds: 0.3, height: 0.45 };
/** A served sundae's plate (x the plate model), the arc to where it's served. */
const SERVE = { plate: 0.8, seconds: 0.8, height: 1.2 };
const REACH = { tub: 0.42, source: 0.3, sundae: 0.5 };
/** The camera: from the bar's front, the freezer and the bar in the shot (`margin` round them), from this steep. */
const SHOT = { fov: 44, margin: 0.6, up: 1.05, aimUp: 0.25 };

export type SundaeTarget =
    | { kind: 'base'; base: SundaeBase }
    | { kind: 'tub'; flavor: ScoopFlavor }
    | { kind: 'sauce'; sauce: SundaeSauce }
    | { kind: 'topping'; topping: SundaeTopping }
    | { kind: 'sundae' };
export type SundaeResult = 'done' | 'serve' | 'noBase' | 'hasBase' | 'full' | 'noScoop' | 'has' | 'busy';

interface Making {
    base: SundaeBase;
    scoops: ScoopFlavor[];
    sauce: SundaeSauce | null;
    toppings: SundaeTopping[];
    object: THREE.Group;
    /** Things still hopping on. */
    landing: number;
}

/** `object`'s bounds in the frame `frame` (a world matrix): its own size whichever way it's turned. */
function boxIn(frame: THREE.Matrix4, object: THREE.Object3D): THREE.Box3 {
    object.updateWorldMatrix(true, true);
    const inverse = frame.clone().invert();
    const box = new THREE.Box3();
    object.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh || !mesh.geometry) return;
        mesh.geometry.computeBoundingBox();
        box.union(mesh.geometry.boundingBox!.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, mesh.matrixWorld)));
    });
    return box;
}

/** A prop's frame: on the floor under its middle, turned as it is; its size (x across, y up, z deep). */
function propFrame(prop: THREE.Object3D): { position: THREE.Vector3; turn: THREE.Quaternion; size: THREE.Vector3; top: number } {
    prop.updateWorldMatrix(true, true);
    const turn = new THREE.Quaternion();
    prop.matrixWorld.decompose(new THREE.Vector3(), turn, new THREE.Vector3());
    const at = new THREE.Vector3().setFromMatrixPosition(prop.matrixWorld);
    const frame = new THREE.Matrix4().compose(at, turn, new THREE.Vector3(1, 1, 1));
    const box = boxIn(frame, prop);
    const middle = box.getCenter(new THREE.Vector3());
    return { position: new THREE.Vector3(middle.x, box.min.y, middle.z).applyMatrix4(frame), turn, size: box.getSize(new THREE.Vector3()), top: box.max.y - box.min.y };
}

/** A copy of `object` sized `size` across (its widest), its bottom at 0. */
function fitted(object: THREE.Object3D, size: number): THREE.Object3D {
    const box = new THREE.Box3().setFromObject(object);
    const extent = box.getSize(new THREE.Vector3());
    object.scale.multiplyScalar(size / Math.max(extent.x, extent.z, 1e-3));
    return object;
}

export class SundaeStation {
    /** The freezer's frame (floor, under its middle, its front +z) and the bar's (its top's middle). */
    private readonly freezer = new THREE.Group();
    private readonly bar = new THREE.Group();
    public readonly targets: { target: SundaeTarget; at: THREE.Vector3; radius: number }[] = [];
    private making: Making | null = null;
    private readonly served: THREE.Object3D[] = [];
    private readonly owned: THREE.Object3D[] = [];
    private readonly build: THREE.Vector3;

    /**
     * `stock`: this stage's flavours (the freezer's tubs), sauces and toppings (the bar's rows) — the same station shows
     * more at a bigger stage, laid out in its grids.
     */
    public constructor(
        private readonly scene: THREE.Object3D, freezerProp: THREE.Object3D, barProp: THREE.Object3D,
        private readonly stock: { flavors: readonly ScoopFlavor[]; sauces: readonly SundaeSauce[]; toppings: readonly SundaeTopping[] } = { flavors: SCOOP_FLAVORS, sauces: SUNDAE_SAUCES, toppings: SUNDAE_TOPPINGS },
    ) {
        // The freezer, where its stand-in prop is (that's hidden).
        const fz = propFrame(freezerProp);
        freezerProp.visible = false;
        this.freezer.position.copy(fz.position);
        this.freezer.quaternion.copy(fz.turn);
        scene.add(this.freezer);
        this.buildFreezer();

        // The bar: its top's middle.
        const bz = propFrame(barProp);
        this.bar.position.copy(bz.position).add(new THREE.Vector3(0, bz.top, 0));
        this.bar.quaternion.copy(bz.turn);
        scene.add(this.bar);
        this.bar.updateMatrixWorld(true);
        const width = bz.size.x;
        const depth = bz.size.z;
        // Front row: the cones, the bowls, then the spot the sundae's made on.
        const front = depth * BAR.frontRow;
        // The stacks of cones and bowls at the sundae's own size: the one that hops onto the spot is the size it was.
        const cones = kitchenModel('icecream_cone_stacked');
        cones.scale.setScalar(SUNDAE.scale);
        this.addSource(cones, new THREE.Vector3(-width * 0.36, 0, front), { kind: 'base', base: 'cone' });
        const bowls = new THREE.Group();
        for (let k = 0; k < 3; k++) {
            const bowl = kitchenModel('icecream_bowl');
            bowl.position.y = k * 0.09;
            bowls.add(bowl);
        }
        bowls.scale.setScalar(SUNDAE.scale);
        this.addSource(bowls, new THREE.Vector3(-width * 0.12, 0, front), { kind: 'base', base: 'bowl' });
        this.build = new THREE.Vector3(width * 0.2, 0, front);
        this.targets.push({ target: { kind: 'sundae' }, at: this.bar.localToWorld(this.build.clone().add(new THREE.Vector3(0, 0.45, 0))), radius: REACH.sundae });
        // Behind: the sauces, then the toppings, in rows.
        const back: { model: THREE.Object3D; target: SundaeTarget }[] = [
            ...this.stock.sauces.map((sauce) => ({ model: sauceBowlModel(sauce), target: { kind: 'sauce', sauce } as SundaeTarget })),
            ...this.stock.toppings.map((topping) => ({ model: toppingSourceModel(topping), target: { kind: 'topping', topping } as SundaeTarget })),
        ];
        const columns = Math.max(BAR.columns, Math.ceil(back.length / BAR.backRows.length));
        back.forEach(({ model, target }, i) => {
            const row = Math.floor(i / columns);
            const inRow = Math.min(columns, back.length - row * columns);
            const column = i % columns;
            const x = (column - (inRow - 1) / 2) * (width * 0.9 / columns);
            this.addSource(fitted(model, BAR.size), new THREE.Vector3(x, 0, depth * BAR.backRows[Math.min(row, BAR.backRows.length - 1)]), target);
        });
    }

    /** The freezer box, just big enough for the stage's tubs (three across): its body, a rim round its open top, the dark well, the tubs. */
    private buildFreezer(): void {
        const flavors = this.stock.flavors;
        const columns = Math.min(3, Math.max(1, flavors.length));
        const rows = Math.max(1, Math.ceil(flavors.length / columns));
        // A tub turned its long side across: 1.6 x 1 (the kit's), at FREEZER.tub.
        const tubW = 1.6 * FREEZER.tub;
        const tubD = 1.0 * FREEZER.tub;
        const inset = FREEZER.rim + FREEZER.pad;
        const width = columns * tubW + (columns - 1) * FREEZER.gap + inset * 2;
        const depth = rows * tubD + (rows - 1) * FREEZER.gap + inset * 2;
        const material = (color: string) => new THREE.MeshStandardMaterial({ color, roughness: 0.6 });
        const box = (w: number, h: number, d: number, x: number, y: number, z: number, color: string) => {
            const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material(color));
            mesh.position.set(x, y, z);
            mesh.castShadow = mesh.receiveShadow = true;
            this.freezer.add(mesh);
            this.owned.push(mesh);
        };
        const h = FREEZER.height;
        const r = FREEZER.rim;
        box(width, h, depth, 0, h / 2, 0, FREEZER.body);
        // A coloured band round its middle.
        box(width + 0.01, 0.12, depth + 0.01, 0, h * 0.62, 0, FREEZER.trim);
        // The well (dark), and the rim round it.
        box(width - r * 2, 0.02, depth - r * 2, 0, h + 0.005, 0, FREEZER.well);
        const top = h + FREEZER.rimHeight / 2;
        box(width, FREEZER.rimHeight, r, 0, top, depth / 2 - r / 2, FREEZER.trim);
        box(width, FREEZER.rimHeight, r, 0, top, -depth / 2 + r / 2, FREEZER.trim);
        box(r, FREEZER.rimHeight, depth - r * 2, width / 2 - r / 2, top, 0, FREEZER.trim);
        box(r, FREEZER.rimHeight, depth - r * 2, -width / 2 + r / 2, top, 0, FREEZER.trim);
        // The tubs: the stage's flavours, three across and as many rows as they need, close together.
        const stepW = tubW + FREEZER.gap;
        const stepD = tubD + FREEZER.gap;
        flavors.forEach((flavor, i) => {
            const column = i % columns;
            const row = Math.floor(i / columns);
            const tub = tubModel(flavor);
            tub.scale.setScalar(FREEZER.tub);
            tub.rotation.y = Math.PI / 2;
            tub.position.set((column - (columns - 1) / 2) * stepW, h, (row - (rows - 1) / 2) * stepD);
            this.freezer.add(tub);
            this.freezer.updateMatrixWorld(true);
            this.targets.push({ target: { kind: 'tub', flavor }, at: this.freezer.localToWorld(tub.position.clone().add(new THREE.Vector3(0, 0.3, 0))), radius: REACH.tub });
        });
    }

    private addSource(model: THREE.Object3D, at: THREE.Vector3, target: SundaeTarget): void {
        model.position.copy(at);
        this.bar.add(model);
        this.targets.push({ target, at: this.bar.localToWorld(at.clone().add(new THREE.Vector3(0, 0.28, 0))), radius: REACH.source });
    }

    /** Where to point at `target` (world: the hint's hand). */
    public targetPoint(target: SundaeTarget): THREE.Vector3 {
        const same = (t: SundaeTarget) => JSON.stringify(t) === JSON.stringify(target);
        return (this.targets.find((t) => same(t.target))?.at ?? this.bar.position).clone();
    }

    /** The camera: from the bar's front, high, the freezer's tubs and everything on the bar in the shot. */
    public get shot(): CameraShot {
        const front = new THREE.Vector3(0, 0, 1).applyQuaternion(this.bar.quaternion).setY(0).normalize();
        const side = new THREE.Vector3(front.z, 0, -front.x);
        const points = this.targets.map((t) => t.at);
        const middle = points.reduce((sum, p) => sum.add(p), new THREE.Vector3()).multiplyScalar(1 / points.length);
        const spread = (axis: THREE.Vector3) => {
            const along = points.map((p) => p.clone().sub(middle).dot(axis));
            return Math.max(...along) - Math.min(...along) + SHOT.margin * 2;
        };
        const tan = Math.tan(THREE.MathUtils.degToRad(SHOT.fov / 2));
        const distance = Math.max(spread(side) / 2 / (tan * SHOT_ASPECT), spread(front) / 2 / tan);
        const aim = middle.clone();
        aim.y = this.bar.position.y + SHOT.aimUp;
        const tilt = Math.atan(SHOT.up);
        const position = aim.clone().addScaledVector(front, distance * Math.cos(tilt)).add(new THREE.Vector3(0, distance * Math.sin(tilt), 0));
        return { position, target: aim, fov: SHOT.fov };
    }

    // ---------------------------------------------------------------- making it

    public get hasSundae(): boolean {
        return Boolean(this.making);
    }

    /** The sundae so far (null: nothing on the bar yet). */
    public get made(): Sundae | null {
        const m = this.making;
        return m ? { base: m.base, scoops: [...m.scoops], sauce: m.sauce, toppings: [...m.toppings] } : null;
    }

    /** Done (for `order`): as many scoops, a sauce if it has one, as many toppings — and nothing still hopping on. */
    public complete(order: Sundae): boolean {
        const m = this.making;
        return Boolean(m && !m.landing && m.scoops.length >= order.scoops.length && (!order.sauce || m.sauce) && m.toppings.length >= order.toppings.length);
    }

    /** What the ticket ticks for `order`: its base, each of its scoops made (flavour by flavour), its sauce, its toppings. */
    public ticks(order: Sundae): string[] {
        const m = this.making;
        if (!m) return [];
        const keys: string[] = [];
        if (m.base === order.base) keys.push('base');
        const left = [...m.scoops];
        order.scoops.forEach((flavor, i) => {
            const k = left.indexOf(flavor);
            if (k >= 0) {
                left.splice(k, 1);
                keys.push(`scoop${i}`);
            }
        });
        if (order.sauce && m.sauce === order.sauce) keys.push('sauce');
        for (const topping of order.toppings) if (m.toppings.includes(topping)) keys.push(`topping:${topping}`);
        return keys;
    }

    /** Over the sundae (world): where the "ready" badge and the hint go. */
    public get dishPoint(): THREE.Vector3 {
        return this.bar.localToWorld(this.build.clone().add(new THREE.Vector3(0, 0.65, 0)));
    }

    /** A tap on `target`: 'done' if it did something, 'serve' (the sundae, once it has a scoop); otherwise why not. */
    public take(target: SundaeTarget): SundaeResult {
        const m = this.making;
        if (target.kind === 'sundae') return !m ? 'noBase' : m.landing ? 'busy' : m.scoops.length ? 'serve' : 'noScoop';
        if (target.kind === 'base') {
            if (m) return 'hasBase';
            this.making = { base: target.base, scoops: [], sauce: null, toppings: [], object: new THREE.Group(), landing: 0 };
            this.making.object.position.copy(this.build);
            this.making.object.scale.setScalar(SUNDAE.scale);
            this.bar.add(this.making.object);
            this.hopOn(this.making, this.sourceAt(target), () => undefined);
            return 'done';
        }
        if (!m) return 'noBase';
        if (target.kind === 'tub') {
            if (m.scoops.length >= MAX_SCOOPS) return 'full';
            m.scoops.push(target.flavor);
            this.hopOn(m, this.sourceAt(target), () => undefined, scoopModel(target.flavor));
            return 'done';
        }
        if (!m.scoops.length) return 'noScoop';
        if (target.kind === 'sauce') {
            if (m.sauce) return 'has';
            m.sauce = target.sauce;
        } else {
            if (m.toppings.includes(target.topping)) return 'has';
            m.toppings.push(target.topping);
        }
        this.hopOn(m, this.sourceAt(target), () => undefined);
        return 'done';
    }

    /** Where a target's thing is (world). */
    private sourceAt(target: SundaeTarget): THREE.Vector3 {
        return this.targetPoint(target).add(new THREE.Vector3(0, -0.2, 0));
    }

    /** Something hops from `from` (world) onto the sundae (a scoop: the scoop itself; else a little dot of it), then it's rebuilt. */
    private hopOn(m: Making, from: THREE.Vector3, done: () => void, flyer: THREE.Object3D | null = null): void {
        m.landing++;
        const object = flyer ?? new THREE.Group();
        if (flyer) {
            this.scene.add(object);
            object.position.copy(from);
            object.scale.setScalar(SUNDAE.scale);
        }
        const to = this.bar.localToWorld(this.build.clone().add(new THREE.Vector3(0, 0.55, 0)));
        const start = from.clone();
        const state = { t: 0 };
        gsap.to(state, {
            t: 1, duration: HOP.seconds, ease: 'none',
            onUpdate: () => {
                object.position.lerpVectors(start, to, state.t);
                object.position.y += Math.sin(state.t * Math.PI) * HOP.height;
            },
            onComplete: () => {
                object.removeFromParent();
                m.landing--;
                if (this.making !== m) return;
                this.rebuild(m);
                gsap.fromTo(m.object.scale, { x: SUNDAE.scale * 1.12, y: SUNDAE.scale * 0.9, z: SUNDAE.scale * 1.12 }, { x: SUNDAE.scale, y: SUNDAE.scale, z: SUNDAE.scale, duration: 0.25, ease: 'back.out(3)' });
                done();
            },
        });
    }

    /** The sundae drawn again as it is now (only what's landed: a thing still hopping isn't on it yet). */
    private rebuild(m: Making): void {
        m.object.clear();
        m.object.add(sundaeModel(m));
    }

    /** The finished sundae bounces gently while it waits to be served. */
    public setReadyPulse(on: boolean): void {
        const object = this.making?.object;
        if (!object) return;
        gsap.killTweensOf(object.scale);
        object.scale.setScalar(SUNDAE.scale);
        if (on) gsap.to(object.scale, { x: SUNDAE.scale * 1.05, y: SUNDAE.scale * 1.1, z: SUNDAE.scale * 1.05, duration: 0.35, yoyo: true, repeat: -1, ease: 'sine.inOut' });
    }

    // ---------------------------------------------------------------- serving, trashing

    /**
     * The sundae out on a plate, in an arc to `to` (world): the counter, or a seated customer's table. `done` gets the
     * plate (its plate model first, the sundae after: Kitchen.foodOn finds the sundae to eat). `stays` false: cleared
     * with clearServed when the customer goes.
     */
    public serveTo(to: THREE.Vector3, done: (plate: THREE.Object3D) => void, stays = true): void {
        const m = this.making;
        if (!m) return;
        this.making = null;
        gsap.killTweensOf(m.object.scale);
        const plate = new THREE.Group();
        const dish = kitchenModel('plate');
        dish.scale.setScalar(SERVE.plate);
        plate.add(dish);
        this.scene.add(plate);
        m.object.getWorldPosition(plate.position);
        plate.add(m.object);
        m.object.position.set(0, 0.04, 0);
        m.object.quaternion.copy(this.bar.quaternion);
        m.object.scale.setScalar(SUNDAE.scale);
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

    public clearServed(): void {
        for (const plate of this.served.splice(0)) {
            gsap.to(plate.scale, { x: 0.01, y: 0.01, z: 0.01, duration: 0.22, ease: 'back.in(2)', onComplete: () => { plate.removeFromParent(); } });
        }
    }

    /** The sundae tossed: into the trash can (`bin`, if the room has one) or just gone. Whether there was one. */
    public trash(bin: THREE.Object3D | null): boolean {
        const m = this.making;
        if (!m) return false;
        this.making = null;
        gsap.killTweensOf(m.object.scale);
        const object = m.object;
        if (!bin) {
            gsap.to(object.scale, { x: 0.01, y: 0.01, z: 0.01, duration: 0.22, ease: 'back.in(2)', onComplete: () => { object.removeFromParent(); } });
            return true;
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
        return true;
    }

    /** Whatever's being made, gone at once (the day's over, a debug skip). */
    public reset(): void {
        const m = this.making;
        this.making = null;
        if (m) {
            gsap.killTweensOf(m.object.scale);
            m.object.removeFromParent();
        }
    }

    public destroy(): void {
        this.reset();
        this.served.forEach((plate) => plate.removeFromParent());
        for (const object of this.owned) {
            const mesh = object as THREE.Mesh;
            mesh.geometry?.dispose();
            (mesh.material as THREE.Material | undefined)?.dispose();
        }
        this.freezer.removeFromParent();
        this.bar.removeFromParent();
    }
}
