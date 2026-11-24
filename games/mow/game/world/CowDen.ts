// CowDen.ts
//
// The farm test's second shop (TOWN.farm.cowDen): a cow barn, built like the chicken den (a fenced yard of bare earth
// with a gate on its south side, out of reach behind its grass, boarded up below its level) but for milk:
//   - Cows (the library's cow) stand in stalls in front of a red barn along the back; each puts a bottle of milk on its
//     spot every milkEverySec, up to floorMax there.
//   - Walking up to a spot picks its milk up into the backpack.
//   - Two machines take milk on their own MILK squares: the butter churn (west) makes butter, the cheese press (east)
//     makes cheese, each onto its grid beside it. The player chooses which to feed.
//   - Standing on a grid picks its goods up.
//   - Customers (from the people spawn areas, on their in path) queue at the counter by the east fence: each orders
//     butter, cheese or both (their bubble shows each and how many). Handed over on SELL, they pay onto the cash square.
//   - Trucks (their own path and dock by the west fence) order a big mix the same way and pay onto their own square.
//   - Money (and a level) buys the next cow on its stall's spot; with every cow owned, the conveyor belt: milk rides it
//     along the stalls, round behind the machines, and is split between the two (taking turns, skipping a full one).
//   - Then the helpers (DenHelper, hired on their squares): the counter's (after the belt) carries butter and cheese
//     to the customers, the trucks' (after the dock) to the parked truck; each takes its cash to the player. With the
//     belt and both helpers the barn runs on its own: the player only spends what it makes.
// The first visit is short: the first stall's spot is full of milk, the machines make at once (straight into the
// backpack of a player standing at them), and the first customers each want one thing.
// Everything kept is MowProgress.barn.

import * as THREE from 'three';
import gsap from 'gsap';
import { BendService } from '../services/BendService';
import { CowDenDef, DenPoint, TruckPathPoint, shortMoney } from '../data/MowConfig';
import { MowProgress } from '../data/MowProgress';
import { CanvasArt } from '../ui/CanvasArt';
import { GameAnalytics } from '../analytics/GameAnalytics';
import { Animal, farmItem, ITEM_HEIGHT, farmProp } from '../farm/FarmModels';
import { Customers, Customer, OrderItem, stockDemand } from '../farm/Customers';
import { Trucks } from '../farm/Trucks';
import { spawnPoint } from '../farm/Roads';
import { ConveyorBelt, BELT_SHAPE } from '../farm/ConveyorBelt';
import { MowAudio } from '../audio/MowAudio';
import { DenHelper } from '../farm/DenHelper';
import type { FarmItem } from '../farm/FarmModels';
import { DenHooks, signTexture, squareTexture } from './ChickenDen';
import type { Box } from './GuidePath';

const FENCE_HEIGHT = 0.9;
const POST_SPACING = 1.2;
const WOOD = 0x8a5a32;
/** The barn along the back: its depth and wall height; the cows in front of it, their spots in front of them. */
const BARN = { depth: 1.5, wall: 1.6 };
const COW_Z = 2.6;
const SPOT_Z = 4.4;
const COW_HEIGHT = 1.3;
/** Within this of a spot's middle counts as at it. */
const SPOT_REACH = 0.95;
/** Seconds between items moved one at a time. */
const PICK_SEC = 0.1;
const DROP_SEC = 0.07;
const TAKE_SEC = 0.14;
const SELL_SEC = 0.2;
/** Money per note bundle drawn on a cash square, and the most drawn. */
const CASH_PER_BUNDLE = 10;
const MAX_BUNDLES = 30;
/** Buying on a square: the whole price in about `seconds`, at least `least` a second; a note flies every `tossSec`. */
const POUR = { seconds: 1.4, least: 25, tossSec: 0.08 };
/** The lesson (the first visit): goods made every this many seconds, handed to a player within this of the machine's square. */
const LESSON_SEC = 0.15;
const LESSON_REACH = 2.5;
/** A machine's grid: 2 x 2 slots this big, the goods on it this much bigger than carried ones. */
const GRID_CELL = 0.95;
const GRID_SCALE = 1.4;
/**
 * Unloading: standing on SELL with goods nobody in the queue wants (or nobody there) for this long, they go back onto
 * their grid one by one (stock the helpers sell later): the player always has somewhere to put things down.
 */
const UNLOAD_WAIT = 0.6;
const UNLOAD_SEC = 0.08;
/** The conveyor is offered once this many cows are in (automation comes early). */
const BELT_AFTER_COWS = 3;
/** The den's sounds are heard this far past its fence. */
const SOUND_RANGE = 10;

type Product = 'butter' | 'cheese';
const PRODUCTS: Product[] = ['butter', 'cheese'];

interface Square {
    x: number;
    z: number;
    w: number;
    d: number;
}

interface Layout {
    hw: number;
    hd: number;
    stalls: number[];
    machines: Record<Product, { x: number; z: number; input: Square; grid: Square }>;
    counter: { x: number; z: number };
    sell: Square;
    cash: Square;
    beltBuy: Square;
    /** The helpers' hire squares: the counter's (north of the cash), the trucks' (by the west dock's cash). */
    helperHire: Square;
    truckHelperHire: Square;
}

/** Where everything goes (den-local, +Z toward the gate): the stalls along the back, the churn west and the press east. */
function layout(def: CowDenDef): Layout {
    const hw = def.width / 2;
    const hd = def.depth / 2;
    const cows = def.loop.cows.length;
    const spacing = (def.width - 3) / cows;
    const parts = def.parts ?? {};
    // A placed part takes its spot (and a square its size when the editor set one); else the barn's own layout.
    const at = <T extends { x: number; z: number; w?: number; d?: number }>(base: T, placed?: DenPoint | null): T => {
        if (!placed) return base;
        const moved = { ...base, x: placed.x, z: placed.z };
        if (base.w !== undefined && placed.w) moved.w = placed.w;
        if (base.d !== undefined && placed.d) moved.d = placed.d;
        return moved;
    };
    const machine = (product: Product, x: number, gridX: number) => ({
        ...at({ x, z: 0.9 }, parts[`${product}Machine`]),
        input: at({ x, z: 3.0, w: 1.6, d: 1.5 }, parts[`${product}Input`]),
        grid: at({ x: gridX, z: 0.9, w: GRID_CELL * 2, d: GRID_CELL * 2 }, parts[`${product}Grid`]),
    });
    return {
        hw, hd,
        stalls: Array.from({ length: cows }, (_, i) => -hw + 1.5 + spacing * (i + 0.5)),
        // (The grids a step in from the counter, so taking cheese isn't standing on SELL.)
        machines: { butter: machine('butter', -2.6, -4.6), cheese: machine('cheese', 2.6, 4.6) },
        counter: at({ x: hw - 0.55, z: 0.6 }, parts.counter),
        sell: at({ x: hw - 1.85, z: 0.6, w: 1.5, d: 2 }, parts.sell),
        cash: at({ x: hw - 1.85, z: hd - 1.35, w: 1.5, d: 1.5 }, parts.cash),
        beltBuy: at({ x: 0, z: -hd + SPOT_Z + 1.6, w: 1.8, d: 1.4 }, parts.beltBuy),
        helperHire: at({ x: hw - 1.85, z: 3.4, w: 1.6, d: 1.6 }, parts.helperHire),
        truckHelperHire: at({ x: -hw + 3.4, z: 4.6, w: 1.6, d: 1.6 }, parts.truckHelperHire),
    };
}

interface Stall {
    x: number;
    cow: Animal;
    buy: THREE.Mesh;
    buyDrawn: string;
    lock: THREE.Sprite;
    milk: THREE.Group;
    timer: number;
}

export class CowDen {
    private readonly group = new THREE.Group();
    private readonly layoutOf: Layout;
    private readonly stalls: Stall[] = [];
    private readonly sign: THREE.Sprite;
    private readonly redraws: (() => void)[] = [];
    private readonly piles: Record<Product, THREE.Group> = { butter: new THREE.Group(), cheese: new THREE.Group() };
    private readonly shownPile: Record<Product, number> = { butter: -1, cheese: -1 };
    private readonly bodies: Record<Product, THREE.Group> = { butter: new THREE.Group(), cheese: new THREE.Group() };
    private readonly counters: Record<Product, { canvas: HTMLCanvasElement; texture: THREE.CanvasTexture; drawn: string }>;
    private readonly cashPile = new THREE.Group();
    private readonly truckPile = new THREE.Group();
    private shownCash = -1;
    private shownTruckCash = -1;
    private customers?: Customers;
    private trucks?: Trucks;
    private dockSquare?: THREE.Mesh;
    private truckCashSquare?: THREE.Mesh;
    private dockDrawn = '';
    private gateBoards?: THREE.Group;
    private opened: boolean;
    private playerNear = false;
    private playerAt = { x: 1e6, z: 1e6 };
    /** One-at-a-time timers, and each machine's. */
    private pickTimer = 0;
    private dropTimer = 0;
    private takeTimer = 0;
    private sellTimer = 0;
    private unloadWait = 0;
    private truckTimer = 0;
    private readonly makeTimer: Record<Product, number> = { butter: 0, cheese: 0 };
    /** What each customer (and the parked truck) has been handed so far is worth: paid with their last. */
    private readonly sales = new Map<Customer, number>();
    private truckSale = 0;
    /** Buying on a square: money still to pour this frame, the square told about, the notes' timer. */
    private pourCarry = 0;
    private pourTold = '';
    private pourTossed = 0;
    /** The belt (bought): its visuals, the milk on it (how far along, which machine it's for), its buy square. */
    private belt?: ConveyorBelt;
    private beltPath: THREE.Vector2[] = [];
    private beltSquare?: THREE.Mesh;
    private beltDrawn = '';
    private readonly beltMilk: { s: number; object: THREE.Object3D }[] = [];
    private beltTake: number[] = [];
    private nextMachine: Product = 'butter';
    /** The helpers, and their hire squares (hidden until offered). */
    private helper?: DenHelper;
    private truckHelper?: DenHelper;
    private readonly hireSquares = new Map<'helper' | 'truckHelper', { mesh: THREE.Mesh; drawn: string; square: Square }>();

    public constructor(private readonly threeScene: THREE.Scene, public readonly def: CowDenDef, found: boolean, private readonly hooks: DenHooks) {
        this.opened = found;
        const barn = MowProgress.barn;
        if (found && barn.cows < 1) barn.cows = 1;
        while (barn.floor.length < def.loop.cows.length) barn.floor.push(0);
        this.layoutOf = layout(def);
        this.group.position.set(def.x, 0, def.z);
        this.counters = {
            butter: { canvas: document.createElement('canvas'), texture: new THREE.CanvasTexture(document.createElement('canvas')), drawn: '' },
            cheese: { canvas: document.createElement('canvas'), texture: new THREE.CanvasTexture(document.createElement('canvas')), drawn: '' },
        };
        this.buildFloor();
        this.buildFence();
        this.buildBarn();
        this.buildStalls();
        this.buildMachines();
        this.buildCounter();
        this.buildDock();
        this.buildBeltSquare();
        for (const key of ['helper', 'truckHelper'] as const) {
            if (!this.def.loop[key]) continue;
            const square = key === 'helper' ? this.layoutOf.helperHire : this.layoutOf.truckHelperHire;
            const mesh = this.decal(new THREE.Texture(), square.w, square.d, square.x, square.z);
            mesh.visible = false;
            this.hireSquares.set(key, { mesh, drawn: '', square });
        }
        this.sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: signTexture(def.name.toUpperCase(), !found, this.levelLocked ? def.level : undefined), depthWrite: false }));
        this.sign.position.set(0, 2.7, this.layoutOf.hd);
        this.sign.renderOrder = 20;
        this.fitSign();
        this.group.add(this.sign);
        this.redraws.push(() => this.redrawSign());
        if (this.levelLocked) this.buildGateBoards();
        window.setTimeout(() => this.redraws.forEach((redraw) => redraw()), 1500);
        threeScene.add(this.group);
        if (found) this.startCustomers();
        if (found && barn.dock) this.startTrucks();
        if (found && barn.belt) this.buildBelt();
        if (found && barn.helper) this.hireHelper(false);
        if (found && barn.truckHelper) this.hireTruckHelper(false);
        this.refreshStalls();
    }

    // ---------------------------------------------------------------- what the scene asks of a den

    /** Its fences, barn, machines and counters (solid), its floor and the customers' strip (bare). */
    public static boxes(def: CowDenDef): { solid: Box[]; bare: Box[] } {
        const l = layout(def);
        const { hw, hd } = l;
        const side = (hw - def.gate / 2) / 2;
        const at = (x: number, z: number, halfX: number, halfZ: number): Box => ({ x: def.x + x, z: def.z + z, halfX, halfZ });
        const solid: Box[] = [
            at(0, -hd, hw, 0.15),
            at(-hw, 0, 0.15, hd),
            at(hw, 0, 0.15, hd),
            at(-hw + side, hd, side, 0.15),
            at(hw - side, hd, side, 0.15),
            at(0, -hd + (COW_Z + 0.7) / 2, hw - 0.4, (COW_Z + 0.7) / 2),
            ...PRODUCTS.map((p) => at(l.machines[p].x, l.machines[p].z, 0.8, 0.6)),
            at(l.counter.x, l.counter.z, 0.4, 1.1),
        ];
        const bare: Box[] = [at(0, 0, hw + 0.2, hd + 0.2), at(hw + 1.2, 1.2, 1.1, hd - 0.6)];
        return { solid, bare };
    }

    public get isOpen(): boolean {
        return this.opened;
    }

    /** Not open yet and below its level: boarded up, can't be reached. */
    public get levelLocked(): boolean {
        return !this.opened && MowProgress.level < (this.def.level ?? 0);
    }

    public gateBox(): Box {
        return { x: this.def.x, z: this.def.z + this.layoutOf.hd, halfX: this.def.gate / 2 + 0.1, halfZ: 0.3 };
    }

    public gate(out = new THREE.Vector3()): THREE.Vector3 {
        return out.set(this.def.x, 0, this.def.z + this.def.depth / 2);
    }

    public reached(x: number, z: number): boolean {
        if (this.levelLocked) return false;
        const { hw, hd } = this.layoutOf;
        const atGate = Math.abs(x - this.def.x) <= this.def.gate / 2 + 0.4 && Math.abs(z - (this.def.z + hd)) <= 0.9;
        return atGate || (Math.abs(x - this.def.x) < hw && Math.abs(z - this.def.z) < hd);
    }

    public inside(x: number, z: number): boolean {
        const { hw, hd } = this.layoutOf;
        return Math.abs(x - this.def.x) < hw - 0.1 && Math.abs(z - this.def.z) < hd - 0.05;
    }

    /** Found: the sign shows, the first cow's in, its milk waiting (the lesson), customers start coming. */
    public open(): void {
        if (this.opened) return;
        this.opened = true;
        const barn = MowProgress.barn;
        if (barn.cows < 1) barn.cows = 1;
        if (!this.lessonDone) barn.floor[0] = Math.max(barn.floor[0] ?? 0, this.def.loop.startMilk ?? this.def.loop.floorMax);
        MowProgress.denChanged();
        this.redrawSign();
        const to = this.sign.scale.clone();
        this.sign.scale.set(0.1, 0.02, 1);
        gsap.to(this.sign.scale, { x: to.x, y: to.y, duration: 0.7, ease: 'back.out(2)' });
        this.refreshStalls();
        this.popIn(this.stalls[0].cow.object);
        this.startCustomers();
    }

    // ---------------------------------------------------------------- building

    private material(color: number, extra: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
        const material = new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...extra });
        BendService.applyBend(material);
        return material;
    }

    private box(width: number, height: number, depth: number, color: number | THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = this.group): THREE.Mesh {
        const material = color instanceof THREE.Material ? color : this.material(color);
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
        mesh.position.set(x, y, z);
        parent.add(mesh);
        return mesh;
    }

    private decal(texture: THREE.Texture, width: number, depth: number, x: number, z: number): THREE.Mesh {
        const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false });
        material.polygonOffset = true;
        material.polygonOffsetFactor = -3;
        material.polygonOffsetUnits = -3;
        BendService.applyBend(material);
        const geometry = new THREE.PlaneGeometry(width, depth, 4, 4);
        geometry.rotateX(-Math.PI / 2);
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(x, 0.07, z);
        mesh.renderOrder = 2;
        this.group.add(mesh);
        return mesh;
    }

    /** A square drawn again once the atlas is up (its icons may come out blank while booting). */
    private square(draw: () => THREE.CanvasTexture, width: number, depth: number, x: number, z: number): THREE.Mesh {
        const mesh = this.decal(draw(), width, depth, x, z);
        this.redraws.push(() => {
            (mesh.material as THREE.MeshBasicMaterial).map = draw();
            (mesh.material as THREE.MeshBasicMaterial).needsUpdate = true;
        });
        return mesh;
    }

    private buildFloor(): void {
        const { hw, hd } = this.layoutOf;
        const geometry = new THREE.PlaneGeometry(hw * 2, hd * 2, Math.ceil(hw * 4), Math.ceil(hd * 4));
        geometry.rotateX(-Math.PI / 2);
        const floor = new THREE.Mesh(geometry, this.material(0x8a6a4c, { roughness: 1 }));
        floor.position.y = 0.04;
        this.group.add(floor);
        // The customers' strip outside the east fence.
        const path = new THREE.PlaneGeometry(2.2, hd * 2 - 1.2, 4, Math.ceil(hd * 4));
        path.rotateX(-Math.PI / 2);
        const strip = new THREE.Mesh(path, this.material(0x96785a, { roughness: 1 }));
        strip.position.set(hw + 1.2, 0.035, 1.2);
        this.group.add(strip);
    }

    private buildFence(): void {
        const { hw, hd } = this.layoutOf;
        const wood = this.material(0xf2efe6);
        const post = new THREE.BoxGeometry(0.16, FENCE_HEIGHT, 0.16);
        const addPost = (x: number, z: number, height = FENCE_HEIGHT) => {
            const mesh = new THREE.Mesh(post, wood);
            mesh.scale.y = height / FENCE_HEIGHT;
            mesh.position.set(x, height / 2, z);
            this.group.add(mesh);
        };
        const rail = (ax: number, az: number, bx: number, bz: number) => {
            const length = Math.hypot(bx - ax, bz - az);
            for (const y of [0.4, 0.78]) {
                const mesh = this.box(length, 0.1, 0.07, wood, (ax + bx) / 2, y, (az + bz) / 2);
                mesh.rotation.y = -Math.atan2(bz - az, bx - ax);
            }
            const count = Math.max(1, Math.round(length / POST_SPACING));
            for (let i = 0; i <= count; i++) addPost(ax + ((bx - ax) * i) / count, az + ((bz - az) * i) / count);
        };
        const gate = this.def.gate / 2;
        rail(-hw, -hd, hw, -hd);
        rail(-hw, -hd, -hw, hd);
        rail(hw, -hd, hw, hd);
        rail(-hw, hd, -gate, hd);
        rail(gate, hd, hw, hd);
        addPost(-gate, hd, 2.3);
        addPost(gate, hd, 2.3);
        this.box(this.def.gate + 0.4, 0.18, 0.2, this.material(0xb8432f), 0, 2.25, hd);
    }

    /** The barn along the back: red plank walls with white trim and big crossed doors, a dark gable roof. */
    private buildBarn(): void {
        const { hw, hd } = this.layoutOf;
        const length = hw * 2 - 0.6;
        const back = -hd + 0.15;
        const front = back + BARN.depth;
        const middle = (back + front) / 2;
        this.box(length, BARN.wall, BARN.depth, 0xb8432f, 0, BARN.wall / 2, middle);
        for (let x = -length / 2 + 0.5; x < length / 2; x += 0.6) this.box(0.05, BARN.wall, 0.02, 0x8f2f22, x, BARN.wall / 2, front + 0.005);
        this.box(length + 0.06, 0.12, BARN.depth + 0.06, 0xf4f1ea, 0, BARN.wall, middle);
        const rise = 1.0;
        const halfDepth = BARN.depth / 2 + 0.4;
        const shape = new THREE.Shape();
        shape.moveTo(-halfDepth, 0);
        shape.lineTo(halfDepth, 0);
        shape.lineTo(0, rise);
        shape.closePath();
        const roofGeometry = new THREE.ExtrudeGeometry(shape, { depth: length + 0.5, bevelEnabled: false });
        roofGeometry.translate(0, 0, -(length + 0.5) / 2);
        roofGeometry.rotateY(Math.PI / 2);
        const roof = new THREE.Mesh(roofGeometry, this.material(0x4a3a36));
        roof.position.set(0, BARN.wall + 0.06, middle);
        this.group.add(roof);
        // Barn doors in the middle: white frames crossed on red.
        const white = this.material(0xf4f1ea);
        for (const side of [-1, 1]) {
            const door = new THREE.Group();
            door.position.set(side * 0.7, 0, front + 0.02);
            this.box(1.3, 1.4, 0.04, 0xa63a2a, 0, 0.7, 0, door);
            const cross = this.box(1.7, 0.08, 0.05, white, 0, 0.7, 0.02, door);
            cross.rotation.z = 0.82;
            const other = this.box(1.7, 0.08, 0.05, white, 0, 0.7, 0.02, door);
            other.rotation.z = -0.82;
            this.group.add(door);
        }
    }

    /** The stalls: a divider between each, a cow in each (the first free, the rest bought), a spot for its milk. */
    private buildStalls(): void {
        const { hd, stalls } = this.layoutOf;
        const wood = this.material(WOOD);
        const straw = this.material(0xe8c25a);
        const lockTexture = (): THREE.CanvasTexture => {
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = 128;
            CanvasArt.drawIcon(canvas.getContext('2d')!, 'Icon_Lock03', 64, 64, 112);
            return CanvasArt.texture(canvas);
        };
        const lock = lockTexture();
        const spacing = stalls.length > 1 ? stalls[1] - stalls[0] : 2;
        stalls.forEach((x, i) => {
            // Dividers between stalls (and at the row's ends).
            for (const side of i === 0 ? [-1, 1] : [1]) {
                const divider = this.box(0.12, 0.9, 1.6, wood, x + side * spacing / 2, 0.45, -hd + COW_Z);
                divider.userData.divider = true;
            }
            const bed = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.04, 16), straw);
            bed.position.set(x, 0.05, -hd + SPOT_Z);
            this.group.add(bed);
            const cow = new Animal('animals/animal-cow.glb', COW_HEIGHT);
            cow.object.position.set(x, 0.05, -hd + COW_Z);
            this.group.add(cow.object);
            const milk = new THREE.Group();
            milk.position.set(x, 0.07, -hd + SPOT_Z);
            this.group.add(milk);
            const buy = this.decal(new THREE.Texture(), 1.5, 1.5, x, -hd + SPOT_Z);
            const padlock = new THREE.Sprite(new THREE.SpriteMaterial({ map: lock, depthWrite: false }));
            padlock.scale.set(0.8, 0.8, 1);
            padlock.position.set(x, 1.7, -hd + COW_Z);
            padlock.renderOrder = 20;
            this.group.add(padlock);
            this.stalls.push({ x, cow, buy, buyDrawn: '', lock: padlock, milk, timer: this.def.loop.milkEverySec * (0.4 + i * 0.2) });
        });
        this.redraws.push(() => {
            CanvasArt.forgetIcon('Icon_Lock03');
            const fresh = lockTexture();
            for (const stall of this.stalls) {
                stall.lock.material.map = fresh;
                stall.lock.material.needsUpdate = true;
                stall.buyDrawn = '';
            }
            this.refreshStalls();
        });
    }

    /** The butter churn (a banded wooden barrel with a crank) and the cheese press (a box under a big screw), their squares and grids. */
    private buildMachines(): void {
        for (const product of PRODUCTS) {
            const m = this.layoutOf.machines[product];
            const body = this.bodies[product];
            body.position.set(m.x, 0, m.z);
            this.group.add(body);
            if (product === 'butter') {
                const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.6, 1.2, 16), this.material(0xb07a45));
                barrel.position.y = 0.6;
                body.add(barrel);
                const bands: THREE.Mesh[] = [];
                for (const y of [0.25, 0.95]) {
                    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.61, 0.61, 0.07, 16), this.material(0x4a4a52, { metalness: 0.4 }));
                    band.position.y = y;
                    body.add(band);
                    bands.push(band);
                }
                // The pizza game's barrel, once it's in: it takes the drawn one's place.
                void farmProp('farm/barrel.glb', 1.2, 1.25).then((model) => {
                    if (!model || !this.group.parent) return;
                    barrel.visible = false;
                    bands.forEach((band) => (band.visible = false));
                    body.add(model);
                });
                this.box(0.08, 0.7, 0.08, 0x4a4a52, 0, 1.5, 0, body);
                this.box(0.6, 0.08, 0.08, 0x4a4a52, 0.27, 1.82, 0, body);
                this.box(0.9, 0.2, 0.7, 0xffe066, 0, 0.1, 0.55, body);
            } else {
                this.box(1.3, 0.9, 1.0, 0xe08a2c, 0, 0.45, 0, body);
                this.box(1.4, 0.1, 1.1, 0x9a5a1a, 0, 0.92, 0, body);
                const screw = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1.1, 10), this.material(0x6a6f7a, { metalness: 0.5 }));
                screw.position.y = 1.5;
                body.add(screw);
                this.box(1.0, 0.1, 0.1, 0x6a6f7a, 0, 2.05, 0, body);
            }
            // Its counter over it: milk inside / what it holds.
            const counter = this.counters[product];
            counter.canvas.width = 220;
            counter.canvas.height = 96;
            counter.texture = CanvasArt.texture(counter.canvas);
            const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: counter.texture, depthWrite: false }));
            sprite.scale.set(1.3, 0.57, 1);
            sprite.position.set(m.x, 2.6, m.z);
            sprite.renderOrder = 20;
            this.group.add(sprite);
            const word = product === 'butter' ? 'BUTTER' : 'CHEESE';
            this.square(() => squareTexture(m.input.w, m.input.d, '#ffffff', { text: 'MILK', dashed: true, sub: word, subColor: product === 'butter' ? '#ffe066' : '#ffb347' }),
                m.input.w, m.input.d, m.input.x, m.input.z);
            this.gridDecal(m.grid);
            const pile = this.piles[product];
            pile.position.set(m.grid.x, 0.06, m.grid.z);
            this.group.add(pile);
        }
    }

    /** A machine's grid: 2 x 2 cyan-edged slots. */
    private gridDecal(grid: Square): void {
        const scale = 128;
        const canvas = document.createElement('canvas');
        canvas.width = grid.w * scale;
        canvas.height = grid.d * scale;
        const g = canvas.getContext('2d')!;
        g.strokeStyle = '#4fe3ff';
        g.lineWidth = 8;
        g.fillStyle = 'rgba(25, 35, 30, 0.35)';
        for (let r = 0; r < 2; r++) {
            for (let c = 0; c < 2; c++) {
                g.beginPath();
                g.roundRect(c * GRID_CELL * scale + 6, r * GRID_CELL * scale + 6, GRID_CELL * scale - 12, GRID_CELL * scale - 12, 14);
                g.fill();
                g.stroke();
            }
        }
        this.decal(CanvasArt.texture(canvas), grid.w, grid.d, grid.x, grid.z);
    }

    /** The counter by the east fence, its SELL square, the cash square by the gate. */
    private buildCounter(): void {
        const { counter, sell, cash } = this.layoutOf;
        this.box(0.8, 0.85, 2.2, WOOD, counter.x, 0.42, counter.z);
        this.box(0.95, 0.12, 2.35, 0x4fae5a, counter.x, 0.9, counter.z);
        this.square(() => squareTexture(sell.w, sell.d, '#4fe3ff', { text: 'SELL' }), sell.w, sell.d, sell.x, sell.z);
        this.square(() => squareTexture(cash.w, cash.d, '#4fe3ff', { icon: 'ItemIcon_Money_Bill' }), cash.w, cash.d, cash.x, cash.z);
        this.cashPile.position.set(cash.x, 0.06, cash.z);
        this.group.add(this.cashPile);
    }

    /** The truck dock (by the west fence: TOWN.farm.cowDen.trucks) and its cash square. */
    private buildDock(): void {
        const dock = this.def.trucks;
        if (!dock) return;
        this.dockSquare = this.decal(new THREE.Texture(), 1.6, 1.6, dock.x - this.def.x, dock.z - this.def.z);
        const cash = this.truckCash;
        const mesh = this.square(() => squareTexture(1.5, 1.5, '#4fe3ff', { icon: 'ItemIcon_Money_Bill' }), 1.5, 1.5, cash.x, cash.z);
        mesh.visible = false;
        this.truckCashSquare = mesh;
        this.truckPile.position.set(cash.x, 0.06, cash.z);
        this.group.add(this.truckPile);
    }

    private get truckCash(): Square {
        const dock = this.def.trucks!;
        const at = dock.cash ?? { x: dock.x, z: dock.z + 1.9 };
        return { x: at.x - this.def.x, z: at.z - this.def.z, w: 1.5, d: 1.5 };
    }

    private buildBeltSquare(): void {
        if (!this.def.loop.belt) return;
        const { beltBuy } = this.layoutOf;
        this.beltSquare = this.decal(new THREE.Texture(), beltBuy.w, beltBuy.d, beltBuy.x, beltBuy.z);
        this.beltSquare.visible = false;
    }

    private redrawSign(): void {
        this.sign.material.map = signTexture(this.def.name.toUpperCase(), !this.opened, this.levelLocked ? this.def.level : undefined);
        this.sign.material.needsUpdate = true;
        this.fitSign();
    }

    private fitSign(): void {
        // Only while it's locked: open, its name over it is just more text.
        this.sign.visible = !this.opened && (this.levelLocked || !this.def.level);
        const image = this.sign.material.map?.image as { width: number; height: number } | undefined;
        const ratio = image ? image.height / image.width : 96 / 448;
        this.sign.scale.set(4.2, 4.2 * ratio, 1);
    }

    /** Boards across the gate and a padlock on them, while it's below its level. */
    private buildGateBoards(): void {
        const boards = new THREE.Group();
        const wood = this.material(WOOD);
        const width = this.def.gate + 0.2;
        for (const y of [0.4, 0.9, 1.4]) this.box(width, 0.22, 0.1, wood, 0, y, 0, boards);
        for (const turn of [0.5, -0.5]) this.box(width * 1.05, 0.16, 0.08, wood, 0, 0.9, 0.07, boards).rotation.z = turn;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 128;
        CanvasArt.drawIcon(canvas.getContext('2d')!, 'Icon_Lock03', 64, 64, 112);
        const lock = new THREE.Sprite(new THREE.SpriteMaterial({ map: CanvasArt.texture(canvas), depthWrite: false }));
        lock.position.set(0, 0.95, 0.3);
        lock.renderOrder = 20;
        boards.add(lock);
        boards.position.set(0, 0, this.layoutOf.hd);
        this.group.add(boards);
        this.gateBoards = boards;
    }

    /** At its level: the camera's shown it (the scene), the padlock flies off, the boards sink, confetti, it's said. */
    private dropGate(): void {
        const boards = this.gateBoards;
        if (!boards) return;
        this.gateBoards = undefined;
        const gate = this.gate(new THREE.Vector3());
        const delay = this.hooks.showUnlock?.(gate) ?? 0;
        gsap.delayedCall(delay, () => {
            if (!this.group.parent) return;
            gsap.to(boards.position, { y: -1.8, duration: 0.9, delay: 0.25, ease: 'power2.in', onComplete: () => void boards.removeFromParent() });
            this.redrawSign();
            const to = this.sign.scale.clone();
            this.sign.scale.multiplyScalar(0.1);
            gsap.to(this.sign.scale, { x: to.x, y: to.y, duration: 0.7, delay: 0.3, ease: 'back.out(2)' });
            this.hooks.effects.smoke(gate.clone().setY(0.6), 10, 1.2, new THREE.Color(0xfff2a0), 1.2);
            for (const color of [0xff5a6e, 0xffd23f, 0x4fc3ff, 0x9cff6a, 0xffffff]) this.hooks.effects.burst(gate.clone().setY(0.5), new THREE.Color(color), 6, 6);
            this.hooks.say(`${this.def.name.toUpperCase()} UNLOCKED! MOW YOUR WAY TO IT`, 0x9cff6a);
            MowAudio.play('buyFanfare');
            MowAudio.play('cheer');
        });
    }

    private popIn(object: THREE.Object3D): void {
        object.scale.setScalar(0.01);
        gsap.to(object.scale, { x: 1, y: 1, z: 1, duration: 0.6, ease: 'back.out(2.5)' });
    }

    // ---------------------------------------------------------------- customers and trucks

    private startCustomers(): void {
        if (this.customers) return;
        const { counter, hw, hd } = this.layoutOf;
        const loop = this.def.loop;
        const x = this.def.x + hw + 1.1;
        const slots = Array.from({ length: loop.queue }, (_, i) => new THREE.Vector3(x, 0, this.def.z + counter.z + i * 1.5));
        const entry = new THREE.Vector3(x, 0, this.def.z + hd + 0.4);
        const ins = this.def.peopleIn ?? [];
        const outs = this.def.peopleOut ?? [];
        const paths = ins.length >= 2 && outs.length >= 2
            ? { in: ins.map((p) => new THREE.Vector3(p.x, 0, p.z)), out: outs.map((p) => new THREE.Vector3(p.x, 0, p.z)) }
            : undefined;
        this.customers = new Customers(this.threeScene, slots, entry, () => spawnPoint('people') ?? entry.clone(), new THREE.Vector3(-1, 0, 0),
            { wants: loop.wants, queue: loop.queue, everySec: loop.customerEverySec, items: PRODUCTS }, paths);
        // The lesson: the first customers want one thing each.
        if (!this.lessonDone) this.customers.firstOnes = 2;
    }

    private startTrucks(): void {
        const dock = this.def.trucks;
        const own = this.def.truckPath ?? [];
        if (this.trucks || !dock || own.length < 2) return;
        const points = own.map((p: TruckPathPoint) => new THREE.Vector3(p.x, 0, p.z));
        const marked = own.findIndex((p) => p.park);
        const park = marked > 0 ? marked : points.length - 1;
        const path = points.slice(0, park + 1);
        const out = park < points.length - 1 ? points.slice(park) : [...path].reverse();
        const last = path[path.length - 1];
        const before = path[path.length - 2];
        this.trucks = new Trucks(this.threeScene, dock, path, out, Math.atan2(last.x - before.x, last.z - before.z), PRODUCTS);
    }

    // ---------------------------------------------------------------- shown state

    private get lessonDone(): boolean {
        const barn = MowProgress.barn;
        return !!barn.tutorial || !!barn.dock || !!barn.belt || barn.cows > 1;
    }

    /** The stalls: cows owned shown, the next one's square to buy it, the rest padlocked. */
    private refreshStalls(): void {
        const barn = MowProgress.barn;
        const owned = this.opened ? barn.cows : 0;
        this.stalls.forEach((stall, i) => {
            const has = i < owned;
            stall.cow.object.visible = has;
            stall.lock.visible = !has;
            const next = this.opened && i === owned;
            stall.buy.visible = next;
            if (next) {
                const cow = this.def.loop.cows[i];
                const short = MowProgress.level < cow.level;
                const key = `${cow.price}|${short}|${MowProgress.paid(this.cowKey(i))}`;
                if (key !== stall.buyDrawn) {
                    stall.buyDrawn = key;
                    const left = Math.max(0, cow.price - MowProgress.paid(this.cowKey(i)));
                    const material = stall.buy.material as THREE.MeshBasicMaterial;
                    material.map = squareTexture(1.5, 1.5, '#ffffff', { text: shortMoney(left), sub: short ? `LEVEL ${cow.level}` : 'NEW COW', subColor: short ? '#ff8a7a' : '#9cff6a' });
                    material.needsUpdate = true;
                }
            }
            this.drawMilk(stall, has ? barn.floor[i] ?? 0 : 0);
        });
    }

    private cowKey(i: number): string {
        return `${this.def.id}-cow-${i}`;
    }

    /** A stall's milk on its spot: up to eight bottles, four a layer. */
    private drawMilk(stall: Stall, count: number): void {
        if (stall.milk.children.length === count) return;
        stall.milk.clear();
        for (let i = 0; i < count; i++) {
            const bottle = farmItem('milk');
            const layer = Math.floor(i / 4);
            const k = i % 4;
            bottle.scale.setScalar(1.3);
            bottle.position.set(((k % 2) - 0.5) * 0.3, layer * ITEM_HEIGHT.milk * 1.3, (Math.floor(k / 2) - 0.5) * 0.3);
            stall.milk.add(bottle);
        }
    }

    /** A grid's goods: on its 2 x 2 slots, piling up. */
    private drawPile(product: Product, count: number): void {
        if (count === this.shownPile[product]) return;
        this.shownPile[product] = count;
        const pile = this.piles[product];
        pile.clear();
        for (let i = 0; i < count; i++) {
            const slot = i % 4;
            const layer = Math.floor(i / 4);
            const item = farmItem(product);
            item.scale.setScalar(GRID_SCALE);
            item.position.set(((slot % 2) - 0.5) * GRID_CELL, layer * ITEM_HEIGHT[product] * GRID_SCALE, (Math.floor(slot / 2) - 0.5) * GRID_CELL);
            pile.add(item);
        }
    }

    private drawCash(pile: THREE.Group, cash: number, shown: number): number {
        const bundles = cash <= 0 ? 0 : Math.min(MAX_BUNDLES, Math.max(1, Math.ceil(cash / CASH_PER_BUNDLE)));
        if (bundles === shown) return shown;
        pile.clear();
        for (let i = 0; i < bundles; i++) {
            const bundle = farmItem('cash');
            const k = i % 6;
            bundle.position.set(((k % 2) - 0.5) * 0.4, Math.floor(i / 6) * ITEM_HEIGHT.cash, (Math.floor(k / 2) - 1) * 0.22);
            bundle.rotation.y = Math.sin(i * 1.7) * 0.15;
            pile.add(bundle);
        }
        return bundles;
    }

    private drawCounters(): void {
        const barn = MowProgress.barn;
        for (const product of PRODUCTS) {
            const counter = this.counters[product];
            const inside = product === 'butter' ? barn.butterIn : barn.cheeseIn;
            const key = `${inside}`;
            if (key === counter.drawn) continue;
            counter.drawn = key;
            const g = counter.canvas.getContext('2d')!;
            g.clearRect(0, 0, counter.canvas.width, counter.canvas.height);
            CanvasArt.plaque(g, 4, 4, counter.canvas.width - 8, counter.canvas.height - 8, 18);
            g.fillStyle = '#fafaf6';
            g.strokeStyle = '#2f7fe0';
            g.lineWidth = 4;
            g.beginPath();
            g.roundRect(26, 24, 26, 48, 8);
            g.fill();
            g.stroke();
            CanvasArt.text(g, `${inside}/${this.def.loop[product].max}`, 132, 48, 40, inside >= this.def.loop[product].max ? '#ff8a7a' : '#ffffff', 150);
            counter.texture.needsUpdate = true;
        }
    }

    private refreshDock(): void {
        const dock = this.def.trucks;
        const square = this.dockSquare;
        if (!dock || !square) return;
        const barn = MowProgress.barn;
        square.visible = this.opened && this.lessonDone;
        if (this.truckCashSquare) this.truckCashSquare.visible = this.opened && !!barn.dock;
        const open = !!barn.dock;
        const short = MowProgress.level < dock.level;
        const key = `${open}|${short}|${MowProgress.paid(`${this.def.id}-dock`)}`;
        if (key === this.dockDrawn) return;
        this.dockDrawn = key;
        const left = Math.max(0, dock.price - MowProgress.paid(`${this.def.id}-dock`));
        const material = square.material as THREE.MeshBasicMaterial;
        material.map = open
            ? squareTexture(1.6, 1.6, '#4fe3ff', { text: 'TRUCK' })
            : squareTexture(1.6, 1.6, '#ffffff', { text: shortMoney(left), sub: short ? `LEVEL ${dock.level}` : 'TRUCKS', subColor: short ? '#ff8a7a' : '#9cff6a' });
        material.needsUpdate = true;
    }

    private refreshBeltSquare(): void {
        const config = this.def.loop.belt;
        const square = this.beltSquare;
        if (!config || !square) return;
        const barn = MowProgress.barn;
        const offered = this.opened && !barn.belt && barn.cows >= Math.min(BELT_AFTER_COWS, this.def.loop.cows.length);
        square.visible = offered;
        if (!offered) return;
        const short = MowProgress.level < config.level;
        const key = `${short}|${MowProgress.paid(`${this.def.id}-belt`)}`;
        if (key === this.beltDrawn) return;
        this.beltDrawn = key;
        const left = Math.max(0, config.price - MowProgress.paid(`${this.def.id}-belt`));
        const { beltBuy } = this.layoutOf;
        const material = square.material as THREE.MeshBasicMaterial;
        material.map = squareTexture(beltBuy.w, beltBuy.d, '#ffffff', { text: shortMoney(left), sub: short ? `LEVEL ${config.level}` : 'CONVEYOR', subColor: short ? '#ff8a7a' : '#9cff6a' });
        material.needsUpdate = true;
    }

    // ---------------------------------------------------------------- the loop

    private local(x: number, z: number): { x: number; z: number } {
        return { x: x - this.def.x, z: z - this.def.z };
    }

    private world(x: number, y: number, z: number): THREE.Vector3 {
        return new THREE.Vector3(this.def.x + x, y, this.def.z + z);
    }

    private onSquare(p: { x: number; z: number }, square: Square): boolean {
        return Math.abs(p.x - square.x) <= square.w / 2 && Math.abs(p.z - square.z) <= square.d / 2;
    }

    private sound(name: Parameters<typeof MowAudio.play>[0]): void {
        if (this.playerNear) MowAudio.play(name);
    }

    /** The market's hunger from the stock waiting (bigger orders, more often, with a big pile: stockDemand()). */
    private readonly marketDemand = (): number => stockDemand(MowProgress.barn.butter + MowProgress.barn.cheese);

    public update(delta: number, player: THREE.Vector3): void {
        if (this.customers) this.customers.demand = this.marketDemand;
        if (this.trucks) this.trucks.demand = this.marketDemand;
        this.playerNear = Math.hypot(player.x - this.def.x, player.z - this.def.z) <= SOUND_RANGE + Math.max(this.def.width, this.def.depth) / 2;
        const p = this.local(player.x, player.z);
        this.playerAt = p;
        if (this.gateBoards && !this.levelLocked) this.dropGate();
        for (const stall of this.stalls) stall.cow.update(delta);
        this.customers?.update(delta);
        this.trucks?.update(delta);
        this.helper?.update(delta);
        this.truckHelper?.update(delta);
        const barn = MowProgress.barn;
        this.drawCounters();
        for (const product of PRODUCTS) this.drawPile(product, barn[product]);
        this.shownCash = this.drawCash(this.cashPile, barn.cash, this.shownCash);
        this.shownTruckCash = this.drawCash(this.truckPile, barn.truckCash, this.shownTruckCash);
        this.refreshDock();
        this.refreshBeltSquare();
        this.refreshHireSquares();
        if (!this.opened) return;
        this.milk(delta);
        for (const product of PRODUCTS) this.make(product, delta);
        this.beltLoop(delta);
        this.pickMilk(delta, p);
        this.feed(delta, p);
        this.takeGoods(delta, p);
        this.sell(delta, p);
        this.loadTruck(delta, p);
        this.pickCash(p);
        // Off every buy square: what was said there is forgotten (said again on the next visit).
        const dock = this.def.trucks;
        const onDock = !!dock && Math.abs(p.x - (dock.x - this.def.x)) <= 0.8 && Math.abs(p.z - (dock.z - this.def.z)) <= 0.8;
        const onHire = [...this.hireSquares.values()].some((hire) => hire.mesh.visible && this.onSquare(p, hire.square));
        if (!this.onCowSquare(p) && !onDock && !onHire && !this.onSquare(p, this.layoutOf.beltBuy)) this.pourTold = '';
        this.buyCow(delta, p);
        this.buyDock(delta, p);
        this.buyBelt(delta, p);
        this.buyHelpers(delta, p);
    }

    // ---------------------------------------------------------------- the helpers

    /** A helper's offered: the counter's once the belt runs, the trucks' once the dock's bought; not hired yet. */
    private helperOffered(key: 'helper' | 'truckHelper'): boolean {
        const barn = MowProgress.barn;
        if (!this.opened || barn[key]) return false;
        return key === 'helper' ? !!barn.belt : !!barn.dock && !!this.def.trucks;
    }

    private refreshHireSquares(): void {
        for (const [key, hire] of this.hireSquares) {
            const config = this.def.loop[key]!;
            const offered = this.helperOffered(key);
            hire.mesh.visible = offered;
            if (!offered) continue;
            const paidKey = `${this.def.id}-${key}`;
            const short = MowProgress.level < config.level;
            const drawn = `${short}|${MowProgress.paid(paidKey)}`;
            if (drawn === hire.drawn) continue;
            hire.drawn = drawn;
            const left = Math.max(0, Math.ceil(config.price - MowProgress.paid(paidKey)));
            const material = hire.mesh.material as THREE.MeshBasicMaterial;
            material.map = squareTexture(hire.square.w, hire.square.d, '#ffffff', {
                text: shortMoney(left), sub: short ? `LEVEL ${config.level}` : key === 'helper' ? 'HELPER' : 'TRUCK HELPER', subColor: short ? '#ff8a7a' : '#9cff6a',
            });
            material.needsUpdate = true;
        }
    }

    /** On an offered hire square: money (and a level) pours in; paid, the helper starts work. */
    private buyHelpers(delta: number, p: { x: number; z: number }): void {
        for (const [key, hire] of this.hireSquares) {
            if (!hire.mesh.visible || !this.onSquare(p, hire.square)) continue;
            const config = this.def.loop[key]!;
            const label = key === 'helper' ? 'THE HELPER' : 'THE TRUCK HELPER';
            if (!this.pourInto(`${this.def.id}-${key}`, config.price, config.level, this.world(hire.square.x, 0.1, hire.square.z), delta, label)) continue;
            MowProgress.barn[key] = true;
            MowProgress.denChanged();
            GameAnalytics.den(this.def.id, key === 'helper' ? 'helper' : 'truck-helper');
            MowAudio.play('buyFanfare');
            this.hooks.xp('hen');
            this.hooks.say(key === 'helper' ? 'HELPER HIRED!' : 'TRUCK HELPER HIRED!', 0x9cff6a);
            if (key === 'helper') this.hireHelper(true);
            else this.hireTruckHelper(true);
        }
    }

    /**
     * Where a helper picks goods up: the grid of what `wants` asks for (the counter's customer, the parked truck), else
     * the grid with the most on it; null with both empty. Den-local.
     */
    private helperPickSpot(wants: (item: OrderItem) => boolean): { at: THREE.Vector3; kind: FarmItem } | null {
        const barn = MowProgress.barn;
        const stocked = PRODUCTS.filter((product) => barn[product] > 0);
        if (!stocked.length) return null;
        const product = stocked.find((item) => wants(item)) ?? stocked.sort((a, b) => barn[b] - barn[a])[0];
        const grid = this.layoutOf.machines[product].grid;
        return { at: new THREE.Vector3(grid.x, 0, grid.z + grid.d / 2 + 0.3), kind: product };
    }

    private helperTake(kind: FarmItem): boolean {
        const product = kind as Product;
        const barn = MowProgress.barn;
        if (!PRODUCTS.includes(product) || barn[product] <= 0) return false;
        barn[product]--;
        MowProgress.denChanged();
        return true;
    }

    /** Something a helper carries that nobody there wants goes back on its grid (so a helper never stands stuck). */
    private putBack(kind: FarmItem): boolean {
        const product = kind as Product;
        if (!PRODUCTS.includes(product)) return false;
        MowProgress.barn[product]++;
        MowProgress.denChanged();
        return true;
    }

    /** The counter's helper: butter and cheese to the customer at the counter, its cash to the player. */
    private hireHelper(fanfare: boolean): void {
        const config = this.def.loop.helper;
        if (!config || this.helper) return;
        const { sell, cash } = this.layoutOf;
        const wants = (item: OrderItem) => {
            const front = this.customers?.front;
            return !!front && !!this.customers?.wantsItem(front, item);
        };
        this.helper = new DenHelper(this.group, new THREE.Vector3(sell.x - 1, 0, sell.z), config.carry, config.walkSpeed, {
            pickSpot: () => this.helperPickSpot(wants),
            take: (kind) => this.helperTake(kind),
            sellSpot: () => new THREE.Vector3(sell.x, 0, sell.z),
            cashSpot: () => new THREE.Vector3(cash.x, 0, cash.z),
            serve: (kind, from) => {
                const customers = this.customers;
                const customer = customers?.front;
                if (!customers || !customer) return false;
                if (!customers.wantsItem(customer, kind as OrderItem)) return this.putBack(kind);
                this.serveCustomer(customer, kind as Product, from.clone().add(this.group.position));
                return true;
            },
            cashWaiting: () => MowProgress.barn.cash,
            collect: () => this.collectPile('cash', cash),
        });
        if (fanfare) this.popIn(this.helper.root);
    }

    /** The trucks' helper: butter and cheese to the parked truck, the trucks' cash to the player. */
    private hireTruckHelper(fanfare: boolean): void {
        const config = this.def.loop.truckHelper;
        const dock = this.def.trucks;
        if (!config || !dock || this.truckHelper) return;
        const at = new THREE.Vector3(dock.x - this.def.x, 0, dock.z - this.def.z);
        const wants = (item: OrderItem) => !!this.trucks?.parked && this.trucks.wantsItem(item);
        this.truckHelper = new DenHelper(this.group, at.clone().add(new THREE.Vector3(1, 0, 0)), config.carry, config.walkSpeed, {
            pickSpot: () => this.helperPickSpot(wants),
            take: (kind) => this.helperTake(kind),
            sellSpot: () => at.clone(),
            cashSpot: () => new THREE.Vector3(this.truckCash.x, 0, this.truckCash.z),
            serve: (kind, from) => {
                const trucks = this.trucks;
                if (!trucks?.parked) return false;
                if (!trucks.wantsItem(kind as OrderItem)) return this.putBack(kind);
                this.serveTruck(kind as Product, from.clone().add(this.group.position));
                return true;
            },
            cashWaiting: () => MowProgress.barn.truckCash,
            collect: () => this.collectPile('truckCash', this.truckCash),
        });
        if (fanfare) this.popIn(this.truckHelper.root);
    }

    /** A helper takes a cash pile to the player (it's theirs: added to their money, notes flying up). */
    private collectPile(pile: 'cash' | 'truckCash', square: Square): void {
        const barn = MowProgress.barn;
        const amount = barn[pile];
        if (amount <= 0) return;
        barn[pile] = 0;
        MowProgress.denChanged();
        MowProgress.addMoney(amount);
        for (let i = 0; i < Math.min(6, Math.ceil(amount / CASH_PER_BUNDLE)); i++) {
            this.hooks.effects.pickup(this.world(square.x, 0.2 + i * 0.05, square.z), new THREE.Color(0x5fc85a), () => this.sound('coins'), farmItem('cash'));
        }
    }

    /** Each cow puts a bottle on its spot every milkEverySec, up to floorMax (with the belt, the spot sends it on). */
    private milk(delta: number): void {
        const barn = MowProgress.barn;
        const { hd } = this.layoutOf;
        this.stalls.forEach((stall, i) => {
            if (i >= barn.cows) return;
            stall.timer -= delta;
            if (stall.timer > 0) return;
            stall.timer = this.def.loop.milkEverySec / MowProgress.farmSpeed;
            if ((barn.floor[i] ?? 0) >= this.def.loop.floorMax) return;
            barn.floor[i] = (barn.floor[i] ?? 0) + 1;
            MowProgress.denChanged();
            stall.cow.play('eat');
            gsap.delayedCall(1, () => stall.cow.play('idle'));
            this.hooks.effects.toss(this.world(stall.x, 1, -hd + COW_Z + 0.6), this.world(stall.x, 0.1, -hd + SPOT_Z), new THREE.Color(0xfafaf6), 0,
                () => this.refreshStalls(), farmItem('milk'));
        });
    }

    /** A machine makes one of its goods whenever it has the milk for one and its grid has room (at once in the lesson: into the backpack). */
    private make(product: Product, delta: number): void {
        const barn = MowProgress.barn;
        const config = this.def.loop[product];
        const inKey = product === 'butter' ? 'butterIn' : 'cheeseIn';
        const room = 4 * (config.layers ?? 4);
        if (barn[inKey] < config.milkPer || barn[product] >= room) {
            this.makeTimer[product] = 0;
            return;
        }
        const lesson = !this.lessonDone;
        this.makeTimer[product] += delta;
        const body = this.bodies[product];
        const m = this.layoutOf.machines[product];
        body.position.x = m.x + Math.sin(this.makeTimer[product] * 40) * 0.015;
        if (this.makeTimer[product] < (lesson ? LESSON_SEC : config.sec / MowProgress.farmSpeed)) return;
        this.makeTimer[product] = 0;
        body.position.x = m.x;
        barn[inKey] -= config.milkPer;
        this.hooks.xp('tray');
        const atIt = Math.hypot(this.playerAt.x - m.input.x, this.playerAt.z - m.input.z) <= LESSON_REACH;
        if (lesson && atIt && (MowProgress.goods[product] ?? 0) < this.def.loop.carryMax) {
            MowProgress.carry(product, 1);
            this.hooks.effects.pickup(this.world(m.x, 1.2, m.z), new THREE.Color(product === 'butter' ? 0xffe066 : 0xf2a33a), () => this.sound('item'), farmItem(product));
        } else {
            barn[product]++;
        }
        MowProgress.denChanged();
        GameAnalytics.den(this.def.id, product);
    }

    /** At a stall's spot: its milk flies into the backpack, one at a time. */
    private pickMilk(delta: number, p: { x: number; z: number }): void {
        this.pickTimer -= delta;
        if (this.pickTimer > 0 || (MowProgress.goods.milk ?? 0) >= this.def.loop.carryMax) return;
        const barn = MowProgress.barn;
        const { hd } = this.layoutOf;
        const i = this.stalls.findIndex((stall, n) => n < barn.cows && (barn.floor[n] ?? 0) > 0 && Math.hypot(p.x - stall.x, p.z - (-hd + SPOT_Z)) <= SPOT_REACH);
        if (i < 0) return;
        this.pickTimer = PICK_SEC;
        barn.floor[i]--;
        MowProgress.denChanged();
        MowProgress.carry('milk', 1);
        this.refreshStalls();
        this.hooks.xp('egg');
        this.hooks.effects.pickup(this.world(this.stalls[i].x, 0.2, -hd + SPOT_Z), new THREE.Color(0xfafaf6), () => this.sound('item'), farmItem('milk'));
    }

    /** On a machine's MILK square: the backpack's milk goes in. */
    private feed(delta: number, p: { x: number; z: number }): void {
        this.dropTimer -= delta;
        if (this.dropTimer > 0 || (MowProgress.goods.milk ?? 0) <= 0) return;
        const barn = MowProgress.barn;
        for (const product of PRODUCTS) {
            const m = this.layoutOf.machines[product];
            const inKey = product === 'butter' ? 'butterIn' : 'cheeseIn';
            if (!this.onSquare(p, m.input) || barn[inKey] >= this.def.loop[product].max) continue;
            this.dropTimer = DROP_SEC;
            MowProgress.carry('milk', -1);
            barn[inKey]++;
            MowProgress.denChanged();
            this.hooks.effects.toss(this.hooks.carryPoint(), this.world(m.x, 1.3, m.z), new THREE.Color(0xfafaf6), 0, () => {}, farmItem('milk'));
            return;
        }
    }

    /** On a machine's grid: its goods fly into the backpack. */
    private takeGoods(delta: number, p: { x: number; z: number }): void {
        this.takeTimer -= delta;
        if (this.takeTimer > 0) return;
        const barn = MowProgress.barn;
        for (const product of PRODUCTS) {
            const grid = this.layoutOf.machines[product].grid;
            if (barn[product] <= 0 || (MowProgress.goods[product] ?? 0) >= this.def.loop.carryMax) continue;
            if (!this.onSquare(p, { ...grid, w: grid.w + 0.4, d: grid.d + 0.4 })) continue;
            this.takeTimer = TAKE_SEC;
            barn[product]--;
            MowProgress.denChanged();
            MowProgress.carry(product, 1);
            GameAnalytics.den(this.def.id, `${product}-taken`);
            this.hooks.effects.pickup(this.world(grid.x, 0.3, grid.z), new THREE.Color(product === 'butter' ? 0xffe066 : 0xf2a33a), () => this.sound('item'), farmItem(product));
            return;
        }
    }

    /** What the backpack has that `wants` takes (the order's goods), if any. */
    private carriedFor(wants: (item: OrderItem) => boolean): Product | undefined {
        return PRODUCTS.find((product) => (MowProgress.goods[product] ?? 0) > 0 && wants(product));
    }

    /** On SELL: the customer at the counter gets what they ordered that's carried; their last paid onto the cash square. */
    private sell(delta: number, p: { x: number; z: number }): void {
        this.sellTimer -= delta;
        const customers = this.customers;
        const customer = customers?.front;
        const onSell = this.onSquare(p, this.layoutOf.sell);
        const product = customers && customer ? this.carriedFor((item) => customers.wantsItem(customer, item)) : undefined;
        // Carrying what nobody there wants: unload it onto its grid (after a moment).
        const spare = PRODUCTS.find((item) => (MowProgress.goods[item] ?? 0) > 0);
        this.unloadWait = onSell && !product && spare ? this.unloadWait + delta : 0;
        if (spare && this.unloadWait >= UNLOAD_WAIT && this.sellTimer <= 0) {
            this.sellTimer = UNLOAD_SEC;
            MowProgress.carry(spare, -1);
            MowProgress.barn[spare]++;
            MowProgress.denChanged();
            const grid = this.layoutOf.machines[spare].grid;
            this.hooks.effects.toss(this.hooks.carryPoint(), this.world(grid.x, 0.3, grid.z), new THREE.Color(0xffe066), 0, () => this.sound('item'), farmItem(spare));
            return;
        }
        if (this.sellTimer > 0 || !customers || !customer || !onSell || !product) return;
        this.sellTimer = SELL_SEC;
        MowProgress.carry(product, -1);
        this.serveCustomer(customer, product, this.hooks.carryPoint());
    }

    /** One of `product` from `from` (world) to the customer at the counter; their last pays onto the cash square. */
    private serveCustomer(customer: Customer, product: Product, from: THREE.Vector3): void {
        const customers = this.customers!;
        const value = (this.sales.get(customer) ?? 0) + this.def.loop[product].price;
        this.sales.set(customer, value);
        const last = customers.give(customer, product);
        this.hooks.xp('traySold');
        this.hooks.effects.toss(from, customers.handsOf(customer), new THREE.Color(0xffe066), 0, () => {
            this.sound('item');
            if (!last) return;
            this.sales.delete(customer);
            this.sound('buyCash');
            this.pay('cash', value, this.world(this.layoutOf.counter.x, 1.1, this.layoutOf.counter.z), this.layoutOf.cash);
            if (!MowProgress.barn.tutorial) {
                MowProgress.barn.tutorial = true;
                GameAnalytics.den(this.def.id, 'tutorial');
            }
        }, farmItem(product));
    }

    /** On the dock's square: the parked truck gets what it ordered that's carried; its last pays onto its own square. */
    private loadTruck(delta: number, p: { x: number; z: number }): void {
        const dock = this.def.trucks;
        const trucks = this.trucks;
        this.truckTimer -= delta;
        if (!dock || !trucks || this.truckTimer > 0 || !trucks.parked) return;
        if (Math.abs(p.x - (dock.x - this.def.x)) > 0.8 || Math.abs(p.z - (dock.z - this.def.z)) > 0.8) return;
        const product = this.carriedFor((item) => trucks.wantsItem(item));
        if (!product) return;
        this.truckTimer = SELL_SEC * 0.7;
        MowProgress.carry(product, -1);
        this.serveTruck(product, this.hooks.carryPoint());
    }

    /** One of `product` from `from` (world) into the parked truck; its last pays onto the trucks' square. */
    private serveTruck(product: Product, from: THREE.Vector3): void {
        const trucks = this.trucks!;
        this.truckSale += this.def.loop[product].price;
        const value = this.truckSale;
        const last = trucks.give(product);
        if (last) this.truckSale = 0;
        this.hooks.xp('traySold');
        const bed = trucks.bed();
        this.hooks.effects.toss(from, bed, new THREE.Color(0xffe066), 0, () => {
            this.sound('item');
            if (!last) return;
            this.sound('buyCash');
            this.pay('truckCash', value, bed, this.truckCash);
        }, farmItem(product));
    }

    /** A payment: notes fly from `from` onto a cash square (the customers' or the trucks'). */
    private pay(pile: 'cash' | 'truckCash', amount: number, from: THREE.Vector3, square: Square): void {
        // Money Gain boosts the barn's takings too.
        amount = MowProgress.farmPay(amount);
        MowProgress.barn[pile] += amount;
        MowProgress.denChanged();
        const bundles = Math.min(8, Math.ceil(amount / CASH_PER_BUNDLE));
        for (let i = 0; i < bundles; i++) {
            this.hooks.effects.toss(from.clone().setY(from.y + 0.3), this.world(square.x, 0.1, square.z), new THREE.Color(0x5fc85a), i * 0.06,
                () => this.sound('coins'), farmItem('cash'));
        }
    }

    /** On a cash square: the money's the player's. */
    private pickCash(p: { x: number; z: number }): void {
        const barn = MowProgress.barn;
        const take = (pile: 'cash' | 'truckCash', square: Square) => {
            if (barn[pile] <= 0 || !this.onSquare(p, square)) return;
            const amount = barn[pile];
            barn[pile] = 0;
            MowProgress.denChanged();
            MowProgress.addMoney(amount);
            for (let i = 0; i < Math.min(8, Math.ceil(amount / CASH_PER_BUNDLE)); i++) {
                this.hooks.effects.pickup(this.world(square.x, 0.2 + i * 0.05, square.z), new THREE.Color(0x5fc85a), () => this.sound('coins'), farmItem('cash'));
            }
            this.hooks.effects.floatText(this.world(square.x, 1.8, square.z), `+${shortMoney(amount)}`, '#ffe27a');
        };
        take('cash', this.layoutOf.cash);
        if (this.def.trucks && barn.dock) take('truckCash', this.truckCash);
    }

    /**
     * Pours money into a buy square (`key`: kept between visits), at the price and level; true when it's paid. Says
     * once per visit what's missing (the level, or money).
     */
    private pourInto(key: string, price: number, level: number, at: THREE.Vector3, delta: number, what: string): boolean {
        if (MowProgress.level < level) {
            if (this.pourTold !== key) {
                this.pourTold = key;
                this.hooks.say(`REACH LEVEL ${level} FOR ${what}`, 0xffd9a8);
            }
            return false;
        }
        const left = price - MowProgress.paid(key);
        if (left > 0 && MowProgress.payable <= 0) {
            if (this.pourTold !== key) {
                this.pourTold = key;
                this.hooks.say(`${shortMoney(Math.ceil(left))} TO GO`, 0xffd9a8);
            }
            return false;
        }
        this.pourCarry += Math.max(POUR.least, price / POUR.seconds) * delta;
        const want = Math.min(Math.max(0, left), Math.floor(this.pourCarry));
        if (want > 0) {
            this.pourCarry -= want;
            const taken = MowProgress.takePayment(want);
            if (taken > 0) {
                MowProgress.addPaid(key, taken);
                this.pourTossed -= delta;
                if (this.pourTossed <= 0) {
                    this.pourTossed = POUR.tossSec;
                    this.hooks.effects.toss(this.hooks.carryPoint(), at, new THREE.Color(0x5fc85a), 0, () => this.sound('coins'), farmItem('cash'));
                }
            }
        }
        if (MowProgress.paid(key) < price) return false;
        MowProgress.clearPaid(key);
        this.pourCarry = 0;
        return true;
    }

    /** On the next stall's square: money (and a level) pours in; paid, a new cow pops in. */
    private buyCow(delta: number, p: { x: number; z: number }): boolean {
        const barn = MowProgress.barn;
        const i = barn.cows;
        const cow = this.def.loop.cows[i];
        const { hd } = this.layoutOf;
        const on = !!cow && Math.hypot(p.x - this.stalls[i].x, p.z - (-hd + SPOT_Z)) <= 0.75;
        if (!on) return false;
        if (!this.pourInto(this.cowKey(i), cow.price, cow.level, this.world(this.stalls[i].x, 0.1, -hd + SPOT_Z), delta, 'THIS COW')) {
            this.refreshStalls();
            return true;
        }
        barn.cows++;
        MowProgress.denChanged();
        GameAnalytics.den(this.def.id, `cow-${String(barn.cows).padStart(2, '0')}`);
        this.hooks.xp('hen');
        MowAudio.play('buyFanfare');
        this.hooks.say('NEW COW!', 0x9cff6a);
        this.refreshStalls();
        this.popIn(this.stalls[i].cow.object);
        this.stalls[i].timer = this.def.loop.milkEverySec;
        return true;
    }

    /** On the dock's square (before it's bought): money pours in; paid, the trucks start coming. */
    private buyDock(delta: number, p: { x: number; z: number }): void {
        const dock = this.def.trucks;
        const barn = MowProgress.barn;
        if (!dock || barn.dock || !this.lessonDone) return;
        const on = Math.abs(p.x - (dock.x - this.def.x)) <= 0.8 && Math.abs(p.z - (dock.z - this.def.z)) <= 0.8;
        if (!on) return;
        if (!this.pourInto(`${this.def.id}-dock`, dock.price, dock.level, new THREE.Vector3(dock.x, 0.1, dock.z), delta, 'THE TRUCKS')) return;
        barn.dock = true;
        MowProgress.denChanged();
        GameAnalytics.den(this.def.id, 'dock');
        MowAudio.play('buyFanfare');
        this.hooks.say('TRUCKS ARE COMING!', 0x9cff6a);
        this.startTrucks();
    }

    private onCowSquare(p: { x: number; z: number }): boolean {
        const i = MowProgress.barn.cows;
        return !!this.def.loop.cows[i] && Math.hypot(p.x - this.stalls[i].x, p.z - (-this.layoutOf.hd + SPOT_Z)) <= 0.75;
    }

    /** On the belt's square (every cow owned): money pours in; paid, the belt pops in and runs. */
    private buyBelt(delta: number, p: { x: number; z: number }): void {
        const config = this.def.loop.belt;
        const barn = MowProgress.barn;
        if (!config || barn.belt || barn.cows < Math.min(BELT_AFTER_COWS, this.def.loop.cows.length)) return;
        const { beltBuy } = this.layoutOf;
        if (!this.onSquare(p, beltBuy)) return;
        if (!this.pourInto(`${this.def.id}-belt`, config.price, config.level, this.world(beltBuy.x, 0.1, beltBuy.z), delta, 'THE CONVEYOR')) return;
        barn.belt = true;
        MowProgress.denChanged();
        GameAnalytics.den(this.def.id, 'belt');
        MowAudio.play('buyFanfare');
        this.hooks.say('CONVEYOR BELT!', 0x9cff6a);
        this.buildBelt();
        this.belt!.group.scale.setScalar(0.01);
        gsap.to(this.belt!.group.scale, { x: 1, y: 1, z: 1, duration: 0.6, ease: 'back.out(2)' });
    }

    // ---------------------------------------------------------------- the belt

    /**
     * The belt: along the front of the milk spots (west to east), round the east end, back west behind the machines to
     * between them. Milk joins it from each spot (where it passes nearest), rides to its end and is split between the
     * churn and the press, taking turns (a full one skipped; both full: it waits at the end).
     */
    private buildBelt(): void {
        if (this.belt) return;
        const { hw, hd, machines } = this.layoutOf;
        const rowZ = -hd + SPOT_Z + 0.95;
        const backZ = machines.butter.z - 1.2;
        // The path drawn in the editor (parts.belt, 2+ points), else along the milk spots and round behind the machines.
        const drawn = this.def.parts?.belt;
        this.beltPath = drawn && drawn.length >= 2 ? drawn.map((p) => new THREE.Vector2(p.x, p.z)) : [
            new THREE.Vector2(-hw + 1.2, rowZ), new THREE.Vector2(hw - 1.5, rowZ),
            new THREE.Vector2(hw - 1.5, backZ), new THREE.Vector2(0, backZ),
        ];
        this.belt = new ConveyorBelt(this.group, this.beltPath, this.material(0x6a6f7a, { metalness: 0.3 }), this.material(0x4a4a52));
        this.beltTake = this.stalls.map((_, i) => i * 0.15);
    }

    /** How far along the belt is nearest to (x, z) (den-local). */
    private nearestAlong(x: number, z: number): number {
        let best = 0;
        let bestDistance = Infinity;
        let from = 0;
        for (let i = 1; i < this.beltPath.length; i++) {
            const a = this.beltPath[i - 1];
            const b = this.beltPath[i];
            const ab = b.clone().sub(a);
            const length = ab.length();
            const t = length > 0 ? Math.min(1, Math.max(0, ((x - a.x) * ab.x + (z - a.y) * ab.y) / (length * length))) : 0;
            const distance = Math.hypot(a.x + ab.x * t - x, a.y + ab.y * t - z);
            if (distance < bestDistance) {
                bestDistance = distance;
                best = from + length * t;
            }
            from += length;
        }
        return best;
    }

    private beltLoop(delta: number): void {
        const belt = this.belt;
        const config = this.def.loop.belt;
        if (!belt || !config) return;
        belt.update(delta, config.speed, config.spacing, () => false);
        const barn = MowProgress.barn;
        const { hd } = this.layoutOf;
        // The spots send their milk on, each where the belt passes nearest (when there's room there).
        this.stalls.forEach((stall, i) => {
            if (i >= barn.cows || (barn.floor[i] ?? 0) <= 0) return;
            this.beltTake[i] -= delta;
            if (this.beltTake[i] > 0) return;
            const s = this.nearestAlong(stall.x, -hd + SPOT_Z);
            if (this.beltMilk.some((milk) => Math.abs(milk.s - s) < config.spacing)) return;
            this.beltTake[i] = config.takeSec;
            barn.floor[i]--;
            MowProgress.denChanged();
            this.refreshStalls();
            const object = farmItem('milk');
            belt.at(s, object.position);
            this.group.add(object);
            this.beltMilk.push({ s, object });
        });
        // Along it, `spacing` apart; the first at the end goes into a machine with room (taking turns).
        this.beltMilk.sort((a, b) => b.s - a.s);
        let ahead = Infinity;
        for (const milk of this.beltMilk) {
            milk.s = Math.max(0, Math.min(belt.total, ahead - config.spacing, milk.s + config.speed * delta));
            ahead = milk.s;
            belt.at(milk.s, milk.object.position);
        }
        const first = this.beltMilk[0];
        if (!first || first.s < belt.total - 1e-3) return;
        const order: Product[] = this.nextMachine === 'butter' ? ['butter', 'cheese'] : ['cheese', 'butter'];
        const product = order.find((p) => barn[p === 'butter' ? 'butterIn' : 'cheeseIn'] < this.def.loop[p].max);
        if (!product) return;
        this.nextMachine = product === 'butter' ? 'cheese' : 'butter';
        this.beltMilk.shift();
        first.object.removeFromParent();
        barn[product === 'butter' ? 'butterIn' : 'cheeseIn']++;
        MowProgress.denChanged();
        const m = this.layoutOf.machines[product];
        this.hooks.effects.toss(this.world(first.object.position.x, BELT_SHAPE.top + 0.2, first.object.position.z), this.world(m.x, 1.3, m.z),
            new THREE.Color(0xfafaf6), 0, () => {}, farmItem('milk'));
    }

    public destroy(): void {
        gsap.killTweensOf(this.sign.scale);
        for (const stall of this.stalls) {
            gsap.killTweensOf(stall.cow.object.scale);
            stall.cow.destroy();
        }
        this.customers?.destroy();
        this.trucks?.destroy();
        this.belt?.destroy();
        this.helper?.destroy();
        this.truckHelper?.destroy();
        this.group.removeFromParent();
    }
}

