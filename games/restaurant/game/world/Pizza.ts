// Pizza.ts
//
// The pizza station: the oven the layout places (a prop whose model is KayKit's pizza_oven: its door drops open), a
// cutting board on the counter right in front of it (the pizza flies in and out), the dough and a bowl of tomato sauce
// on the board's right, and past them, on the next counter (the layout's PIZZA_BOARD table), the cheese and the toppings
// in a grid two wide running back — each a little pile on a plate, as the burger station's. Making one:
//   1. tap the dough: it's rolled out on the board;
//   2. tap the sauce, the cheese, the order's topping (each hops onto it as its layer: the kit's layers stack as they are);
//   3. tap the pizza (or the oven): the door drops, it slides in, the door shuts, it bakes (settings.json bakeSeconds:
//      the HUD's ring over the oven), the door drops and it slides back out onto the board, baked;
//   4. tap it (or SERVE): out on a plate, as a burger or a cone is.
// TRASH tosses an unbaked or a baked pizza (not while it's in the oven). What the player taps (`targets`) works as the
// ice cream machine's: a spot and a radius, the one nearest the tap on screen.
//
// The oven's things are placed in its model's own space (follows however it's put, turned or sized: OVEN, the kit's
// 3 x 2.07 x 2.35 oven); the board's in world units, from the board prop (its top, its back edge).

import * as THREE from 'three';
import gsap from 'gsap';
import { kitchenModel } from './Models';
import { SETTINGS } from '../data/Settings';
import { PIZZA_LAYERS, PIZZA_LAYER_MODELS, PIZZA_SOURCE_MODELS, PizzaLayer } from '../data/Recipes';
import { SHOT_ASPECT, type CameraShot } from './RestaurantLayout';
import { pizzaLayerModel, scatteredLayer } from './PizzaLook';

/** In the oven model's space: its door (the kit's node name), how far it drops (radians), where a pizza sits inside,
 *  just outside the door, the middle of its front (the ring and the camera aim there). */
const OVEN = { depth: 2.35, door: 'pizza_oven_door', open: 1.45, inside: new THREE.Vector3(-0.25, 0.42, 0.05), mouth: new THREE.Vector3(-0.25, 0.5, 1.5), front: new THREE.Vector3(-0.25, 1.05, 1.0), halfWidth: 1.5 };
/**
 * The pizza's size (x the kit's: its dough base is 1.75 across); the cutting board it's made on (x the model; on a board
 * prop that isn't a cutting board, one's put on it), and its gap from the oven when there's no board prop at all.
 */
const PIZZA = { scale: 0.85, boardScale: 1.3, boardGap: 0.15, frontGap: 0.12, leftShift: 0.35 };
/**
 * The ingredients: each one this big across (its model fitted to it). The dough and the sauce on the board's right
 * (`side` past its edge, at `sideRows` along it); the cheese and the toppings past them in a grid of `columns` (one more
 * past `rows` deep) `gridGap` on, `spacing` apart, its first row `gridFront` from the board's middle, then back `rowGap`.
 */
/**
 * A pile (as the burger station's): its plate this big across; a piece's size and how many (slices, chunks...), or a
 * small whole one's and how many; how far round the middle they lie, how high the top one sits.
 */
const PILE = { plate: 0.6, piece: 0.2, pieces: 5, wholeSize: 0.24, whole: 3, spread: 0.13, stack: 0.07 };
/** The grid's order (the cheese first; what's not in it, after). */
const GRID_ORDER: PizzaLayer[] = ['cheese', 'pepperoni', 'ham', 'fish', 'onion', 'broccoli', 'pineapple', 'mushroom', 'tomato', 'pickles'];
const SOURCES = { size: 0.62, columns: 2, rows: 4, spacing: 0.78, gridGap: 0.85, gridFront: 0.45, dough: 0.46, rowGap: 0.78, side: 0.45, sideRows: [0.3, -0.38] };
/** Timings (s): a hop onto the pizza, the door, the slide in and out. */
const TIME = { hop: 0.3, door: 0.25, slide: 0.45 };
const HOP_HEIGHT = 0.45;
/** A baked pizza's colour (x its layers'): browned. */
const BAKED = new THREE.Color(0.93, 0.8, 0.66);
/** A served pizza's plate (x the plate model), the arc to where it's served. */
const SERVE = { plate: 1.25, seconds: 0.8, height: 1.2 };
/** Tap reach round an ingredient, the pizza, the oven (world units, across the screen). */
const REACH = { source: 0.38, pizza: 0.8, oven: 0.85 };
/**
 * The camera: from the oven's front, the oven, the board and the ingredients all in the shot (`margin` round them),
 * from this high (x its distance) and looking this far over the work top; its field of view.
 */
const SHOT = { fov: 44, margin: 0.7, up: 0.95, aimUp: 0.2 };

export type PizzaTarget = PizzaLayer | 'pizza' | 'oven';
export type PizzaResult = 'done' | 'serve' | 'bake' | 'noDough' | 'has' | 'baking' | 'baked';

interface MadePizza {
    object: THREE.Group;
    layers: PizzaLayer[];
    state: 'raw' | 'toOven' | 'baking' | 'fromOven' | 'baked';
    /** Layers still hopping on (the pizza can't go in till they're on). */
    landing: number;
    time: number;
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

export class PizzaStation {
    /** In step with the oven model (its world transform). */
    private readonly ovenFrame = new THREE.Group();
    /** The board's top middle, in world units, turned as the board is (its back: -z). */
    private readonly board = new THREE.Group();
    private readonly door: THREE.Object3D | null;
    private readonly doorRest: number;
    public readonly targets: { kind: PizzaTarget; at: THREE.Vector3; radius: number }[] = [];
    private readonly sources = new Map<PizzaLayer, THREE.Object3D>();
    private pizza: MadePizza | null = null;
    /** Served pizzas' plates waiting at the counter (cleared when the customer goes). */
    private readonly served: THREE.Object3D[] = [];
    /** A board made here, beside the oven (no board prop): removed with the station. */
    private readonly own: THREE.Object3D[] = [];

    /** `oven`: the oven prop's object in the room; `boardProp`: the prop to make pizzas on, if the room has one. */
    /**
     * `oven`: the oven prop's object in the room; `boardProp`: the prop to make pizzas on, if the room has one; `layers`:
     * what's in the rows behind the board (the dough, sauce, cheese and this stage's toppings: the same station shows more
     * at a bigger stage).
     */
    public constructor(private readonly scene: THREE.Object3D, oven: THREE.Object3D, boardProp: THREE.Object3D | null, layers: readonly PizzaLayer[] = PIZZA_LAYERS) {
        oven.updateWorldMatrix(true, true);
        this.door = oven.getObjectByName(OVEN.door) ?? null;
        this.doorRest = this.door?.rotation.x ?? 0;
        // The model's own space: the door's parent (else the prop itself).
        const frame = this.door?.parent ?? oven;
        frame.matrixWorld.decompose(this.ovenFrame.position, this.ovenFrame.quaternion, this.ovenFrame.scale);
        scene.add(this.ovenFrame, this.board);

        // The board in front of the oven (the pizza flies in and out: it can be right there), a cutting board of our own on
        // the counter there, a little to the oven's left; the dough and the sauce on its right. The cheese and toppings in a
        // grid of two columns (three past eight of them) running back along the right of it, on the next counter.
        // (`boardProp` — the layout's pizzaBoard — only marks that counter now: the board's always at the oven's front.)
        void boardProp;
        oven.updateWorldMatrix(true, true);
        const ovenBox = new THREE.Box3().setFromObject(oven);
        const ovenMiddle = ovenBox.getCenter(new THREE.Vector3());
        const yaw = new THREE.Euler().setFromQuaternion(this.ovenFrame.quaternion, 'YXZ').y;
        const turn = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0));
        const front = new THREE.Vector3(0, 0, 1).applyQuaternion(turn);
        const across = new THREE.Vector3(1, 0, 0).applyQuaternion(turn);
        const made = kitchenModel('cuttingboard');
        made.scale.setScalar(PIZZA.boardScale);
        const madeSize = new THREE.Box3().setFromObject(made).getSize(new THREE.Vector3());
        const thick = madeSize.y;
        const halfWidth = madeSize.x / 2;
        const ovenHalfDepth = (OVEN.depth / 2) * this.ovenFrame.scale.z;
        this.board.quaternion.copy(turn);
        this.board.position.copy(ovenMiddle)
            .addScaledVector(front, ovenHalfDepth + PIZZA.frontGap + madeSize.z / 2)
            .addScaledVector(across, -PIZZA.leftShift);
        this.board.position.y = ovenBox.min.y + thick;
        made.position.y = -thick;
        this.board.add(made);
        const foot = -thick;
        this.board.updateMatrixWorld(true);

        const place = (layer: PizzaLayer, at: THREE.Vector3) => {
            const source = this.sourceModel(layer);
            source.position.copy(at);
            this.board.add(source);
            this.sources.set(layer, source);
            this.addTarget(layer, this.board.localToWorld(source.position.clone().add(new THREE.Vector3(0, 0.3, 0))), REACH.source);
        };
        const side = halfWidth + SOURCES.side;
        if (layers.includes('dough')) place('dough', new THREE.Vector3(side, foot, SOURCES.sideRows[0]));
        if (layers.includes('sauce')) place('sauce', new THREE.Vector3(side, foot, SOURCES.sideRows[1]));
        const rank = (layer: PizzaLayer) => (GRID_ORDER.includes(layer) ? GRID_ORDER.indexOf(layer) : GRID_ORDER.length);
        const grid = layers.filter((layer) => layer !== 'dough' && layer !== 'sauce').sort((a, b) => rank(a) - rank(b));
        const columns = grid.length > SOURCES.columns * SOURCES.rows ? SOURCES.columns + 1 : SOURCES.columns;
        const firstColumn = side + SOURCES.gridGap;
        grid.forEach((layer, i) => {
            const column = i % columns;
            const row = Math.floor(i / columns);
            place(layer, new THREE.Vector3(firstColumn + column * SOURCES.spacing, foot, SOURCES.gridFront - row * SOURCES.rowGap));
        });
        this.addTarget('pizza', this.board.localToWorld(new THREE.Vector3(0, 0.1, 0)), REACH.pizza);
        this.addTarget('oven', this.ovenFrame.localToWorld(OVEN.front.clone()), REACH.oven);
    }

    /**
     * What's tapped for a layer. As the burger station's piles: a little plate with a few of it on (its pieces, where it
     * goes on a pizza as pieces — slices, chunks, florets, little fish; else a few small whole ones), PILE's sizes. The
     * dough: a ball on its own; the sauce: a bowl with sauce in it.
     */
    private sourceModel(layer: PizzaLayer): THREE.Object3D {
        if (layer !== 'dough' && layer !== 'sauce') return this.pileModel(layer);
        const holder = new THREE.Group();
        const model = kitchenModel(PIZZA_SOURCE_MODELS[layer]);
        const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
        const scale = (layer === 'dough' ? SOURCES.dough : SOURCES.size) / Math.max(size.x, size.z, 1e-3);
        model.scale.setScalar(scale);
        holder.add(model);
        if (layer === 'sauce') {
            // The sauce disc, just under the bowl's rim.
            const sauce = kitchenModel(PIZZA_LAYER_MODELS.sauce);
            sauce.scale.setScalar(scale * 0.5);
            sauce.position.y = size.y * scale * 0.55;
            holder.add(sauce);
        }
        return holder;
    }

    /** A plate with a few of `layer` on it, a little heap. */
    private pileModel(layer: PizzaLayer): THREE.Object3D {
        const holder = new THREE.Group();
        const plate = kitchenModel('plate');
        const plateSize = new THREE.Box3().setFromObject(plate).getSize(new THREE.Vector3());
        plate.scale.setScalar(PILE.plate / Math.max(plateSize.x, plateSize.z, 1e-3));
        holder.add(plate);
        const top = plateSize.y * plate.scale.x * 0.6;
        const pieces = scatteredLayer(layer);
        const name = pieces ? PIZZA_LAYER_MODELS[layer] : PIZZA_SOURCE_MODELS[layer];
        const count = pieces ? PILE.pieces : PILE.whole;
        for (let i = 0; i < count; i++) {
            const piece = kitchenModel(name);
            const size = new THREE.Box3().setFromObject(piece).getSize(new THREE.Vector3());
            piece.scale.setScalar((pieces ? PILE.piece : PILE.wholeSize) / Math.max(size.x, size.z, 1e-3));
            // Round the plate's middle, the last one on top of the others.
            const last = i === count - 1 && count > 2;
            const angle = (i / Math.max(1, count - (last ? 1 : 0))) * Math.PI * 2 + 0.5;
            const r = last ? 0 : PILE.spread;
            piece.position.set(Math.cos(angle) * r, top + (last ? PILE.stack : 0), Math.sin(angle) * r);
            piece.rotation.y = angle * 1.7;
            holder.add(piece);
        }
        return holder;
    }

    private addTarget(kind: PizzaTarget, at: THREE.Vector3, radius: number): void {
        this.targets.push({ kind, at, radius });
    }

    /** Where to point at `kind` (world: a hint's hand). */
    public targetPoint(kind: PizzaTarget): THREE.Vector3 {
        return this.targets.find((t) => t.kind === kind)!.at.clone();
    }

    /**
     * The camera: from the oven's front (up high, looking down over the work top), the oven, the board and every
     * ingredient in the shot (a 720 x 1080 screen): fitted to their spread across and in depth.
     */
    public get shot(): CameraShot {
        const front = new THREE.Vector3(0, 0, 1).applyQuaternion(this.ovenFrame.quaternion).setY(0).normalize();
        const side = new THREE.Vector3(front.z, 0, -front.x);
        const oven = this.ovenFrame.localToWorld(OVEN.front.clone());
        const points = [oven, this.board.position.clone(), ...this.targets.map((t) => t.at)];
        const middle = points.reduce((sum, p) => sum.add(p), new THREE.Vector3()).multiplyScalar(1 / points.length);
        const spread = (axis: THREE.Vector3) => {
            const along = points.map((p) => p.clone().sub(middle).dot(axis));
            return Math.max(...along) - Math.min(...along) + SHOT.margin * 2;
        };
        const tan = Math.tan(THREE.MathUtils.degToRad(SHOT.fov / 2));
        // Wide enough for the spread across; tall enough for the depth (seen from above it's mostly on screen's height).
        const distance = Math.max(spread(side) / 2 / (tan * SHOT_ASPECT), spread(front) / 2 / tan);
        const aim = middle.clone();
        aim.y = this.board.position.y + SHOT.aimUp;
        const tilt = Math.atan(SHOT.up);
        const position = aim.clone().addScaledVector(front, distance * Math.cos(tilt)).add(new THREE.Vector3(0, distance * Math.sin(tilt), 0));
        return { position, target: aim, fov: SHOT.fov };
    }

    // ---------------------------------------------------------------- making it

    public get hasPizza(): boolean {
        return Boolean(this.pizza);
    }

    public get layers(): PizzaLayer[] {
        return this.pizza ? [...this.pizza.layers] : [];
    }

    public get baked(): boolean {
        return this.pizza?.state === 'baked';
    }

    /** In the oven (or on its way in or out). */
    public get inOven(): boolean {
        return Boolean(this.pizza && ['toOven', 'baking', 'fromOven'].includes(this.pizza.state));
    }

    /** Done: baked and back on the board. */
    public get ready(): boolean {
        return this.baked;
    }

    /** How far it's baked (0 to 1) while it's in the oven, else null (the HUD's ring). */
    public get bakeProgress(): number | null {
        return this.pizza?.state === 'baking' ? Math.min(1, this.pizza.time / this.bakeSeconds) : null;
    }

    private get bakeSeconds(): number {
        return SETTINGS.bakeSeconds ?? 3;
    }

    /** What the ticket ticks: the layers on it, and 'baked'. */
    public get made(): string[] {
        if (!this.pizza) return [];
        return this.baked ? [...this.pizza.layers, 'baked'] : [...this.pizza.layers];
    }

    /** Over the pizza (world): where the "ready" badge and the hint go. */
    public get dishPoint(): THREE.Vector3 {
        const at = this.pizza ? this.pizza.object.getWorldPosition(new THREE.Vector3()) : this.board.position.clone();
        return at.add(new THREE.Vector3(0, 0.45, 0));
    }

    /** Over the oven's door (world): the baking ring. */
    public get ovenPoint(): THREE.Vector3 {
        return this.ovenFrame.localToWorld(OVEN.front.clone()).add(new THREE.Vector3(0, 0.5, 0));
    }

    /** A tap on `kind`: 'done' / 'bake' if it did something, 'serve' if it's ready to go; otherwise why not. */
    public take(kind: PizzaTarget): PizzaResult {
        const pizza = this.pizza;
        if (kind === 'pizza' || kind === 'oven') {
            if (!pizza) return 'noDough';
            if (pizza.state === 'baked') return 'serve';
            if (pizza.state !== 'raw' || pizza.landing > 0) return 'baking';
            this.bake(pizza);
            return 'bake';
        }
        if (pizza && pizza.state !== 'raw') return pizza.state === 'baked' ? 'baked' : 'baking';
        if (kind === 'dough') {
            if (pizza) return 'has';
            this.pizza = this.newPizza();
            this.addLayer(this.pizza, 'dough');
            return 'done';
        }
        if (!pizza) return 'noDough';
        if (pizza.layers.includes(kind)) return 'has';
        this.addLayer(pizza, kind);
        return 'done';
    }

    private newPizza(): MadePizza {
        const object = new THREE.Group();
        object.scale.setScalar(PIZZA.scale);
        this.board.add(object);
        return { object, layers: [], state: 'raw', landing: 0, time: 0 };
    }

    /** `layer` hops from its ingredient onto the pizza, then its layer pops on (as the kit stacks them). */
    private addLayer(pizza: MadePizza, layer: PizzaLayer): void {
        pizza.layers.push(layer);
        pizza.landing++;
        const source = this.sources.get(layer)!;
        const flyer = this.sourceModel(layer);
        flyer.position.copy(source.position);
        this.board.add(flyer);
        const from = flyer.position.clone();
        const to = new THREE.Vector3(0, 0.1, 0);
        const state = { t: 0 };
        gsap.to(state, {
            t: 1, duration: TIME.hop, ease: 'none',
            onUpdate: () => {
                flyer.position.lerpVectors(from, to, state.t);
                flyer.position.y += Math.sin(state.t * Math.PI) * HOP_HEIGHT;
            },
            onComplete: () => {
                flyer.removeFromParent();
                pizza.landing--;
                if (this.pizza !== pizza) return;
                const model = pizzaLayerModel(layer);
                pizza.object.add(model);
                gsap.fromTo(model.scale, { x: 0.2, y: 0.2, z: 0.2 }, { x: 1, y: 1, z: 1, duration: 0.3, ease: 'back.out(2.5)' });
            },
        });
    }

    /** Into the oven: the door drops, it slides in, the door shuts; baked, out again. */
    private bake(pizza: MadePizza): void {
        pizza.state = 'toOven';
        const object = pizza.object;
        this.scene.attach(object);
        const mouth = this.ovenFrame.localToWorld(OVEN.mouth.clone());
        const inside = this.ovenFrame.localToWorld(OVEN.inside.clone());
        const timeline = gsap.timeline();
        this.swingDoor(timeline, true);
        timeline
            .to(object.position, { x: mouth.x, y: mouth.y, z: mouth.z, duration: TIME.slide, ease: 'power2.inOut' })
            .to(object.position, { x: inside.x, y: inside.y, z: inside.z, duration: TIME.slide * 0.7, ease: 'power1.out' });
        this.swingDoor(timeline, false);
        timeline.add(() => {
            if (this.pizza !== pizza) return;
            pizza.state = 'baking';
            pizza.time = 0;
        });
    }

    private swingDoor(timeline: gsap.core.Timeline, open: boolean): void {
        if (!this.door) return;
        timeline.to(this.door.rotation, { x: this.doorRest + (open ? OVEN.open : 0), duration: TIME.door, ease: open ? 'power2.out' : 'back.out(2)' });
    }

    /** Baked: browned, the door drops, out onto the board again. */
    private unload(pizza: MadePizza): void {
        pizza.state = 'fromOven';
        this.brown(pizza.object);
        const object = pizza.object;
        const mouth = this.ovenFrame.localToWorld(OVEN.mouth.clone());
        const timeline = gsap.timeline();
        this.swingDoor(timeline, true);
        timeline.to(object.position, { x: mouth.x, y: mouth.y, z: mouth.z, duration: TIME.slide * 0.7, ease: 'power1.in' });
        timeline.add(() => {
            if (this.pizza === pizza) this.board.attach(object);
        });
        timeline.to(object.position, { x: 0, y: 0, z: 0, duration: TIME.slide, ease: 'power2.inOut' });
        this.swingDoor(timeline, false);
        timeline.add(() => {
            if (this.pizza !== pizza) return;
            pizza.state = 'baked';
            gsap.fromTo(object.scale, { x: PIZZA.scale * 1.12, y: PIZZA.scale * 0.85, z: PIZZA.scale * 1.12 }, { x: PIZZA.scale, y: PIZZA.scale, z: PIZZA.scale, duration: 0.3, ease: 'back.out(3)' });
        });
    }

    /** A baked look: every layer's colour browned (its own copy of the material). */
    private brown(object: THREE.Object3D): void {
        object.traverse((child) => {
            const mesh = child as THREE.Mesh;
            if (!mesh.isMesh) return;
            const materials = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map((m) => {
                const copy = m.clone() as THREE.MeshStandardMaterial;
                copy.color?.multiply(BAKED);
                return copy;
            });
            mesh.material = Array.isArray(mesh.material) ? materials : materials[0];
        });
    }

    public update(dt: number): void {
        const pizza = this.pizza;
        if (pizza?.state !== 'baking') return;
        pizza.time += dt;
        if (pizza.time >= this.bakeSeconds) this.unload(pizza);
    }

    /** The finished pizza bounces gently while it waits to be served. */
    public setReadyPulse(on: boolean): void {
        const object = this.pizza?.object;
        if (!object) return;
        gsap.killTweensOf(object.scale);
        object.scale.setScalar(PIZZA.scale);
        if (on) gsap.to(object.scale, { x: PIZZA.scale * 1.05, y: PIZZA.scale * 1.15, z: PIZZA.scale * 1.05, duration: 0.35, yoyo: true, repeat: -1, ease: 'sine.inOut' });
    }

    // ---------------------------------------------------------------- serving, trashing

    /**
     * The pizza out on a plate, in an arc to `to` (world): the counter's served spot, or a seated customer's table. `done`
     * gets the plate (its plate model first, the pizza after: Kitchen.foodOn finds the pizza to eat). `stays`: false (the
     * counter) — it's cleared with clearServed when the customer goes.
     */
    public serveTo(to: THREE.Vector3, done: (plate: THREE.Object3D) => void, stays = true): void {
        const pizza = this.pizza;
        if (!pizza) return;
        this.pizza = null;
        gsap.killTweensOf(pizza.object.scale);
        const plate = new THREE.Group();
        const dish = kitchenModel('plate');
        dish.scale.setScalar(SERVE.plate);
        plate.add(dish);
        this.scene.add(plate);
        pizza.object.getWorldPosition(plate.position);
        plate.add(pizza.object);
        pizza.object.position.set(0, 0.04, 0);
        pizza.object.rotation.set(0, 0, 0);
        pizza.object.scale.setScalar(PIZZA.scale);
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

    /** The counter's served pizzas gone (the customer took theirs). */
    public clearServed(): void {
        for (const plate of this.served.splice(0)) {
            gsap.to(plate.scale, { x: 0.01, y: 0.01, z: 0.01, duration: 0.22, ease: 'back.in(2)', onComplete: () => { plate.removeFromParent(); } });
        }
    }

    /**
     * The pizza tossed (not while it's in the oven): into the trash can (`bin`, if the room has one: an arc up and in) or
     * just gone. Whether it was.
     */
    public trash(bin: THREE.Object3D | null): boolean {
        const pizza = this.pizza;
        if (!pizza || this.inOven) return false;
        this.pizza = null;
        gsap.killTweensOf(pizza.object.scale);
        const object = pizza.object;
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

    /** Ends whatever's going (the day's over, or a debug skip): the pizza gone at once, the door shut. */
    public reset(): void {
        const pizza = this.pizza;
        this.pizza = null;
        if (pizza) {
            gsap.killTweensOf([pizza.object.position, pizza.object.scale]);
            pizza.object.removeFromParent();
        }
        if (this.door) {
            gsap.killTweensOf(this.door.rotation);
            this.door.rotation.x = this.doorRest;
        }
    }

    public destroy(): void {
        this.reset();
        this.board.traverse((child) => gsap.killTweensOf([child.position, child.scale, child.rotation]));
        this.served.forEach((plate) => plate.removeFromParent());
        this.own.forEach((object) => object.removeFromParent());
        this.ovenFrame.removeFromParent();
        this.board.removeFromParent();
    }
}
