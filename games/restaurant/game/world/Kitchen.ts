// Kitchen.ts
//
// The burger station (KayKit Restaurant Bits): the cook's two benches, seen from the cook's side (the room round them —
// floor, walls, doors, tables — is the layout's: levels/restaurant.json, built by core/rooms):
//   - the front bench (the customer's side): the stove with its frying pan, and the serving counter — the plate alone on
//     it (served, it slides straight across to the customer: nothing in its way), a couple of sauces in a corner;
//   - the back bench (nearer the camera: the bottom of the screen): every ingredient, in two rows — bottom buns, top
//     buns and raw patties (by the stove), then cheese, lettuce, tomato.
// The camera looks from the cook's side (+z away from it), so world +x is the screen's left: the plate's counter is on
// the left, the stove on the right.
//
// What happens on the benches: a raw patty hops into the pan and cooks (swapped for the cooked one when it's done);
// the cooked patty hops onto the plate; buns and toppings hop on in the order they're tapped; TRASH clears the plate;
// serving slides the plate across to the customer. The piles never run out (the supermarket run stocks the kitchen for
// the day). What the player taps (`targets`: each pile, the pan, the plate) is a spot and a radius: a tap goes to the
// one whose middle is nearest on screen (no tall hit boxes overlapping the pile behind them at the camera's angle).
//
// World: y up, the customers' side is +z, the cook (and the camera) is on -z. LAYOUT is where everything goes — the one
// place to move things (and what an editor would edit).

import * as THREE from 'three';
import gsap from 'gsap';
import { kitchenModel, sizeOf } from './Models';
import { PART_MODELS, Part, Piece } from '../data/Recipes';
import { SETTINGS } from '../data/Settings';
import type { PieceRole, StationLayout, StationPiece } from './RestaurantLayout';

/** A pile (a piece to put on the plate, or the raw patties for the pan), the pan, or the plate (a finished dish on it:
 *  tapped, it's served). */
export type TargetKind = Piece | 'pan' | 'plate';

/** Sizes at the station (KayKit's food is huge next to its furniture: a bun's 0.7 across, a counter 1 high): the food,
 *  the pan, the serving plate, the piles' plates; how far round a pile / the pan / the plate a tap still counts (world
 *  units, measured across the screen). Where things are is the station's (levels/restaurant.json). */
export const LAYOUT = {
    food: 0.5,
    pan: 0.75,
    dish: 0.72,
    pileDish: 0.6,
    tapRadius: { pile: 0.5, pan: 0.65, plate: 0.55 },
};

/** The models the kitchen uses (Models.loadModels before building it). */
export const KITCHEN_MODELS = [
    ...Object.values(PART_MODELS), 'food_burger', 'plate', 'pan_A', 'stove_single_countertop', 'kitchencounter_straight_A',
    'kitchencounter_straight_B',
];

/** What each pile shows (a raw patty pile, though it puts a cooked one on the plate). */
const PILE_PART: Record<Piece, Part> = { patty: 'rawPatty', bunBottom: 'bunBottom', bunTop: 'bunTop', cheese: 'cheese', lettuce: 'lettuce', tomato: 'tomato', pickles: 'pickles', onion: 'onion' };
/** How far the countertop stove's model sits into the counter under it (its bottom's 0.93 up: the counter's 1). */
const STOVE_SINK = 0.07;
/** The most pieces a pile shows. */
const PILE = 3;
/** How high a hop goes over its arc (units), how long it takes (s). */
const HOP = { height: 0.45, seconds: 0.3 };
/** Food thrown in the trash: how high it arcs, how far over the can it drops from, how long each takes, the gap between them, its spin. */
const TOSS = { height: 0.9, dropFrom: 0.35, seconds: 0.55, stagger: 0.09, spin: 5 };
/** A plate served to a seat: how long it takes to get there, how high it arcs. */
const SERVE_TO = { seconds: 0.8, height: 1.2 };
/** The most a plate holds. */
const MAX_STACK = 8;

interface Pile {
    piece: Piece;
    group: THREE.Group;
    /** Where its pieces start stacking (on its little plate). */
    base: number;
}

export class Kitchen {
    public readonly group = new THREE.Group();
    /** What can be tapped: its middle (world) and how far round it a tap counts. */
    public readonly targets: { kind: TargetKind; at: THREE.Vector3; radius: number }[] = [];
    /** The bench's top (the counter's height). */
    public benchTop = 0;
    /** The plate's place, and where a served one slides to (the station's pieces). */
    private platePiece!: StationPiece;
    private servedPiece!: StationPiece;
    private panFloor = 1.25;
    private pan!: THREE.Group;
    private readonly piles = new Map<Piece, Pile>();
    /** The plate being made, its pieces (bottom up) and the height they reach. */
    private plate!: THREE.Group;
    private stack: { part: Part; object: THREE.Object3D }[] = [];
    private stackTop = 0;
    /** The stack's base on an empty plate (its rim). */
    private plateBase = 0;
    /** The patty in the pan (raw till it's cooked), and how far along (s). */
    private inPan: { object: THREE.Object3D; cooked: boolean; time: number; arriving: boolean } | null = null;
    /** Called when a patty's done. */
    public onCooked: (() => void) | null = null;

    /** `station`: the burger station's layout (levels/restaurant.json). */
    public constructor(parent: THREE.Object3D, private readonly station: StationLayout) {
        this.group.position.set(station.x, 0, station.z);
        parent.add(this.group);
        this.buildBenches();
    }

    /** Where a served dish goes on the counter (world, on the bench top). */
    public get servedPoint(): THREE.Vector3 {
        return new THREE.Vector3(this.servedPiece.x, this.benchTop, this.servedPiece.z).add(this.group.position);
    }

    /** Where the customer stands to order (world). */
    public get customerSpot(): THREE.Vector3 {
        const spot = this.station.pieces.find((p) => p.role === 'customer') ?? { x: 0, z: 2 };
        return new THREE.Vector3(spot.x, 0, spot.z).add(this.group.position);
    }

    // ---------------------------------------------------------------- building

    private buildBenches(): void {
        const pieces = this.station.pieces;
        const at = (piece: StationPiece, y = 0) => new THREE.Vector3(piece.x, y, piece.z);
        const one = (role: PieceRole) => pieces.find((p) => p.role === role);
        // The counters (their fronts as the layout turns them); the bench top is the tallest one's.
        for (const piece of pieces.filter((p) => p.role === 'counter' && p.model)) {
            const counter = kitchenModel(piece.model!);
            counter.position.copy(at(piece));
            counter.rotation.y = piece.rotationY ?? 0;
            this.group.add(counter);
            this.benchTop = Math.max(this.benchTop, sizeOf(counter).y);
        }
        // The cooktop, set into the counter under it (a counter's height, as a real kitchen's).
        const stovePiece = one('stove');
        let stoveTop = this.benchTop;
        if (stovePiece?.model) {
            const stove = kitchenModel(stovePiece.model);
            // (Its model sits a little into the counter it's made for.)
            stove.position.copy(at(stovePiece, this.benchTop - STOVE_SINK));
            stove.rotation.y = stovePiece.rotationY ?? 0;
            this.group.add(stove);
            stoveTop = this.benchTop - STOVE_SINK + sizeOf(stove).y;
        }

        // The pan on the stove, its handle to the cook.
        const panPiece = one('pan') ?? stovePiece ?? { role: 'pan', x: 0, z: 0 };
        this.pan = kitchenModel('pan_A');
        this.pan.scale.setScalar(LAYOUT.pan);
        this.pan.rotation.y = panPiece.rotationY ?? Math.PI;
        this.pan.position.copy(at(panPiece, stoveTop));
        this.group.add(this.pan);
        this.panFloor = stoveTop + 0.06 * LAYOUT.pan;
        this.addTarget('pan', at(panPiece, stoveTop + 0.1), LAYOUT.tapRadius.pan);

        // The piles, each on a little plate.
        for (const piece of pieces.filter((p) => p.role === 'pile' && p.piece)) {
            const group = new THREE.Group();
            group.position.copy(at(piece, this.benchTop));
            const dish = kitchenModel('plate');
            dish.scale.setScalar(LAYOUT.pileDish);
            group.add(dish);
            this.group.add(group);
            const pile = { piece: piece.piece!, group, base: sizeOf(dish).y * 0.6 };
            this.piles.set(piece.piece!, pile);
            this.fillPile(pile);
            this.addTarget(piece.piece!, at(piece, this.benchTop + 0.2), LAYOUT.tapRadius.pile);
        }
        // The plate, where a served one goes, and where the customer stands.
        this.platePiece = one('plate') ?? { role: 'plate', x: 0, z: 0 };
        this.servedPiece = one('served') ?? this.platePiece;
        this.addTarget('plate', at(this.platePiece, this.benchTop + 0.25), LAYOUT.tapRadius.plate);
        for (const piece of pieces.filter((p) => p.role === 'decor' && p.model)) {
            const thing = kitchenModel(piece.model!);
            thing.position.copy(at(piece, this.benchTop));
            thing.rotation.y = piece.rotationY ?? 0;
            this.group.add(thing);
        }
        this.newPlate();
    }

    /** A pile's pieces (PILE of them, on its little plate). */
    private fillPile(pile: Pile): void {
        let y = pile.base;
        for (let i = 0; i < PILE; i++) {
            const piece = this.food(PILE_PART[pile.piece]);
            piece.position.y = y;
            piece.rotation.y = (i - 1) * 0.35;
            pile.group.add(piece);
            y += sizeOf(piece).y * 0.9;
        }
    }

    private food(part: Part): THREE.Group {
        const piece = kitchenModel(PART_MODELS[part]);
        piece.scale.setScalar(LAYOUT.food);
        return piece;
    }

    private addTarget(kind: TargetKind, at: THREE.Vector3, radius: number): void {
        this.targets.push({ kind, at: at.add(this.group.position), radius });
    }

    /** A clean, empty plate at its place. */
    private newPlate(): void {
        this.plate = new THREE.Group();
        this.plate.position.set(this.platePiece.x, this.benchTop, this.platePiece.z);
        const dish = kitchenModel('plate');
        dish.scale.setScalar(LAYOUT.dish);
        this.plate.add(dish);
        this.group.add(this.plate);
        this.stack = [];
        this.stackTop = this.plateBase = sizeOf(dish).y * 0.7;
        gsap.from(this.plate.scale, { x: 0.01, y: 0.01, z: 0.01, duration: 0.3, ease: 'back.out(2)' });
    }

    /** `object` (in the group) hops in an arc to `to` (the group's space), then `done`. */
    private hop(object: THREE.Object3D, to: THREE.Vector3, done: () => void): void {
        const from = object.position.clone();
        const state = { t: 0 };
        object.userData.hop = gsap.to(state, {
            t: 1, duration: HOP.seconds, ease: 'none',
            onUpdate: () => {
                object.position.lerpVectors(from, to, state.t);
                object.position.y += Math.sin(state.t * Math.PI) * HOP.height;
            },
            onComplete: done,
        });
    }

    /** A piece from a pile, as `part`, starting where the pile's top one is (the pile stays as it is). */
    private takeFrom(piece: Piece, part: Part): THREE.Object3D {
        const pile = this.piles.get(piece)!;
        const top = pile.group.children[pile.group.children.length - 1];
        const object = this.food(part);
        object.position.copy(pile.group.position).add(top.position);
        object.rotation.y = top.rotation.y;
        this.group.add(object);
        gsap.fromTo(pile.group.scale, { x: 1.08, y: 0.9, z: 1.08 }, { x: 1, y: 1, z: 1, duration: 0.25, ease: 'back.out(3)' });
        return object;
    }

    // ---------------------------------------------------------------- the bench's jobs

    public get panEmpty(): boolean {
        return !this.inPan;
    }

    public get pattyReady(): boolean {
        return Boolean(this.inPan?.cooked && !this.inPan.arriving);
    }

    /** 0..1 while a patty cooks; null with none cooking. */
    public get cookProgress(): number | null {
        if (!this.inPan || this.inPan.cooked || this.inPan.arriving) return null;
        return Math.min(1, this.inPan.time / SETTINGS.cookSeconds);
    }

    /** Above the pan (world): where its cooking bar goes. */
    public get panPoint(): THREE.Vector3 {
        return this.pan.position.clone().add(new THREE.Vector3(0, 0.6, 0)).add(this.group.position);
    }

    public targetPoint(kind: TargetKind): THREE.Vector3 {
        return this.targets.find((t) => t.kind === kind)!.at.clone().add(new THREE.Vector3(0, 0.25, 0));
    }

    /** What's on the plate, bottom up. */
    public get onPlate(): Part[] {
        return this.stack.map((s) => s.part);
    }

    public get plateFull(): boolean {
        return this.stack.length >= MAX_STACK;
    }

    public get plateHasFood(): boolean {
        return this.stack.length > 0;
    }

    /** The dish is done (a burger: its top bun on, and landed): it can be served. */
    public get dishReady(): boolean {
        const top = this.stack[this.stack.length - 1];
        return Boolean(top && top.part === 'bunTop' && top.object.userData.landed);
    }

    /** Over the dish (world): where its "ready" mark goes. */
    public get platePoint(): THREE.Vector3 {
        return this.plate.position.clone().add(new THREE.Vector3(0, this.stackTop + 0.45, 0)).add(this.group.position);
    }

    /** The finished dish bounces gently while it waits to be served. */
    public setReadyPulse(on: boolean): void {
        const plate = this.plate;
        gsap.killTweensOf(plate.scale);
        plate.scale.set(1, 1, 1);
        if (on) gsap.to(plate.scale, { x: 1.07, y: 1.12, z: 1.07, duration: 0.35, yoyo: true, repeat: -1, ease: 'sine.inOut' });
    }

    /**
     * A tap on `kind`: the raw patties put one in the pan, the pan its cooked patty on the plate, a bun or topping pile
     * one on the plate. 'done' if it did; otherwise why not.
     */
    public take(kind: TargetKind): 'done' | 'busy' | 'full' | 'raw' | 'empty' {
        if (kind === 'plate') return 'empty';
        if (kind === 'pan') return this.pattyFromPan();
        if (kind === 'patty') return this.cookPatty();
        if (this.plateFull) return 'full';
        this.toPlate(kind, this.takeFrom(kind, kind));
        return 'done';
    }

    private cookPatty(): 'done' | 'busy' {
        if (this.inPan) return 'busy';
        const patty = this.takeFrom('patty', 'rawPatty');
        const cooking = { object: patty, cooked: false, time: 0, arriving: true };
        this.inPan = cooking;
        this.hop(patty, new THREE.Vector3(this.pan.position.x, this.panFloor, this.pan.position.z - 0.05), () => {
            cooking.arriving = false;
        });
        return 'done';
    }

    private pattyFromPan(): 'done' | 'raw' | 'full' | 'empty' {
        const cooking = this.inPan;
        if (!cooking) return 'empty';
        if (!cooking.cooked || cooking.arriving) return 'raw';
        if (this.plateFull) return 'full';
        this.inPan = null;
        gsap.killTweensOf(cooking.object.scale);
        cooking.object.scale.setScalar(LAYOUT.food);
        this.toPlate('patty', cooking.object);
        return 'done';
    }

    /** A piece's place on the plate's taken at once (a quick second tap stacks above it), then it hops there. */
    private toPlate(part: Part, object: THREE.Object3D): void {
        const height = this.stackTop;
        this.stack.push({ part, object });
        this.stackTop += sizeOf(object).y * (part === 'bunTop' ? 0.9 : 0.75);
        const plate = this.plate;
        const to = plate.position.clone().setY(plate.position.y + height);
        this.hop(object, to, () => {
            object.userData.landed = true;
            // Into the plate (it moves with it), at the height it was given.
            if (object.parent !== plate && plate.parent) {
                plate.add(object);
                object.position.set(0, height, 0);
            }
            gsap.fromTo(plate.scale, { x: 1.06, y: 0.94, z: 1.06 }, { x: 1, y: 1, z: 1, duration: 0.2, ease: 'back.out(3)' });
        });
    }

    /**
     * Everything off the plate into the trash can (`bin`: its object in the room): each piece in turn arcs up off the plate
     * and drops in, the can bobs as it lands; the plate stays.
     */
    public trashInto(bin: THREE.Object3D): void {
        bin.updateWorldMatrix(true, true);
        const box = new THREE.Box3().setFromObject(bin);
        const opening = new THREE.Vector3((box.min.x + box.max.x) / 2, box.max.y, (box.min.z + box.max.z) / 2);
        const pieces = this.stack.map(({ object }) => object);
        this.stack = [];
        this.stackTop = this.plateBase;
        // Top piece first: they come off the stack the way they'd be picked up.
        pieces.reverse().forEach((object, i) => {
            (object.userData.hop as gsap.core.Tween | undefined)?.kill();
            // Out of the plate, into the kitchen's group, where it is now.
            this.group.attach(object);
            const from = object.position.clone();
            const to = this.group.worldToLocal(opening.clone());
            const above = to.clone().setY(to.y + TOSS.dropFrom);
            const spin = (Math.random() < 0.5 ? -1 : 1) * TOSS.spin;
            const start = object.rotation.clone();
            const size = object.scale.x;
            const state = { t: 0 };
            gsap.to(state, {
                t: 1, duration: TOSS.seconds, delay: i * TOSS.stagger, ease: 'power1.in',
                onUpdate: () => {
                    // An arc up and over to just above the can, then straight down into it.
                    const t = state.t;
                    object.position.lerpVectors(from, above, Math.min(1, t / 0.75));
                    object.position.y += Math.sin(Math.min(1, t / 0.75) * Math.PI) * TOSS.height;
                    if (t > 0.75) object.position.lerpVectors(above, to, (t - 0.75) / 0.25);
                    object.rotation.set(start.x + spin * t * 0.5, start.y + spin * t, start.z);
                    object.scale.setScalar(size * (t > 0.75 ? 1 - ((t - 0.75) / 0.25) * 0.7 : 1));
                },
                onComplete: () => {
                    object.removeFromParent();
                    // The can takes it: a little squash.
                    const base = bin.userData.baseScale ?? (bin.userData.baseScale = bin.scale.clone());
                    gsap.fromTo(bin.scale, { x: base.x * 1.08, y: base.y * 0.9, z: base.z * 1.08 }, { x: base.x, y: base.y, z: base.z, duration: 0.25, ease: 'back.out(3)' });
                },
            });
        });
        // The plate gives a little bounce as it's cleared.
        gsap.fromTo(this.plate.scale, { x: 1.06, y: 0.94, z: 1.06 }, { x: 1, y: 1, z: 1, duration: 0.25, ease: 'back.out(3)' });
    }

    /** Everything off the plate (it's wasted). */
    public trash(): void {
        this.dropPlate();
        this.newPlate();
    }

    private dropPlate(): void {
        const old = this.plate;
        gsap.to(old.scale, { x: 0.01, y: 0.01, z: 0.01, duration: 0.22, ease: 'back.in(2)', onComplete: () => { old.removeFromParent(); } });
        // Pieces still hopping there go too.
        this.stack.forEach(({ object }) => {
            if (object.parent !== old) {
                (object.userData.hop as gsap.core.Tween | undefined)?.kill();
                object.removeFromParent();
            }
        });
    }

    /** The plate across to the customer; `done` once it's there. */
    public serve(done: () => void): void {
        this.setReadyPulse(false);
        gsap.to(this.plate.position, { x: this.servedPiece.x, z: this.servedPiece.z, duration: 0.45, delay: 0.15, ease: 'power2.inOut', onComplete: done });
    }

    /**
     * The plate off to a seated customer's table: out of the kitchen into the room, gliding in an arc to `to` (world: its
     * spot on the table), where it stays (it's theirs now: `done` gets it). A fresh plate's laid at once.
     */
    public serveTo(to: THREE.Vector3, done: (plate: THREE.Object3D) => void): void {
        this.setReadyPulse(false);
        const plate = this.plate;
        const room = this.group.parent;
        if (room) room.attach(plate);
        const from = plate.position.clone();
        const state = { t: 0 };
        gsap.to(state, {
            t: 1, duration: SERVE_TO.seconds, delay: 0.1, ease: 'power1.inOut',
            onUpdate: () => {
                plate.position.lerpVectors(from, to, state.t);
                plate.position.y += Math.sin(state.t * Math.PI) * SERVE_TO.height;
            },
            onComplete: () => {
                gsap.fromTo(plate.scale, { x: 1.08, y: 0.9, z: 1.08 }, { x: 1, y: 1, z: 1, duration: 0.22, ease: 'back.out(3)' });
                done(plate);
            },
        });
        this.newPlate();
    }

    /** The food on a served plate: its pieces (the plate's own model is the first child). */
    public static foodOn(plate: THREE.Object3D): THREE.Object3D[] {
        return plate.children.slice(1);
    }

    /** The served plate gone (the customer took it), a fresh one in its place. */
    public clearServed(): void {
        this.dropPlate();
        this.newPlate();
    }

    public update(dt: number): void {
        const cooking = this.inPan;
        if (!cooking || cooking.cooked || cooking.arriving) return;
        cooking.time += dt;
        // A sizzle: the patty jiggles while it cooks.
        const s = LAYOUT.food * (1 + Math.sin(cooking.time * 30) * 0.03);
        cooking.object.scale.set(s, LAYOUT.food, s);
        if (cooking.time >= SETTINGS.cookSeconds) {
            // Done: the raw one swapped for a cooked one, with a little pop.
            const cooked = this.food('patty');
            cooked.position.copy(cooking.object.position);
            cooked.rotation.copy(cooking.object.rotation);
            cooking.object.removeFromParent();
            this.group.add(cooked);
            cooking.object = cooked;
            cooking.cooked = true;
            gsap.fromTo(cooked.scale, { x: LAYOUT.food * 1.25, y: LAYOUT.food * 1.25, z: LAYOUT.food * 1.25 }, { x: LAYOUT.food, y: LAYOUT.food, z: LAYOUT.food, duration: 0.3, ease: 'back.out(3)' });
            this.onCooked?.();
        }
    }

    public destroy(): void {
        this.group.traverse((child) => gsap.killTweensOf([child.position, child.scale]));
        this.group.removeFromParent();
    }
}
