// ChickenDen.ts
//
// The farm test's chicken den (TOWN.farm.dens, tuned by TOWN.farm.eggs): a fenced yard of bare earth deep in the grass
// with a gate on its south side. It's there from the start but out of reach (tough grass all round it); mowed up to its
// gate, it opens (open()) and the first hen is in. Inside, the player walks without the mower. The loop:
//   - Hens (the library's chick) sit on nests in front of a hen house along the back. Each lays an egg every
//     layEverySec onto the floor in front of its nest, up to floorMax there.
//   - Walking up to a nest's eggs picks them up into the backpack (up to carryMax den goods).
//   - The packing machine (the blue box) takes eggs on its square (dashed outline, west of it); it packs eggsPerTray
//     eggs into a tray every packSec and slides it out onto its grid (east of it, two trays a slot).
//   - Standing on the grid picks the trays up.
//   - Customers queue outside the west fence at the SELL counter (Customers.ts); standing on the SELL square hands
//     them trays. Served, they pay: the cash lands on the cash square (a pile of notes) by the gate.
//   - Standing on the cash square picks the money up. Money (and a level) buys the next hen: its nest's square
//     shows the price and the level it takes.
//   - Later, the truck dock (TOWN.farm.trucks, bought the same way): trucks come along the roads from a `trucks` spawn
//     area (Trucks.ts), park by the dock's square and take a big load of trays handed over there; they pay onto the
//     cash square. Customers come from the `people` spawn areas (popping in), up the path to the counter.
// Everything that's kept (hens, the eggs on the floor, in the machine, the trays, the cash) is in MowProgress.den.

import * as THREE from 'three';
import gsap from 'gsap';
import { BendService } from '../services/BendService';
import { DenDef, EggLoopDef, TruckDockDef } from '../data/MowConfig';
import { MowProgress } from '../data/MowProgress';
import { CanvasArt } from '../ui/CanvasArt';
import { Animal, farmItem, ITEM_HEIGHT } from '../farm/FarmModels';
import { Customers } from '../farm/Customers';
import { Trucks } from '../farm/Trucks';
import { spawnPoint, truckRoutes } from '../farm/Roads';
import type { MowEffects } from '../vfx/MowEffects';
import { MowAudio } from '../audio/MowAudio';
import type { Box } from './GuidePath';

const FENCE_HEIGHT = 0.8;
const POST_SPACING = 1.1;
const WOOD = 0x9a6a3e;
/** The hen house along the back: its depth, wall height; the nests in front of it and the egg spots in front of those. */
const HOUSE = { depth: 1.4, wall: 1.25 };
const NEST_Z = 1.95;
const EGG_Z = 3.05;
const HEN_HEIGHT = 0.7;
/** Within this of a square's middle counts as on it (half its size), for the round ones (nest eggs) a radius. */
const EGG_REACH = 0.85;
/** Seconds between items moved (one at a time, so they fly in a stream). */
const PICK_EGG_SEC = 0.1;
const DROP_EGG_SEC = 0.07;
const PICK_TRAY_SEC = 0.14;
const SELL_TRAY_SEC = 0.22;
/** Money per note bundle drawn on the cash square, and the most drawn. */
const CASH_PER_BUNDLE = 5;
const MAX_BUNDLES = 30;
/** A hen bought: the money pours into its square over this long. */
const BUY_SEC = 0.6;

/** The den's parts, in its own frame (origin at its middle, +Z toward the gate). */
interface Layout {
    hw: number;
    hd: number;
    nests: number[];
    machine: { x: number; z: number };
    input: { x: number; z: number; w: number; d: number };
    grid: { x: number; z: number; cols: number; rows: number; cell: number };
    counter: { x: number; z: number };
    sell: { x: number; z: number; w: number; d: number };
    cash: { x: number; z: number; w: number; d: number };
}

function layout(def: DenDef, hens: number, slots: number): Layout {
    const hw = def.width / 2;
    const hd = def.depth / 2;
    const spacing = (def.width - 3) / hens;
    const rows = Math.ceil(slots / 2);
    return {
        hw, hd,
        nests: Array.from({ length: hens }, (_, i) => -hw + 1.5 + spacing * (i + 0.5)),
        machine: { x: 2.4, z: 0.9 },
        input: { x: 0.45, z: 0.9, w: 1.5, d: 1.5 },
        grid: { x: 4.6, z: 0.9, cols: 2, rows, cell: 0.62 },
        counter: { x: -hw + 0.55, z: 0.6 },
        sell: { x: -hw + 1.85, z: 0.6, w: 1.5, d: 2 },
        cash: { x: -hw + 1.85, z: hd - 1.35, w: 1.5, d: 1.5 },
    };
}

/** A floor square: an outline (dashed or not) with a word or an icon, on a dark wash. */
function squareTexture(width: number, height: number, color: string, opts: { text?: string; icon?: string; egg?: boolean; dashed?: boolean; sub?: string; subColor?: string }): THREE.CanvasTexture {
    const scale = 128;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const g = canvas.getContext('2d')!;
    const pad = 10;
    g.beginPath();
    g.roundRect(pad, pad, canvas.width - pad * 2, canvas.height - pad * 2, 30);
    g.fillStyle = 'rgba(25, 35, 30, 0.35)';
    g.fill();
    g.lineWidth = 12;
    g.strokeStyle = color;
    if (opts.dashed) g.setLineDash([26, 18]);
    g.stroke();
    g.setLineDash([]);
    const cx = canvas.width / 2;
    const cy = canvas.height / 2 - (opts.sub ? 18 : 0);
    if (opts.icon) CanvasArt.drawIcon(g, opts.icon, cx, cy, Math.min(canvas.width, canvas.height) * 0.45);
    if (opts.egg) {
        g.fillStyle = '#fff3d6';
        g.strokeStyle = '#1d140e';
        g.lineWidth = 8;
        g.beginPath();
        g.ellipse(cx, cy - 24, 30, 40, 0, 0, Math.PI * 2);
        g.fill();
        g.stroke();
    }
    if (opts.text) CanvasArt.text(g, opts.text, cx, cy, Math.min(64, canvas.width * 0.3), '#ffffff', canvas.width - 40);
    if (opts.sub) CanvasArt.text(g, opts.sub, cx, canvas.height - 48, 40, opts.subColor ?? '#ffe27a', canvas.width - 30);
    return CanvasArt.texture(canvas);
}

function signTexture(name: string, locked: boolean): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 448;
    canvas.height = 96;
    const g = canvas.getContext('2d')!;
    CanvasArt.plaque(g, 6, 6, 436, 84, 20);
    if (locked) {
        CanvasArt.drawIcon(g, 'Icon_Lock03', 50, 48, 52);
        CanvasArt.text(g, name, 250, 50, 40, '#ffe27a', 330);
    } else {
        CanvasArt.text(g, name, 224, 50, 42, '#9cff6a', 400);
    }
    return CanvasArt.texture(canvas);
}

/** A small counter over the machine: eggs inside / what it holds. */
function counterTexture(canvas: HTMLCanvasElement, eggs: number, max: number): void {
    const g = canvas.getContext('2d')!;
    g.clearRect(0, 0, canvas.width, canvas.height);
    CanvasArt.plaque(g, 4, 4, canvas.width - 8, canvas.height - 8, 18);
    g.fillStyle = '#fff3d6';
    g.strokeStyle = '#b9925a';
    g.lineWidth = 3;
    g.beginPath();
    g.ellipse(40, 46, 13, 17, 0, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    CanvasArt.text(g, `${eggs}/${max}`, 128, 48, 40, eggs >= max ? '#ff8a7a' : '#ffffff', 150);
}

interface Nest {
    x: number;
    hen: Animal;
    /** Its square for buying it (shown while it's the next to buy). */
    buy: THREE.Mesh;
    buyDrawn: string;
    lock: THREE.Sprite;
    /** The eggs on its floor spot (drawn). */
    eggs: THREE.Group;
    layTimer: number;
}

export interface DenHooks {
    effects: MowEffects;
    /** Where things fly to on the player (the backpack's top) and from. */
    carryPoint: () => THREE.Vector3;
    say: (text: string, color: number) => void;
    xp: (kind: 'egg' | 'tray' | 'traySold' | 'hen') => void;
}

export class ChickenDen {
    private readonly group = new THREE.Group();
    private readonly layoutOf: Layout;
    private readonly nests: Nest[] = [];
    private readonly sign: THREE.Sprite;
    private readonly redraws: (() => void)[] = [];
    private readonly trayStack = new THREE.Group();
    private readonly cashPile = new THREE.Group();
    /** The truck's own cash square and pile (by the dock: TruckDockDef.cash), and the bundles drawn on each pile. */
    private readonly truckPile = new THREE.Group();
    private shownTruckCash = -1;
    private readonly machineBody = new THREE.Group();
    private readonly machineCanvas = document.createElement('canvas');
    private machineTexture!: THREE.CanvasTexture;
    private machineDrawn = '';
    private customers?: Customers;
    /** The truck dock: its square (shows its price until bought), the trucks once it's open. */
    private dockSquare?: THREE.Mesh;
    private dockDrawn = '';
    private trucks?: Trucks;
    private dockBuyTime = 0;
    private dockTold = false;
    private truckTimer = 0;
    private opened: boolean;
    /** Timers for moving items one at a time, and the machine's packing. */
    private pickTimer = 0;
    private dropTimer = 0;
    private trayTimer = 0;
    private sellTimer = 0;
    private packTimer = 0;
    /** A hen being bought (its nest), and how far through the payment. */
    private buying = -1;
    private buyTime = 0;
    private shownTrays = -1;
    private shownCash = -1;
    /** Said once per visit to a hen's square (can't buy it yet). */
    private toldShort = -1;

    public constructor(threeScene: THREE.Scene, public readonly def: DenDef, private readonly config: EggLoopDef, found: boolean,
        private readonly hooks: DenHooks, private readonly dock?: TruckDockDef, private readonly truckPath?: { x: number; z: number }[]) {
        this.opened = found;
        const den = MowProgress.den;
        if (found && den.hens < 1) den.hens = 1;
        while (den.floor.length < config.hens.length) den.floor.push(0);
        this.layoutOf = layout(def, config.hens.length, config.traySlots);
        this.group.position.set(def.x, 0, def.z);
        this.buildFloor();
        this.buildFence();
        this.buildHouse();
        this.buildNests();
        this.buildMachine();
        this.buildCounter();
        this.trayStack.position.set(this.layoutOf.grid.x, 0.06, this.layoutOf.grid.z);
        this.group.add(this.trayStack);
        this.cashPile.position.set(this.layoutOf.cash.x, 0.06, this.layoutOf.cash.z);
        this.group.add(this.cashPile);
        this.sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: signTexture(def.name.toUpperCase(), !found), depthWrite: false }));
        this.sign.scale.set(4.2, 0.9, 1);
        this.sign.position.set(0, 2.5, this.layoutOf.hd);
        // Over the floor squares (they're transparent too, drawn in order): last.
        this.sign.renderOrder = 20;
        this.group.add(this.sign);
        this.redraws.push(() => {
            this.sign.material.map = signTexture(def.name.toUpperCase(), !this.opened);
            this.sign.material.needsUpdate = true;
        });
        window.setTimeout(() => this.redraws.forEach((redraw) => redraw()), 1500);
        threeScene.add(this.group);
        if (dock) {
            this.dockSquare = this.decal(new THREE.Texture(), 1.6, 1.6, dock.x - def.x, dock.z - def.z);
            const cash = this.truckCash;
            const square = () => squareTexture(1.5, 1.5, '#4fe3ff', { icon: 'ItemIcon_Money_Bill' });
            const mesh = this.decal(square(), 1.5, 1.5, cash.x, cash.z);
            mesh.visible = false;
            this.truckCashSquare = mesh;
            this.redraws.push(() => {
                (mesh.material as THREE.MeshBasicMaterial).map = square();
                (mesh.material as THREE.MeshBasicMaterial).needsUpdate = true;
            });
            this.truckPile.position.set(cash.x, 0.06, cash.z);
            this.group.add(this.truckPile);
        }
        if (found) this.startCustomers(threeScene);
        if (found && den.dock) this.startTrucks(threeScene);
        this.threeScene = threeScene;
        this.refreshNests();
    }

    private readonly threeScene: THREE.Scene;

    /** Its fences, hen house, nests, machine and counter (solid), and its floor and the customers' path (bare). */
    public static boxes(def: DenDef, config: EggLoopDef): { solid: Box[]; bare: Box[] } {
        const l = layout(def, config.hens.length, config.traySlots);
        const { hw, hd } = l;
        const side = (hw - def.gate / 2) / 2;
        const at = (x: number, z: number, halfX: number, halfZ: number): Box => ({ x: def.x + x, z: def.z + z, halfX, halfZ });
        const solid: Box[] = [
            at(0, -hd, hw, 0.15),
            at(-hw, 0, 0.15, hd),
            at(hw, 0, 0.15, hd),
            at(-hw + side, hd, side, 0.15),
            at(hw - side, hd, side, 0.15),
            at(0, -hd + (NEST_Z + 0.45) / 2, hw - 0.4, (NEST_Z + 0.45) / 2),
            at(l.machine.x, l.machine.z, 0.75, 0.6),
            at(l.counter.x, l.counter.z, 0.4, 1.1),
        ];
        const bare: Box[] = [
            at(0, 0, hw + 0.2, hd + 0.2),
            // The customers' path outside the west fence.
            at(-hw - 1.2, 1.2, 1.1, hd - 0.6),
        ];
        return { solid, bare };
    }

    public gate(out = new THREE.Vector3()): THREE.Vector3 {
        return out.set(this.def.x, 0, this.def.z + this.def.depth / 2);
    }

    /** The player is at the gate (mowed their way up to it), or already in. */
    public reached(x: number, z: number): boolean {
        const { hw, hd } = this.layoutOf;
        const atGate = Math.abs(x - this.def.x) <= this.def.gate / 2 + 0.4 && Math.abs(z - (this.def.z + hd)) <= 0.9;
        return atGate || (Math.abs(x - this.def.x) < hw && Math.abs(z - this.def.z) < hd);
    }

    /** Inside its fence (on foot here). */
    public inside(x: number, z: number): boolean {
        const { hw, hd } = this.layoutOf;
        return Math.abs(x - this.def.x) < hw - 0.1 && Math.abs(z - this.def.z) < hd - 0.05;
    }

    public get isOpen(): boolean {
        return this.opened;
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

    /** A flat square on the floor with a texture, drawn over the earth (transparent, in order). */
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

    private buildFloor(): void {
        const { hw, hd } = this.layoutOf;
        const geometry = new THREE.PlaneGeometry(hw * 2, hd * 2, Math.ceil(hw * 4), Math.ceil(hd * 4));
        geometry.rotateX(-Math.PI / 2);
        const floor = new THREE.Mesh(geometry, this.material(0x7a5b44, { roughness: 1 }));
        floor.position.y = 0.04;
        this.group.add(floor);
        // The customers' path: a strip of the same earth outside the west fence.
        const path = new THREE.PlaneGeometry(2.2, hd * 2 - 1.2, 4, Math.ceil(hd * 4));
        path.rotateX(-Math.PI / 2);
        const strip = new THREE.Mesh(path, this.material(0x86664c, { roughness: 1 }));
        strip.position.set(-hw - 1.2, 0.035, 1.2);
        this.group.add(strip);
    }

    private buildFence(): void {
        const { hw, hd } = this.layoutOf;
        const wood = this.material(WOOD);
        const post = new THREE.BoxGeometry(0.16, FENCE_HEIGHT, 0.16);
        const addPost = (x: number, z: number, height = FENCE_HEIGHT) => {
            const mesh = new THREE.Mesh(post, wood);
            mesh.scale.y = height / FENCE_HEIGHT;
            mesh.position.set(x, height / 2, z);
            this.group.add(mesh);
        };
        const rail = (ax: number, az: number, bx: number, bz: number) => {
            const length = Math.hypot(bx - ax, bz - az);
            for (const y of [0.35, 0.68]) {
                const mesh = this.box(length, 0.09, 0.07, wood, (ax + bx) / 2, y, (az + bz) / 2);
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
        addPost(-gate, hd, 2.1);
        addPost(gate, hd, 2.1);
        this.box(this.def.gate + 0.4, 0.16, 0.18, wood, 0, 2.05, hd);
    }

    /**
     * The hen house along the back fence: plank walls (a darker plank every so often), a white trim, a red gable roof
     * with its ridge along the house and eaves overhanging the front, and a round hole over each nest.
     */
    private buildHouse(): void {
        const { hw, hd } = this.layoutOf;
        const length = hw * 2 - 0.6;
        const back = -hd + 0.15;
        const front = back + HOUSE.depth;
        const middle = (back + front) / 2;
        this.box(length, HOUSE.wall, HOUSE.depth, 0xd29a5c, 0, HOUSE.wall / 2, middle);
        for (let x = -length / 2 + 0.5; x < length / 2; x += 0.55) this.box(0.05, HOUSE.wall, 0.02, 0xa8703e, x, HOUSE.wall / 2, front + 0.005);
        this.box(length + 0.06, 0.1, HOUSE.depth + 0.06, 0xf4f1ea, 0, HOUSE.wall, middle);
        // The gable: a triangle (across the house's depth) pushed along its length, its two slopes red with an overhang.
        const rise = 0.75;
        const halfDepth = HOUSE.depth / 2 + 0.35;
        const shape = new THREE.Shape();
        shape.moveTo(-halfDepth, 0);
        shape.lineTo(halfDepth, 0);
        shape.lineTo(0, rise);
        shape.closePath();
        const roofGeometry = new THREE.ExtrudeGeometry(shape, { depth: length + 0.5, bevelEnabled: false });
        roofGeometry.translate(0, 0, -(length + 0.5) / 2);
        roofGeometry.rotateY(Math.PI / 2);
        const roof = new THREE.Mesh(roofGeometry, this.material(0xd9583b));
        roof.position.set(0, HOUSE.wall + 0.05, middle);
        this.group.add(roof);
        this.box(length + 0.55, 0.12, 0.16, 0xa8402b, 0, HOUSE.wall + 0.05 + rise, middle);
        const hole = this.material(0x3a2618);
        for (const x of this.layoutOf.nests) {
            const door = new THREE.Mesh(new THREE.CircleGeometry(0.22, 16), hole);
            door.position.set(x, HOUSE.wall * 0.62, front + 0.012);
            this.group.add(door);
        }
    }

    private buildNests(): void {
        const { hd } = this.layoutOf;
        const straw = this.material(0xe8c25a);
        const lock = () => {
            const canvas = document.createElement('canvas');
            canvas.width = 128;
            canvas.height = 128;
            CanvasArt.drawIcon(canvas.getContext('2d')!, 'Icon_Lock03', 64, 64, 112);
            return CanvasArt.texture(canvas);
        };
        const lockTexture = lock();
        this.layoutOf.nests.forEach((x, i) => {
            const z = -hd + NEST_Z;
            this.box(1.2, 0.42, 0.85, 0x8a5a32, x, 0.21, z);
            const bed = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.46, 0.1, 12), straw);
            bed.position.set(x, 0.46, z);
            this.group.add(bed);
            const hen = new Animal('animals/animal-chick.glb', HEN_HEIGHT);
            hen.object.position.set(x, 0.48, z);
            this.group.add(hen.object);
            // The spot the eggs drop to: a straw mat.
            const mat = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.03, 16), straw);
            mat.position.set(x, 0.05, -hd + EGG_Z);
            this.group.add(mat);
            const eggs = new THREE.Group();
            eggs.position.set(x, 0.065, -hd + EGG_Z);
            this.group.add(eggs);
            const buy = this.decal(new THREE.Texture(), 1.4, 1.4, x, -hd + EGG_Z);
            const padlock = new THREE.Sprite(new THREE.SpriteMaterial({ map: lockTexture, depthWrite: false }));
            padlock.scale.set(0.7, 0.7, 1);
            padlock.position.set(x, 1.3, z);
            padlock.renderOrder = 20;
            this.group.add(padlock);
            this.nests.push({ x, hen, buy, buyDrawn: '', lock: padlock, eggs, layTimer: this.config.layEverySec * (0.4 + i * 0.25) });
        });
        this.redraws.push(() => {
            CanvasArt.forgetIcon('Icon_Lock03');
            const fresh = lock();
            for (const nest of this.nests) {
                nest.lock.material.map = fresh;
                nest.lock.material.needsUpdate = true;
                nest.buyDrawn = '';
            }
            this.refreshNests();
        });
    }

    /** The packing machine: a blue box with a hopper on top and a chute out to its grid, its egg counter over it. */
    private buildMachine(): void {
        const { machine, input, grid } = this.layoutOf;
        this.machineBody.position.set(machine.x, 0, machine.z);
        this.group.add(this.machineBody);
        this.box(1.4, 0.95, 1.1, 0x3f7fe0, 0, 0.5, 0, this.machineBody);
        this.box(1.46, 0.12, 1.16, 0x2f5fb0, 0, 0.06, 0, this.machineBody);
        this.box(0.9, 0.35, 0.8, 0xdfe6ee, -0.1, 1.15, 0, this.machineBody);
        this.box(0.7, 0.05, 0.6, 0x2a3440, -0.1, 1.33, 0, this.machineBody);
        // The chute toward the grid (east), and a plate with an egg-to-tray sign on the front.
        this.box(0.5, 0.12, 0.55, 0xdfe6ee, 0.85, 0.42, 0, this.machineBody);
        this.box(0.6, 0.35, 0.03, 0xf4f1ea, 0, 0.62, 0.56, this.machineBody);
        this.machineCanvas.width = 220;
        this.machineCanvas.height = 96;
        this.machineTexture = CanvasArt.texture(this.machineCanvas);
        const counter = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.machineTexture, depthWrite: false }));
        counter.scale.set(1.3, 0.57, 1);
        counter.position.set(machine.x, 2.0, machine.z);
        counter.renderOrder = 20;
        this.group.add(counter);
        // Its squares: eggs in (dashed), trays out (a grid).
        const eggIn = () => squareTexture(input.w, input.d, '#ffffff', { egg: true, dashed: true, sub: 'EGGS', subColor: '#ffffff' });
        const inSquare = this.decal(eggIn(), input.w, input.d, input.x, input.z);
        this.redraws.push(() => {
            (inSquare.material as THREE.MeshBasicMaterial).map = eggIn();
            (inSquare.material as THREE.MeshBasicMaterial).needsUpdate = true;
        });
        const gridCanvas = document.createElement('canvas');
        const scale = 128;
        gridCanvas.width = grid.cols * grid.cell * scale;
        gridCanvas.height = grid.rows * grid.cell * scale;
        const g = gridCanvas.getContext('2d')!;
        g.strokeStyle = '#4fe3ff';
        g.lineWidth = 8;
        g.fillStyle = 'rgba(25, 35, 30, 0.35)';
        for (let r = 0; r < grid.rows; r++) {
            for (let c = 0; c < grid.cols; c++) {
                g.beginPath();
                g.roundRect(c * grid.cell * scale + 6, r * grid.cell * scale + 6, grid.cell * scale - 12, grid.cell * scale - 12, 14);
                g.fill();
                g.stroke();
            }
        }
        this.decal(CanvasArt.texture(gridCanvas), grid.cols * grid.cell, grid.rows * grid.cell, grid.x, grid.z);
    }

    /** The sell counter by the west fence, its SELL square, and the cash square by the gate. */
    private buildCounter(): void {
        const { counter, sell, cash } = this.layoutOf;
        this.box(0.8, 0.85, 2.2, 0x8a5a32, counter.x, 0.42, counter.z);
        this.box(0.95, 0.12, 2.35, 0x4f8fe0, counter.x, 0.9, counter.z);
        this.box(0.32, 0.2, 0.26, 0x6a6f7a, counter.x, 1.06, counter.z + 0.4);
        const sellSquare = () => squareTexture(sell.w, sell.d, '#4fe3ff', { text: 'SELL' });
        const sellMesh = this.decal(sellSquare(), sell.w, sell.d, sell.x, sell.z);
        const cashSquare = () => squareTexture(cash.w, cash.d, '#4fe3ff', { icon: 'ItemIcon_Money_Bill' });
        const cashMesh = this.decal(cashSquare(), cash.w, cash.d, cash.x, cash.z);
        this.redraws.push(() => {
            CanvasArt.forgetIcon('ItemIcon_Money_Bill');
            for (const [mesh, draw] of [[sellMesh, sellSquare], [cashMesh, cashSquare]] as const) {
                (mesh.material as THREE.MeshBasicMaterial).map = draw();
                (mesh.material as THREE.MeshBasicMaterial).needsUpdate = true;
            }
        });
    }

    private startCustomers(threeScene: THREE.Scene): void {
        if (this.customers) return;
        const { counter, hw, hd } = this.layoutOf;
        const x = this.def.x - hw - 1.1;
        const slots = Array.from({ length: this.config.queue }, (_, i) => new THREE.Vector3(x, 0, this.def.z + counter.z + i * 1.5));
        // Through the path's end, from the `people` spawn areas (or straight from the path's end without one).
        const entry = new THREE.Vector3(x, 0, this.def.z + hd + 0.4);
        this.customers = new Customers(threeScene, slots, entry, () => spawnPoint('people') ?? entry.clone(), new THREE.Vector3(1, 0, 0),
            { wants: this.config.wants, queue: this.config.queue, everySec: this.config.customerEverySec });
    }

    /** The trucks: from a `trucks` spawn area over the roads to the road nearest the dock's square. */
    private startTrucks(threeScene: THREE.Scene): void {
        const dock = this.dock;
        if (this.trucks || !dock) return;
        // The level's truck path (the editor's): in along it, back the same way.
        const own = this.truckPath ?? [];
        if (own.length >= 2) {
            const path = own.map((p) => new THREE.Vector3(p.x, 0, p.z));
            const last = path[path.length - 1];
            const before = path[path.length - 2];
            this.trucks = new Trucks(threeScene, dock, path, [...path].reverse(), Math.atan2(last.x - before.x, last.z - before.z));
            return;
        }
        const at = new THREE.Vector3(dock.x, 0, dock.z);
        const from = spawnPoint('trucks', at);
        const routes = from ? truckRoutes(from, at) : null;
        if (!from || !routes || routes.inbound.length < 2) {
            console.warn('[ChickenDen] the trucks need a path (the editor\'s 🚚 Truck path points), or a `trucks` spawn area and roads joining it to the dock');
            return;
        }
        const path = [from, ...routes.inbound];
        const last = path[path.length - 1];
        const before = path[path.length - 2];
        this.trucks = new Trucks(threeScene, dock, path, [...routes.outbound, from], Math.atan2(last.x - before.x, last.z - before.z));
    }

    // ---------------------------------------------------------------- state shown

    /** The nests: hens owned shown (white, laying), the next one's square to buy it, the rest padlocked. */
    private refreshNests(): void {
        const den = MowProgress.den;
        const owned = this.opened ? den.hens : 0;
        this.nests.forEach((nest, i) => {
            const has = i < owned;
            nest.hen.object.visible = has;
            nest.lock.visible = !has;
            const next = this.opened && i === owned;
            nest.buy.visible = next;
            if (next) {
                const hen = this.config.hens[i];
                const short = MowProgress.level < hen.level;
                const key = `${hen.price}|${short}`;
                if (key !== nest.buyDrawn) {
                    nest.buyDrawn = key;
                    const material = nest.buy.material as THREE.MeshBasicMaterial;
                    material.map = squareTexture(1.4, 1.4, '#ffffff', {
                        text: `$${hen.price}`, sub: short ? `LEVEL ${hen.level}` : 'NEW HEN', subColor: short ? '#ff8a7a' : '#9cff6a',
                    });
                    material.needsUpdate = true;
                }
            }
            this.drawEggs(nest, has ? den.floor[i] ?? 0 : 0);
        });
    }

    /** The dock's square: its price and level until it's bought, then the truck's square. */
    private refreshDock(): void {
        const dock = this.dock;
        const square = this.dockSquare;
        if (!dock || !square) return;
        square.visible = this.opened;
        const open = !!MowProgress.den.dock;
        const short = MowProgress.level < dock.level;
        const key = `${open}|${short}`;
        if (key === this.dockDrawn) return;
        this.dockDrawn = key;
        const material = square.material as THREE.MeshBasicMaterial;
        material.map = open
            ? squareTexture(1.6, 1.6, '#4fe3ff', { text: 'TRUCK' })
            : squareTexture(1.6, 1.6, '#ffffff', { text: `$${dock.price}`, sub: short ? `LEVEL ${dock.level}` : 'TRUCKS', subColor: short ? '#ff8a7a' : '#9cff6a' });
        material.needsUpdate = true;
    }

    /** A nest's eggs on its mat: up to six in a little heap (two layers of three). */
    private drawEggs(nest: Nest, count: number): void {
        if (nest.eggs.children.length === count) return;
        nest.eggs.clear();
        for (let i = 0; i < count; i++) {
            const egg = farmItem('egg');
            const layer = Math.floor(i / 4);
            const k = i % 4;
            egg.position.set((k % 2 - 0.5) * 0.24 + layer * 0.05, layer * 0.2, (Math.floor(k / 2) - 0.5) * 0.24);
            egg.rotation.z = (i % 3 - 1) * 0.2;
            nest.eggs.add(egg);
        }
    }

    /** The machine's grid: trays two a slot (first layer filled first). */
    private drawTrays(count: number): void {
        if (count === this.shownTrays) return;
        this.shownTrays = count;
        this.trayStack.clear();
        const { grid } = this.layoutOf;
        const slots = grid.cols * grid.rows;
        for (let i = 0; i < count; i++) {
            const slot = i % slots;
            const layer = Math.floor(i / slots);
            const tray = farmItem('tray');
            tray.position.set(((slot % grid.cols) - (grid.cols - 1) / 2) * grid.cell, layer * ITEM_HEIGHT.tray, (Math.floor(slot / grid.cols) - (grid.rows - 1) / 2) * grid.cell);
            this.trayStack.add(tray);
        }
    }

    /** The truck's cash square's middle (den-local): TruckDockDef.cash, else just north of the dock. */
    private get truckCash(): { x: number; z: number; w: number; d: number } {
        const dock = this.dock!;
        const at = dock.cash ?? { x: dock.x, z: dock.z - 1.8 };
        return { x: at.x - this.def.x, z: at.z - this.def.z, w: 1.5, d: 1.5 };
    }

    private truckCashSquare?: THREE.Mesh;

    /** The cash squares: a pile of note bundles each, more the more money is on it. */
    private drawCash(cash: number): void {
        this.shownCash = this.drawPile(this.cashPile, cash, this.shownCash);
        if (this.dock) {
            this.shownTruckCash = this.drawPile(this.truckPile, MowProgress.den.truckCash ?? 0, this.shownTruckCash);
            if (this.truckCashSquare) this.truckCashSquare.visible = this.opened && !!MowProgress.den.dock;
        }
    }

    /** `pile` drawn for `cash` (as many bundles), unless it already shows that many (`shown`); returns how many. */
    private drawPile(pile: THREE.Group, cash: number, shown: number): number {
        const bundles = cash <= 0 ? 0 : Math.min(MAX_BUNDLES, Math.max(1, Math.ceil(cash / CASH_PER_BUNDLE)));
        if (bundles === shown) return shown;
        pile.clear();
        for (let i = 0; i < bundles; i++) {
            const bundle = farmItem('cash');
            const k = i % 6;
            const layer = Math.floor(i / 6);
            bundle.position.set(((k % 2) - 0.5) * 0.4, layer * ITEM_HEIGHT.cash, (Math.floor(k / 2) - 1) * 0.22);
            bundle.rotation.y = Math.sin(i * 1.7) * 0.15;
            pile.add(bundle);
        }
        return bundles;
    }

    private drawMachine(): void {
        const key = `${MowProgress.den.machine}`;
        if (key === this.machineDrawn) return;
        this.machineDrawn = key;
        counterTexture(this.machineCanvas, MowProgress.den.machine, this.config.machineMax);
        this.machineTexture.needsUpdate = true;
    }

    // ---------------------------------------------------------------- opening

    /** Found: the sign loses its lock, the first hen is in, customers start coming. */
    public open(): void {
        if (this.opened) return;
        this.opened = true;
        const den = MowProgress.den;
        if (den.hens < 1) den.hens = 1;
        MowProgress.denChanged();
        this.sign.material.map = signTexture(this.def.name.toUpperCase(), false);
        this.sign.material.needsUpdate = true;
        this.sign.scale.set(0.1, 0.02, 1);
        gsap.to(this.sign.scale, { x: 4.2, y: 0.9, duration: 0.7, ease: 'back.out(2)' });
        this.refreshNests();
        this.popIn(this.nests[0].hen.object);
        this.startCustomers(this.threeScene);
    }

    private popIn(object: THREE.Object3D): void {
        object.scale.setScalar(0.01);
        gsap.to(object.scale, { x: 1, y: 1, z: 1, duration: 0.6, ease: 'back.out(2.5)' });
    }

    // ---------------------------------------------------------------- the loop

    private local(x: number, z: number): { x: number; z: number } {
        return { x: x - this.def.x, z: z - this.def.z };
    }

    private world(x: number, y: number, z: number): THREE.Vector3 {
        return new THREE.Vector3(this.def.x + x, y, this.def.z + z);
    }

    private onSquare(p: { x: number; z: number }, square: { x: number; z: number; w: number; d: number }): boolean {
        return Math.abs(p.x - square.x) <= square.w / 2 && Math.abs(p.z - square.z) <= square.d / 2;
    }

    /** Each frame: hens lay, the machine packs, customers come, and whatever square the player's on does its thing. */
    public update(delta: number, player: THREE.Vector3): void {
        for (const nest of this.nests) nest.hen.update(delta);
        this.customers?.update(delta);
        this.drawMachine();
        this.drawTrays(MowProgress.den.trays);
        this.drawCash(MowProgress.den.cash);
        if (!this.opened) return;
        this.lay(delta);
        this.pack(delta);
        const p = this.local(player.x, player.z);
        this.pickEggs(delta, p);
        this.feedMachine(delta, p);
        this.pickTrays(delta, p);
        this.sell(delta, p);
        this.pickCash(p);
        this.buyHen(delta, p);
        this.refreshDock();
        this.trucks?.update(delta);
        this.dockLoop(delta, p);
    }

    /** Each hen lays on its floor spot (a hop, the egg dropping down), up to floorMax there. */
    private lay(delta: number): void {
        const den = MowProgress.den;
        const { hd } = this.layoutOf;
        this.nests.forEach((nest, i) => {
            if (i >= den.hens) return;
            nest.layTimer -= delta;
            if (nest.layTimer > 0) return;
            nest.layTimer = this.config.layEverySec;
            if ((den.floor[i] ?? 0) >= this.config.floorMax) return;
            den.floor[i] = (den.floor[i] ?? 0) + 1;
            MowProgress.denChanged();
            gsap.fromTo(nest.hen.object.position, { y: 0.48 }, { y: 0.68, duration: 0.15, yoyo: true, repeat: 1, ease: 'power1.out' });
            nest.hen.play('eat');
            gsap.delayedCall(0.8, () => nest.hen.play('idle'));
            const from = this.world(nest.x, 0.7, -hd + NEST_Z);
            const to = this.world(nest.x, 0.08, -hd + EGG_Z);
            this.hooks.effects.toss(from, to, new THREE.Color(0xfff0d0), 0, () => this.refreshNests(), farmItem('egg'));
        });
    }

    /** The machine packs a tray whenever it has the eggs for one and its grid has room. */
    private pack(delta: number): void {
        const den = MowProgress.den;
        const room = this.config.traySlots * 2;
        if (den.machine < this.config.eggsPerTray || den.trays >= room) {
            this.packTimer = 0;
            return;
        }
        this.packTimer += delta;
        // Working: a little shudder.
        this.machineBody.position.x = this.layoutOf.machine.x + Math.sin(this.packTimer * 40) * 0.015;
        if (this.packTimer < this.config.packSec) return;
        this.packTimer = 0;
        den.machine -= this.config.eggsPerTray;
        den.trays++;
        MowProgress.denChanged();
        this.hooks.xp('tray');
        MowAudio.play('build');
        this.machineBody.position.x = this.layoutOf.machine.x;
    }

    /** Next to a nest's eggs: they fly into the backpack, one at a time. */
    private pickEggs(delta: number, p: { x: number; z: number }): void {
        this.pickTimer -= delta;
        if (this.pickTimer > 0 || MowProgress.goodsCount >= this.config.carryMax) return;
        const den = MowProgress.den;
        const { hd } = this.layoutOf;
        const i = this.nests.findIndex((nest, n) => n < den.hens && (den.floor[n] ?? 0) > 0 && Math.hypot(p.x - nest.x, p.z - (-hd + EGG_Z)) <= EGG_REACH);
        if (i < 0) return;
        this.pickTimer = PICK_EGG_SEC;
        den.floor[i]--;
        MowProgress.denChanged();
        MowProgress.carry('eggs', 1);
        this.refreshNests();
        this.hooks.xp('egg');
        this.hooks.effects.pickup(this.world(this.nests[i].x, 0.15, -hd + EGG_Z), new THREE.Color(0xfff0d0), () => MowAudio.play('item'), farmItem('egg'));
    }

    /** On the machine's egg square: the backpack's eggs go into its hopper. */
    private feedMachine(delta: number, p: { x: number; z: number }): void {
        this.dropTimer -= delta;
        const den = MowProgress.den;
        if (this.dropTimer > 0 || MowProgress.goods.eggs <= 0 || den.machine >= this.config.machineMax) return;
        if (!this.onSquare(p, this.layoutOf.input)) return;
        this.dropTimer = DROP_EGG_SEC;
        MowProgress.carry('eggs', -1);
        den.machine++;
        MowProgress.denChanged();
        const { machine } = this.layoutOf;
        this.hooks.effects.toss(this.hooks.carryPoint(), this.world(machine.x - 0.1, 1.35, machine.z), new THREE.Color(0xfff0d0), 0, () => {}, farmItem('egg'));
    }

    /** On the tray grid: the trays fly into the backpack. */
    private pickTrays(delta: number, p: { x: number; z: number }): void {
        this.trayTimer -= delta;
        const den = MowProgress.den;
        if (this.trayTimer > 0 || den.trays <= 0 || MowProgress.goodsCount >= this.config.carryMax) return;
        const { grid } = this.layoutOf;
        if (!this.onSquare(p, { x: grid.x, z: grid.z, w: grid.cols * grid.cell + 0.4, d: grid.rows * grid.cell + 0.4 })) return;
        this.trayTimer = PICK_TRAY_SEC;
        den.trays--;
        MowProgress.denChanged();
        MowProgress.carry('trays', 1);
        this.hooks.effects.pickup(this.world(grid.x, 0.2, grid.z), new THREE.Color(0xe2c48e), () => MowAudio.play('item'), farmItem('tray'));
    }

    /** On the SELL square: trays go to the customer at the counter; their last one paid, the cash lands on its square. */
    private sell(delta: number, p: { x: number; z: number }): void {
        this.sellTimer -= delta;
        const customer = this.customers?.front;
        if (this.sellTimer > 0 || !customer || MowProgress.goods.trays <= 0 || !this.onSquare(p, this.layoutOf.sell)) return;
        this.sellTimer = SELL_TRAY_SEC;
        MowProgress.carry('trays', -1);
        const customers = this.customers!;
        const to = customers.handsOf(customer);
        // Counted as handed over now (so the next one isn't sent for nothing), told when it lands.
        const last = customer.got + 1 >= customer.wants;
        const wants = customer.wants;
        customers.give(customer);
        this.hooks.xp('traySold');
        this.hooks.effects.toss(this.hooks.carryPoint(), to, new THREE.Color(0xe2c48e), 0, () => {
            MowAudio.play('item');
            if (!last) return;
            MowAudio.play('buyCash');
            this.pay(wants * this.config.trayPrice);
        }, farmItem('tray'));
    }

    /** A customer pays: notes fly from the counter onto the cash square. */
    private pay(amount: number): void {
        const den = MowProgress.den;
        den.cash += amount;
        MowProgress.denChanged();
        const { counter, cash } = this.layoutOf;
        const bundles = Math.min(6, Math.ceil(amount / CASH_PER_BUNDLE));
        for (let i = 0; i < bundles; i++) {
            this.hooks.effects.toss(this.world(counter.x, 1.1, counter.z), this.world(cash.x, 0.1, cash.z), new THREE.Color(0x5fc85a), i * 0.06,
                () => MowAudio.play('coins'), farmItem('cash'));
        }
        // The pile grows as they land.
        this.shownCash = -1;
    }

    /** On a cash square (the customers', or the truck's): the money on it is the player's. */
    private pickCash(p: { x: number; z: number }): void {
        const den = MowProgress.den;
        if (this.dock && den.dock && (den.truckCash ?? 0) > 0 && this.onSquare(p, this.truckCash)) {
            const amount = den.truckCash!;
            den.truckCash = 0;
            this.collect(amount, this.truckCash);
        }
        if (den.cash <= 0 || !this.onSquare(p, this.layoutOf.cash)) return;
        const amount = den.cash;
        den.cash = 0;
        this.collect(amount, this.layoutOf.cash);
    }

    /** `amount` taken off the cash square `cash` (den-local): the notes fly to the player. */
    private collect(amount: number, cash: { x: number; z: number }): void {
        MowProgress.denChanged();
        MowProgress.addMoney(amount);
        const bundles = Math.min(8, Math.ceil(amount / CASH_PER_BUNDLE));
        for (let i = 0; i < bundles; i++) {
            this.hooks.effects.pickup(this.world(cash.x, 0.2 + i * 0.05, cash.z), new THREE.Color(0x5fc85a), () => MowAudio.play('coins'), farmItem('cash'));
        }
        this.hooks.effects.floatText(this.world(cash.x, 1.8, cash.z), `+$${amount}`, '#ffe27a');
    }

    /** On the next nest's square: with the money and the level, the money pours in and a new hen pops onto the nest. */
    private buyHen(delta: number, p: { x: number; z: number }): void {
        const den = MowProgress.den;
        const i = den.hens;
        const hen = this.config.hens[i];
        const { hd } = this.layoutOf;
        const on = !!hen && Math.hypot(p.x - this.nests[i].x, p.z - (-hd + EGG_Z)) <= 0.7;
        if (!on) {
            this.buying = -1;
            this.buyTime = 0;
            this.toldShort = -1;
            return;
        }
        if (MowProgress.level < hen.level || MowProgress.money < hen.price) {
            if (this.toldShort !== i) {
                this.toldShort = i;
                this.hooks.say(MowProgress.level < hen.level ? `REACH LEVEL ${hen.level} FOR THIS HEN` : `NEED $${hen.price}`, 0xffd9a8);
            }
            return;
        }
        if (this.buying !== i) {
            this.buying = i;
            this.buyTime = 0;
        }
        this.buyTime += delta;
        const at = this.world(this.nests[i].x, 0.1, -hd + EGG_Z);
        if (Math.floor((this.buyTime - delta) / 0.08) !== Math.floor(this.buyTime / 0.08)) {
            this.hooks.effects.toss(this.hooks.carryPoint(), at, new THREE.Color(0x5fc85a), 0, () => MowAudio.play('coins'), farmItem('cash'));
        }
        if (this.buyTime < BUY_SEC || !MowProgress.spend(hen.price)) return;
        den.hens++;
        MowProgress.denChanged();
        this.buying = -1;
        this.hooks.xp('hen');
        MowAudio.play('buyFanfare');
        this.hooks.say('NEW HEN!', 0x9cff6a);
        this.refreshNests();
        this.popIn(this.nests[i].hen.object);
        this.nests[i].layTimer = this.config.layEverySec;
    }

    /** On the dock's square: bought (money and a level, poured in), then trays handed to the parked truck. */
    private dockLoop(delta: number, p: { x: number; z: number }): void {
        const dock = this.dock;
        if (!dock) return;
        const on = Math.abs(p.x - (dock.x - this.def.x)) <= 0.8 && Math.abs(p.z - (dock.z - this.def.z)) <= 0.8;
        const den = MowProgress.den;
        if (!den.dock) {
            if (!on) {
                this.dockBuyTime = 0;
                this.dockTold = false;
                return;
            }
            if (MowProgress.level < dock.level || MowProgress.money < dock.price) {
                if (!this.dockTold) {
                    this.dockTold = true;
                    this.hooks.say(MowProgress.level < dock.level ? `REACH LEVEL ${dock.level} FOR THE TRUCKS` : `NEED $${dock.price}`, 0xffd9a8);
                }
                return;
            }
            const before = this.dockBuyTime;
            this.dockBuyTime += delta;
            const at = new THREE.Vector3(dock.x, 0.1, dock.z);
            if (Math.floor(before / 0.08) !== Math.floor(this.dockBuyTime / 0.08)) {
                this.hooks.effects.toss(this.hooks.carryPoint(), at, new THREE.Color(0x5fc85a), 0, () => MowAudio.play('coins'), farmItem('cash'));
            }
            if (this.dockBuyTime < BUY_SEC || !MowProgress.spend(dock.price)) return;
            den.dock = true;
            MowProgress.denChanged();
            this.hooks.xp('hen');
            MowAudio.play('buyFanfare');
            this.hooks.say('TRUCKS ARE COMING!', 0x9cff6a);
            this.startTrucks(this.threeScene);
            return;
        }
        this.truckTimer -= delta;
        const trucks = this.trucks;
        if (!on || !trucks?.parked || this.truckTimer > 0 || MowProgress.goods.trays <= 0) return;
        this.truckTimer = SELL_TRAY_SEC * 0.7;
        MowProgress.carry('trays', -1);
        const wants = trucks.wants;
        const last = trucks.give();
        this.hooks.xp('traySold');
        const bed = trucks.bed();
        this.hooks.effects.toss(this.hooks.carryPoint(), bed, new THREE.Color(0xe2c48e), 0, () => {
            MowAudio.play('item');
            if (!last) return;
            MowAudio.play('buyCash');
            this.payFrom(bed, wants * dock.trayPrice);
        }, farmItem('tray'));
    }

    /** A truck's payment: from `from` onto its own cash square by the dock. */
    private payFrom(from: THREE.Vector3, amount: number): void {
        const den = MowProgress.den;
        den.truckCash = (den.truckCash ?? 0) + amount;
        MowProgress.denChanged();
        const cash = this.truckCash;
        const bundles = Math.min(10, Math.ceil(amount / CASH_PER_BUNDLE));
        for (let i = 0; i < bundles; i++) {
            this.hooks.effects.toss(from.clone().setY(from.y + 0.5), this.world(cash.x, 0.1, cash.z), new THREE.Color(0x5fc85a), i * 0.05,
                () => MowAudio.play('coins'), farmItem('cash'));
        }
        this.shownTruckCash = -1;
    }

    public destroy(): void {
        this.trucks?.destroy();
        gsap.killTweensOf(this.sign.scale);
        for (const nest of this.nests) {
            gsap.killTweensOf(nest.hen.object.position);
            gsap.killTweensOf(nest.hen.object.scale);
            nest.hen.destroy();
        }
        this.customers?.destroy();
        this.group.removeFromParent();
    }
}
