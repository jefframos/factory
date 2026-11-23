// CropFarm.ts
//
// The farm test's crop farms (TOWN.farm.cropFarms), one class for any crop (ui/mow.json `crops`): a new farm is a crop
// entry and a farm in the level, no new code. Built like the cow barn (a fenced yard of bare earth, its gate south, out
// of reach behind its grass until it's mowed up to):
//   - Plots along the back, the first free, the rest bought with money and a level on their own square. Each grows
//     plants that ripen every growSec (Farm Speed makes it quicker), `perPick` fruit on them; picked, they grow again.
//   - Walking over a ripe plot picks its fruit into the backpack.
//   - The machine (east of the middle) takes fruit on its square and makes the crop's product (jam...) onto its grid;
//     the fresh crate (west) holds fruit the picker brings. Standing on a grid takes what's on it.
//   - Customers (the people spawn areas, or its peopleIn / peopleOut paths) queue at the counter by the east fence and
//     order fresh fruit, the product or a mix; handed over on SELL they pay onto the cash square.
//   - The harbour: a drop point on the shore (bought like the trucks' dock) that boats sail to along their own path
//     (Trucks, with boat models), dock, order a big mix and sail away, paying onto the harbour's cash square.
//   - The helpers (DenHelper, hired on their squares) make it run alone: the picker takes ripe fruit to the machine and
//     the crate, the counter's helper serves the customers, the boats' helper loads the docked boat; the two sellers
//     take their cash to the player. With all three the farm needs nobody (memory: every shop runs alone).
// Everything kept is MowProgress.cropFarm(id).

import * as THREE from 'three';
import gsap from 'gsap';
import { BendService } from '../services/BendService';
import { CropDef, CropFarmDef, BarnHelperDef, DenPoint, MOW, shortMoney } from '../data/MowConfig';
import { CropFarmState, MowProgress } from '../data/MowProgress';
import { CanvasArt } from '../ui/CanvasArt';
import { GameAnalytics } from '../analytics/GameAnalytics';
import { CropItem, farmItem, FarmItem, farmProp, ITEM_HEIGHT, itemHeight } from '../farm/FarmModels';
import { Customers, Customer, OrderItem, stockDemand } from '../farm/Customers';
import { Trucks } from '../farm/Trucks';
import { spawnPoint } from '../farm/Roads';
import { DenHelper } from '../farm/DenHelper';
import { MowAudio } from '../audio/MowAudio';
import { DenHooks, signTexture, squareTexture } from './ChickenDen';
import type { Box } from './GuidePath';

const FENCE_HEIGHT = 0.9;
const POST_SPACING = 1.2;
const WOOD = 0x8a5a32;
const SOIL = 0x6b4a2e;
/** A plot (square, world units), the gap between plots, its plants (2 x 2). */
const PLOT = 2.4;
const PLOT_GAP = 0.6;
const PLANT_SPREAD = 0.55;
/** Seconds between items moved one at a time. */
const PICK_SEC = 0.12;
const DROP_SEC = 0.07;
const TAKE_SEC = 0.14;
const SELL_SEC = 0.2;
/** The fresh crate holds this many. */
const FRESH_MAX = 40;
/** Money per note bundle drawn on a cash square, and the most drawn. */
const CASH_PER_BUNDLE = 10;
const MAX_BUNDLES = 30;
/** Buying on a square: the whole price in about `seconds`, at least `least` a second; a note flies every `tossSec`. */
const POUR = { seconds: 1.4, least: 25, tossSec: 0.08 };
/** A grid: 2 x 2 slots this big, the goods on it this much bigger than carried ones. */
const GRID_CELL = 0.95;
const GRID_SCALE = 1.4;
/** Its sounds are heard this far past its fence. */
const SOUND_RANGE = 10;
/**
 * Unloading: standing on SELL with goods nobody in the queue wants (or nobody there) for this long, they go back onto
 * their grid one by one (stock the helpers sell later): the player always has somewhere to put things down.
 */
const UNLOAD_WAIT = 0.6;
const UNLOAD_SEC = 0.08;
/** The picker is offered once this many plots are owned. */
const PICKER_AFTER_PLOTS = 3;

type HelperKey = 'picker' | 'helper' | 'boatHelper';

interface Square {
    x: number;
    z: number;
    w: number;
    d: number;
}

interface Layout {
    hw: number;
    hd: number;
    plots: { x: number; z: number }[];
    machine: { x: number; z: number; input: Square; grid: Square };
    fresh: Square;
    counter: { x: number; z: number };
    sell: Square;
    cash: Square;
    hires: Record<HelperKey, Square>;
}

/** Where everything goes (farm-local, +Z toward the gate): plots along the back, the machine east, the crate west. */
function layout(def: CropFarmDef): Layout {
    const hw = def.width / 2;
    const hd = def.depth / 2;
    const cols = Math.max(1, def.cols ?? 4);
    const rowWidth = cols * PLOT + (cols - 1) * PLOT_GAP;
    const parts = def.parts ?? {};
    // A placed part takes its spot (and a square its size when the editor set one); else the farm's own layout.
    const at = <T extends { x: number; z: number; w?: number; d?: number }>(base: T, placed?: DenPoint): T => {
        if (!placed) return base;
        const moved = { ...base, x: placed.x, z: placed.z };
        if (base.w !== undefined && placed.w) moved.w = placed.w;
        if (base.d !== undefined && placed.d) moved.d = placed.d;
        return moved;
    };
    // The plots in rows from the first one's middle (placed, or the back left).
    const first = at({ x: -rowWidth / 2 + PLOT / 2, z: -hd + 1.2 + PLOT / 2 }, parts.plots);
    const plots = def.plots.map((_, i) => ({ x: first.x + (i % cols) * (PLOT + PLOT_GAP), z: first.z + Math.floor(i / cols) * (PLOT + PLOT_GAP) }));
    const rows = Math.ceil(def.plots.length / cols);
    const middle = -hd + 1.2 + rows * (PLOT + PLOT_GAP) + 1.2;
    const machine = at({ x: 2.6, z: middle }, parts.machine);
    return {
        hw, hd, plots,
        machine: { ...machine, input: at({ x: machine.x, z: middle + 2.0, w: 1.6, d: 1.5 }, parts.input), grid: at({ x: 5.3, z: middle, w: GRID_CELL * 2, d: GRID_CELL * 2 }, parts.grid) },
        fresh: at({ x: -2.6, z: middle, w: GRID_CELL * 2, d: GRID_CELL * 2 }, parts.fresh),
        counter: at({ x: hw - 0.55, z: middle }, parts.counter),
        sell: at({ x: hw - 1.85, z: middle, w: 1.5, d: 2 }, parts.sell),
        cash: at({ x: hw - 1.85, z: hd - 1.35, w: 1.5, d: 1.5 }, parts.cash),
        hires: {
            picker: at({ x: -hw + 1.8, z: hd - 1.4, w: 1.6, d: 1.6 }, parts.pickerHire),
            helper: at({ x: hw - 1.85, z: Math.min(hd - 3.2, middle + 2.6), w: 1.6, d: 1.6 }, parts.helperHire),
            boatHelper: { x: 0, z: 0, w: 1.6, d: 1.6 },
        },
    };
}

interface Plot {
    soil: THREE.Mesh;
    plants: THREE.Group[];
    berries: THREE.Group[];
    buy: THREE.Mesh;
    buyDrawn: string;
    /** The pizza game's plot patches once loaded: tilled dirt (owned), a grass patch (not yet). */
    dirt?: THREE.Object3D;
    wild?: THREE.Object3D;
    /** Its plants are the crop's model (loaded): they grow as a whole and go one by one as they're picked. */
    modelled?: boolean;
}

/** The pizza game's plot patches and ship (under models/). */
const PLOT_DIRT = 'farm/plots/patch-dirt.glb';
const PLOT_GRASS = 'farm/plots/patch-grass.glb';
const CRUISE_SHIP = 'town/library/city2-cruise-ship-01/city2-cruise-ship-01.glb';
/** A crop's ripe size on its plot when its def doesn't say (world units). */
const CROP_SIZE = 0.8;

export class CropFarm {
    private readonly group = new THREE.Group();
    private readonly layoutOf: Layout;
    private readonly crop: CropDef;
    private readonly cropItem: CropItem;
    private readonly productItem: CropItem;
    private readonly plots: Plot[] = [];
    private readonly sign: THREE.Sprite;
    private readonly redraws: (() => void)[] = [];
    private readonly freshPile = new THREE.Group();
    private readonly madePile = new THREE.Group();
    private readonly shownPile = { fresh: -1, made: -1 };
    private readonly machineBody = new THREE.Group();
    private readonly counter = { canvas: document.createElement('canvas'), texture: new THREE.CanvasTexture(document.createElement('canvas')), drawn: '' };
    private readonly cashPile = new THREE.Group();
    private readonly boatPile = new THREE.Group();
    private shownCash = -1;
    private shownBoatCash = -1;
    private customers?: Customers;
    private boats?: Trucks;
    private dockSquare?: THREE.Mesh;
    private boatCashSquare?: THREE.Mesh;
    private dockDrawn = '';
    private opened: boolean;
    private playerNear = false;
    private time = 0;
    private pickTimer = 0;
    private dropTimer = 0;
    private takeTimer = 0;
    private sellTimer = 0;
    private unloadWait = 0;
    private boatTimer = 0;
    private makeTimer = 0;
    private readonly sales = new Map<Customer, number>();
    private boatSale = 0;
    private pourCarry = 0;
    private pourTold = '';
    private pourTossed = 0;
    private readonly helpers: Partial<Record<HelperKey, DenHelper>> = {};
    private readonly hireSquares = new Map<HelperKey, { mesh: THREE.Mesh; drawn: string; square: Square }>();
    /** Where the picker's carrying to now: the machine, or the crate. */
    private pickerTo: 'machine' | 'fresh' = 'machine';

    public constructor(private readonly threeScene: THREE.Scene, public readonly def: CropFarmDef, found: boolean, private readonly hooks: DenHooks) {
        this.opened = found;
        const crop = (MOW.crops ?? []).find((c) => c.id === def.crop);
        if (!crop) throw new Error(`[CropFarm] no crop "${def.crop}" in ui/mow.json crops`);
        this.crop = crop;
        this.cropItem = `crop:${crop.id}`;
        this.productItem = `product:${crop.id}`;
        const farm = this.state;
        if (found && farm.plots < 1) farm.plots = 1;
        while (farm.grown.length < def.plots.length) farm.grown.push(0);
        while (farm.left.length < def.plots.length) farm.left.push(0);
        this.layoutOf = layout(def);
        this.group.position.set(def.x, 0, def.z);
        this.buildFloor();
        this.buildFence();
        this.buildPlots();
        this.buildMachine();
        this.buildCounter();
        this.buildHarbour();
        this.buildCruise();
        this.buildHireSquares();
        this.sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: signTexture(def.name.toUpperCase(), !found, this.levelLocked ? def.level : undefined), depthWrite: false }));
        this.sign.position.set(0, 2.7, this.layoutOf.hd);
        this.sign.renderOrder = 20;
        this.fitSign();
        this.group.add(this.sign);
        this.redraws.push(() => this.redrawSign());
        window.setTimeout(() => this.redraws.forEach((redraw) => redraw()), 1500);
        threeScene.add(this.group);
        if (found) this.startCustomers();
        if (found && farm.dock) this.startBoats();
        if (found) (['picker', 'helper', 'boatHelper'] as const).forEach((key) => farm[key] && this.hire(key, false));
        this.refreshPlots();
    }

    private get state(): CropFarmState {
        return MowProgress.cropFarm(this.def.id);
    }

    // ---------------------------------------------------------------- what the scene asks of a den

    /** Its fences, machine and counter (solid), its floor and the customers' strip (bare). */
    public static boxes(def: CropFarmDef): { solid: Box[]; bare: Box[] } {
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
            at(l.machine.x, l.machine.z, 0.75, 0.6),
            at(l.counter.x, l.counter.z, 0.4, 1.1),
        ];
        const bare: Box[] = [at(0, 0, hw + 0.2, hd + 0.2), at(hw + 1.2, 1.2, 1.1, hd - 0.6)];
        const harbour = def.harbour;
        if (harbour) bare.push({ x: harbour.x, z: harbour.z, halfX: 1.4, halfZ: 2.6 }, { x: harbour.x - 2.2, z: harbour.z, halfX: 1, halfZ: 1 });
        return { solid, bare };
    }

    public get isOpen(): boolean {
        return this.opened;
    }

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

    /** Found: the sign shows, the first plot's ripe (the lesson), customers start coming. */
    public open(): void {
        if (this.opened) return;
        this.opened = true;
        const farm = this.state;
        if (farm.plots < 1) farm.plots = 1;
        if (!farm.tutorial) farm.left[0] = Math.max(farm.left[0] ?? 0, this.crop.perPick);
        MowProgress.denChanged();
        this.redrawSign();
        const to = this.sign.scale.clone();
        this.sign.scale.set(0.1, 0.02, 1);
        gsap.to(this.sign.scale, { x: to.x, y: to.y, duration: 0.7, ease: 'back.out(2)' });
        this.refreshPlots();
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

    private decal(texture: THREE.Texture, width: number, depth: number, x: number, z: number, y = 0.07): THREE.Mesh {
        const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false });
        material.polygonOffset = true;
        material.polygonOffsetFactor = -3;
        material.polygonOffsetUnits = -3;
        BendService.applyBend(material);
        const geometry = new THREE.PlaneGeometry(width, depth, 4, 4);
        geometry.rotateX(-Math.PI / 2);
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(x, y, z);
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
        const floor = new THREE.Mesh(new THREE.PlaneGeometry(hw * 2, hd * 2, 8, 8).rotateX(-Math.PI / 2), this.material(0xc9a77a));
        floor.position.y = 0.03;
        this.group.add(floor);
    }

    /** A wooden fence all round, its gate (a gap) in the middle of the south side. */
    private buildFence(): void {
        const { hw, hd } = this.layoutOf;
        const wood = this.material(WOOD);
        const rail = (x1: number, z1: number, x2: number, z2: number) => {
            const length = Math.hypot(x2 - x1, z2 - z1);
            if (length < 0.05) return;
            const posts = Math.max(1, Math.round(length / POST_SPACING));
            for (let i = 0; i <= posts; i++) {
                const t = i / posts;
                this.box(0.14, FENCE_HEIGHT, 0.14, wood, x1 + (x2 - x1) * t, FENCE_HEIGHT / 2, z1 + (z2 - z1) * t);
            }
            for (const y of [0.35, 0.72]) {
                const bar = this.box(length, 0.08, 0.06, wood, (x1 + x2) / 2, y, (z1 + z2) / 2);
                bar.rotation.y = -Math.atan2(z2 - z1, x2 - x1);
            }
        };
        const gate = this.def.gate / 2;
        rail(-hw, -hd, hw, -hd);
        rail(-hw, -hd, -hw, hd);
        rail(hw, -hd, hw, hd);
        rail(-hw, hd, -gate, hd);
        rail(gate, hd, hw, hd);
    }

    /** The plots: tilled soil, 2 x 2 plants on each (leaves, the fruit showing when ripe), a buy square on the next. */
    private buildPlots(): void {
        const leaf = this.material(new THREE.Color(this.crop.leaf).getHex());
        const berry = this.material(new THREE.Color(this.crop.color).getHex(), { roughness: 0.45 });
        const soil = this.material(SOIL);
        const leafGeometry = new THREE.SphereGeometry(0.26, 8, 6);
        const berryGeometry = new THREE.SphereGeometry(0.085, 8, 6);
        for (const at of this.layoutOf.plots) {
            const ground = this.box(PLOT, 0.12, PLOT, soil, at.x, 0.06, at.z);
            const plants: THREE.Group[] = [];
            const berries: THREE.Group[] = [];
            for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
                const plant = new THREE.Group();
                plant.position.set(at.x + dx * PLANT_SPREAD, 0.12, at.z + dz * PLANT_SPREAD);
                for (const [lx, ly, lz] of [[0, 0.18, 0], [-0.16, 0.12, 0.1], [0.16, 0.12, -0.08]]) {
                    const part = new THREE.Mesh(leafGeometry, leaf);
                    part.position.set(lx, ly, lz);
                    part.scale.set(1, 0.7, 1);
                    plant.add(part);
                }
                const fruit = new THREE.Group();
                for (const [bx, by, bz] of [[0.18, 0.12, 0.16], [-0.2, 0.1, -0.12], [0.02, 0.3, 0.2]]) {
                    const part = new THREE.Mesh(berryGeometry, berry);
                    part.position.set(bx, by, bz);
                    part.scale.set(1, 1.2, 1);
                    fruit.add(part);
                }
                plant.add(fruit);
                this.group.add(plant);
                plants.push(plant);
                berries.push(fruit);
            }
            const buy = this.decal(new THREE.Texture(), PLOT - 0.2, PLOT - 0.2, at.x, at.z, 0.14);
            buy.visible = false;
            this.plots.push({ soil: ground, plants, berries, buy, buyDrawn: '' });
        }
        this.loadPlotModels();
    }

    /**
     * The pizza game's look, as it loads: each plot a patch of tilled dirt (a grass patch until it's bought), its
     * plants the crop itself (the strawberry...) growing from small to full — the drawn soil and leaves until then.
     */
    private loadPlotModels(): void {
        const place = (object: THREE.Object3D, at: { x: number; z: number }) => {
            object.position.set(at.x, 0.02, at.z);
            this.group.add(object);
            return object;
        };
        this.plots.forEach((plot, i) => {
            const at = this.layoutOf.plots[i];
            void farmProp(PLOT_DIRT, 0.4, PLOT).then((model) => {
                if (!model || !this.group.parent) return;
                plot.dirt = place(model, at);
                plot.soil.visible = false;
                this.refreshPlots();
            });
            void farmProp(PLOT_GRASS, 0.4, PLOT).then((model) => {
                if (!model || !this.group.parent) return;
                plot.wild = place(model, at);
                this.refreshPlots();
            });
        });
        const model = this.crop.model;
        if (!model) return;
        const size = this.crop.size ?? CROP_SIZE;
        this.plots.forEach((plot) => {
            plot.plants.forEach((plant) => {
                void farmProp(model, size, size).then((crop) => {
                    if (!crop || !this.group.parent) return;
                    plant.clear();
                    crop.rotation.y = Math.random() * Math.PI * 2;
                    plant.add(crop);
                    plot.modelled = true;
                });
            });
        });
    }

    /** The cruise ship its customers come off (lying where the level puts it). */
    private buildCruise(): void {
        const cruise = this.def.cruise;
        if (!cruise) return;
        void farmProp(CRUISE_SHIP, 40, cruise.length ?? 36).then((ship) => {
            if (!ship || !this.group.parent) return;
            const at = this.local(cruise.x, cruise.z);
            ship.position.set(at.x, 0, at.z);
            ship.rotation.y = cruise.rotationY ?? 0;
            this.group.add(ship);
        });
    }

    /** The machine (a red pot on a stove for jam), its fruit square and grid; the fresh crate's grid; their counter. */
    private buildMachine(): void {
        const { machine, fresh } = this.layoutOf;
        const body = this.machineBody;
        body.position.set(machine.x, 0, machine.z);
        this.group.add(body);
        const color = new THREE.Color(this.crop.product.color).getHex();
        this.box(1.3, 0.8, 1.0, 0x9aa3ad, 0, 0.4, 0, body);
        const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.42, 0.6, 16), this.material(0x4a4a52, { metalness: 0.4 }));
        pot.position.y = 1.1;
        body.add(pot);
        const inside = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.04, 16), this.material(color, { roughness: 0.3 }));
        inside.position.y = 1.39;
        body.add(inside);
        this.counter.canvas.width = 220;
        this.counter.canvas.height = 96;
        this.counter.texture = CanvasArt.texture(this.counter.canvas);
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.counter.texture, depthWrite: false }));
        sprite.scale.set(1.3, 0.57, 1);
        sprite.position.set(machine.x, 2.4, machine.z);
        sprite.renderOrder = 20;
        this.group.add(sprite);
        const fruitWord = this.crop.name.toUpperCase();
        this.square(() => squareTexture(machine.input.w, machine.input.d, '#ffffff', { text: fruitWord, dashed: true, sub: this.crop.product.name.toUpperCase(), subColor: this.crop.product.color }),
            machine.input.w, machine.input.d, machine.input.x, machine.input.z);
        this.gridDecal(machine.grid);
        this.madePile.position.set(machine.grid.x, 0.06, machine.grid.z);
        this.group.add(this.madePile);
        this.gridDecal(fresh);
        this.box(fresh.w + 0.2, 0.2, 0.12, WOOD, fresh.x, 0.1, fresh.z - fresh.d / 2 - 0.06);
        this.freshPile.position.set(fresh.x, 0.06, fresh.z);
        this.group.add(this.freshPile);
    }

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

    private buildCounter(): void {
        const { counter, sell, cash } = this.layoutOf;
        this.box(0.8, 0.85, 2.2, WOOD, counter.x, 0.42, counter.z);
        this.box(0.95, 0.12, 2.35, 0xe8323f, counter.x, 0.9, counter.z);
        this.square(() => squareTexture(sell.w, sell.d, '#4fe3ff', { text: 'SELL' }), sell.w, sell.d, sell.x, sell.z);
        this.square(() => squareTexture(cash.w, cash.d, '#4fe3ff', { icon: 'ItemIcon_Money_Bill' }), cash.w, cash.d, cash.x, cash.z);
        this.cashPile.position.set(cash.x, 0.06, cash.z);
        this.group.add(this.cashPile);
    }

    /** The harbour's drop point on the shore (bought: BOATS), its cash square; the boats' helper's square beside it. */
    private buildHarbour(): void {
        const harbour = this.def.harbour;
        if (!harbour) return;
        const dock = this.local(harbour.x, harbour.z);
        this.dockSquare = this.decal(new THREE.Texture(), 1.6, 1.6, dock.x, dock.z);
        const cash = this.boatCash;
        this.boatCashSquare = this.square(() => squareTexture(1.5, 1.5, '#4fe3ff', { icon: 'ItemIcon_Money_Bill' }), 1.5, 1.5, cash.x, cash.z);
        this.boatCashSquare.visible = false;
        this.boatPile.position.set(cash.x, 0.06, cash.z);
        this.group.add(this.boatPile);
        const placed = this.def.parts?.boatHelperHire;
        this.layoutOf.hires.boatHelper = placed ? { x: placed.x, z: placed.z, w: placed.w ?? 1.6, d: placed.d ?? 1.6 } : { x: dock.x - 2.2, z: dock.z, w: 1.6, d: 1.6 };
    }

    private get boatCash(): Square {
        const harbour = this.def.harbour!;
        const at = harbour.cash ?? { x: harbour.x, z: harbour.z + 1.9 };
        const local = this.local(at.x, at.z);
        return { x: local.x, z: local.z, w: 1.5, d: 1.5 };
    }

    private buildHireSquares(): void {
        for (const key of ['picker', 'helper', 'boatHelper'] as const) {
            if (!this.def[key] || (key === 'boatHelper' && !this.def.harbour)) continue;
            const square = this.layoutOf.hires[key];
            const mesh = this.decal(new THREE.Texture(), square.w, square.d, square.x, square.z);
            mesh.visible = false;
            this.hireSquares.set(key, { mesh, drawn: '', square });
        }
    }

    private redrawSign(): void {
        this.sign.material.map = signTexture(this.def.name.toUpperCase(), !this.opened, this.levelLocked ? this.def.level : undefined);
        this.sign.material.needsUpdate = true;
        this.fitSign();
    }

    private fitSign(): void {
        const image = this.sign.material.map?.image as HTMLCanvasElement | undefined;
        const aspect = image ? image.width / Math.max(1, image.height) : 3;
        this.sign.scale.set(1.1 * aspect, 1.1, 1);
    }

    private popIn(object: THREE.Object3D): void {
        object.scale.setScalar(0.01);
        gsap.to(object.scale, { x: 1, y: 1, z: 1, duration: 0.6, ease: 'back.out(2.5)' });
    }

    // ---------------------------------------------------------------- customers and boats

    private startCustomers(): void {
        if (this.customers) return;
        const { counter, hw, hd } = this.layoutOf;
        const def = this.def;
        const x = def.x + hw + 1.1;
        const slots = Array.from({ length: def.queue }, (_, i) => new THREE.Vector3(x, 0, def.z + counter.z + i * 1.5));
        const entry = new THREE.Vector3(x, 0, def.z + hd + 0.4);
        const ins = def.peopleIn ?? [];
        const outs = def.peopleOut ?? [];
        const paths = ins.length >= 2 && outs.length >= 2
            ? { in: ins.map((p) => new THREE.Vector3(p.x, 0, p.z)), out: outs.map((p) => new THREE.Vector3(p.x, 0, p.z)) }
            : undefined;
        const gangway = def.cruise ? (def.cruise.gangway ?? { x: def.cruise.x, z: def.cruise.z }) : undefined;
        const from = gangway
            ? () => new THREE.Vector3(gangway.x + (Math.random() - 0.5) * 1.2, 0, gangway.z + (Math.random() - 0.5) * 1.2)
            : () => spawnPoint('people', entry) ?? entry.clone();
        this.customers = new Customers(this.threeScene, slots, entry, from, new THREE.Vector3(-1, 0, 0),
            { wants: def.wants, queue: def.queue, everySec: def.customerEverySec, items: [this.cropItem, this.productItem] }, paths);
        if (!this.state.tutorial) this.customers.firstOnes = 2;
    }

    private startBoats(): void {
        const harbour = this.def.harbour;
        if (!harbour || this.boats || harbour.path.length < 2) return;
        // One path, like the trucks': in to the point marked "park" (else the last), out through the rest.
        const all = harbour.path.map((p) => new THREE.Vector3(p.x, 0, p.z));
        const marked = harbour.path.findIndex((p) => p.park);
        const park = marked > 0 ? marked : all.length - 1;
        const path = all.slice(0, park + 1);
        const rest = all.slice(park);
        const out = rest.length >= 2 ? rest : (harbour.out ?? []).map((p) => new THREE.Vector3(p.x, 0, p.z));
        const end = path[path.length - 1];
        const before = path[path.length - 2];
        this.boats = new Trucks(this.threeScene, harbour, path, out, harbour.parkFacing ?? Math.atan2(end.x - before.x, end.z - before.z),
            [this.cropItem, this.productItem]);
    }

    // ---------------------------------------------------------------- what shows

    private refreshPlots(): void {
        const farm = this.state;
        this.plots.forEach((plot, i) => {
            const owned = i < farm.plots;
            plot.plants.forEach((plant) => (plant.visible = owned && this.opened));
            (plot.soil.material as THREE.MeshStandardMaterial).color.setHex(owned ? SOIL : 0x8f7a60);
            // The pizza patches: tilled dirt when owned, grass until then.
            if (plot.dirt) plot.dirt.visible = owned;
            if (plot.wild) plot.wild.visible = !owned;
            if (plot.dirt || plot.wild) plot.soil.visible = !(owned ? plot.dirt : plot.wild);
            const next = this.opened && i === farm.plots;
            plot.buy.visible = next;
            if (!next) return;
            const offer = this.def.plots[i];
            const short = MowProgress.level < offer.level;
            const key = `${short}|${MowProgress.paid(this.plotKey(i))}`;
            if (key === plot.buyDrawn) return;
            plot.buyDrawn = key;
            const left = Math.max(0, Math.ceil(offer.price - MowProgress.paid(this.plotKey(i))));
            const material = plot.buy.material as THREE.MeshBasicMaterial;
            material.map = squareTexture(PLOT - 0.2, PLOT - 0.2, '#ffffff', { text: shortMoney(left), sub: short ? `LEVEL ${offer.level}` : 'NEW PLOT', subColor: short ? '#ff8a7a' : '#9cff6a' });
            material.needsUpdate = true;
        });
    }

    /** Plants grow with their plot (small to full), the fruit shows when it's ripe (and bobs a little). */
    private drawPlants(): void {
        const farm = this.state;
        this.plots.forEach((plot, i) => {
            if (i >= farm.plots) return;
            const ripe = (farm.left[i] ?? 0) > 0;
            const grow = ripe ? 1 : 0.35 + 0.65 * Math.min(1, (farm.grown[i] ?? 0) / this.crop.growSec);
            const left = Math.max(1, Math.ceil(((farm.left[i] ?? 0) / this.crop.perPick) * 4));
            plot.plants.forEach((plant, k) => {
                if (plot.modelled) {
                    // The crop itself: growing from small to full; ripe, it bobs, and goes one by one as it's picked.
                    plant.visible = !ripe || k < left;
                    plant.scale.setScalar((ripe ? 1 : 0.25 + 0.65 * grow) * (ripe ? 1 + Math.sin(this.time * 3 + i + k) * 0.04 : 1));
                    return;
                }
                plant.scale.setScalar(grow * (ripe ? 1 + Math.sin(this.time * 3 + i + k) * 0.03 : 1));
                plot.berries[k].visible = ripe && k < left;
            });
        });
    }

    private drawPile(pile: THREE.Group, kind: FarmItem, count: number, key: 'fresh' | 'made'): void {
        const shown = Math.min(count, 16);
        if (shown === this.shownPile[key]) return;
        this.shownPile[key] = shown;
        pile.clear();
        for (let i = 0; i < shown; i++) {
            const slot = i % 4;
            const layer = Math.floor(i / 4);
            const item = farmItem(kind);
            item.scale.setScalar(GRID_SCALE);
            item.position.set(((slot % 2) - 0.5) * GRID_CELL, layer * itemHeight(kind) * GRID_SCALE, (Math.floor(slot / 2) - 0.5) * GRID_CELL);
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

    private drawCounter(): void {
        const inside = this.state.machineIn;
        const max = this.crop.product.max;
        const key = `${inside}`;
        if (key === this.counter.drawn) return;
        this.counter.drawn = key;
        const g = this.counter.canvas.getContext('2d')!;
        g.clearRect(0, 0, this.counter.canvas.width, this.counter.canvas.height);
        CanvasArt.plaque(g, 4, 4, this.counter.canvas.width - 8, this.counter.canvas.height - 8, 18);
        g.fillStyle = this.crop.color;
        g.beginPath();
        g.arc(42, 48, 18, 0, Math.PI * 2);
        g.fill();
        CanvasArt.text(g, `${inside}/${max}`, 132, 48, 40, inside >= max ? '#ff8a7a' : '#ffffff', 150);
        this.counter.texture.needsUpdate = true;
    }

    private refreshDock(): void {
        const harbour = this.def.harbour;
        const square = this.dockSquare;
        if (!harbour || !square) return;
        const farm = this.state;
        square.visible = this.opened && farm.plots >= 2;
        if (this.boatCashSquare) this.boatCashSquare.visible = this.opened && !!farm.dock;
        const open = !!farm.dock;
        const short = MowProgress.level < harbour.level;
        const key = `${open}|${short}|${MowProgress.paid(`${this.def.id}-dock`)}`;
        if (key === this.dockDrawn) return;
        this.dockDrawn = key;
        const left = Math.max(0, Math.ceil(harbour.price - MowProgress.paid(`${this.def.id}-dock`)));
        const material = square.material as THREE.MeshBasicMaterial;
        material.map = open
            ? squareTexture(1.6, 1.6, '#4fe3ff', { text: 'BOAT' })
            : squareTexture(1.6, 1.6, '#ffffff', { text: shortMoney(left), sub: short ? `LEVEL ${harbour.level}` : 'BOATS', subColor: short ? '#ff8a7a' : '#9cff6a' });
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

    private plotKey(i: number): string {
        return `${this.def.id}-plot-${i}`;
    }

    private onDock(p: { x: number; z: number }): boolean {
        const harbour = this.def.harbour;
        if (!harbour) return false;
        const dock = this.local(harbour.x, harbour.z);
        return Math.abs(p.x - dock.x) <= 0.8 && Math.abs(p.z - dock.z) <= 0.8;
    }

    /** The market's hunger from the stock waiting (bigger orders, more often, with a big pile: stockDemand()). */
    private readonly marketDemand = (): number => stockDemand(this.state.made + this.state.fresh);

    public update(delta: number, player: THREE.Vector3): void {
        if (this.customers) this.customers.demand = this.marketDemand;
        if (this.boats) this.boats.demand = this.marketDemand;
        this.time += delta;
        const harbour = this.def.harbour;
        const reach = SOUND_RANGE + Math.max(this.def.width, this.def.depth) / 2;
        this.playerNear = Math.hypot(player.x - this.def.x, player.z - this.def.z) <= reach
            || (!!harbour && Math.hypot(player.x - harbour.x, player.z - harbour.z) <= SOUND_RANGE);
        const p = this.local(player.x, player.z);
        this.customers?.update(delta);
        this.boats?.update(delta);
        for (const helper of Object.values(this.helpers)) helper?.update(delta);
        const farm = this.state;
        this.drawPlants();
        this.drawCounter();
        this.drawPile(this.freshPile, this.cropItem, farm.fresh, 'fresh');
        this.drawPile(this.madePile, this.productItem, farm.made, 'made');
        this.shownCash = this.drawCash(this.cashPile, farm.cash, this.shownCash);
        this.shownBoatCash = this.drawCash(this.boatPile, farm.boatCash, this.shownBoatCash);
        this.refreshPlots();
        this.refreshDock();
        this.refreshHireSquares();
        if (!this.opened) return;
        this.grow(delta);
        this.make(delta);
        this.pick(delta, p);
        this.feed(delta, p);
        this.takeGoods(delta, p);
        this.sell(delta, p);
        this.loadBoat(delta, p);
        this.pickCash(p);
        // Off every buy square: what was said there is forgotten (said again on the next visit).
        const onHire = [...this.hireSquares.values()].some((hire) => hire.mesh.visible && this.onSquare(p, hire.square));
        const onPlot = farm.plots < this.plots.length && this.onSquare(p, this.plotSquare(farm.plots));
        if (!onHire && !onPlot && !this.onDock(p)) this.pourTold = '';
        this.buyPlot(delta, p);
        this.buyDock(delta, p);
        this.buyHelpers(delta, p);
    }

    private plotSquare(i: number): Square {
        const at = this.layoutOf.plots[i];
        return { x: at.x, z: at.z, w: PLOT, d: PLOT };
    }

    /** Owned plots grow toward ripe (Farm Speed makes it quicker); ripe, their fruit waits to be picked. */
    private grow(delta: number): void {
        const farm = this.state;
        for (let i = 0; i < farm.plots; i++) {
            if ((farm.left[i] ?? 0) > 0) continue;
            farm.grown[i] = (farm.grown[i] ?? 0) + delta * MowProgress.farmSpeed;
            if (farm.grown[i] < this.crop.growSec) continue;
            farm.grown[i] = 0;
            farm.left[i] = this.crop.perPick;
        }
    }

    /** The machine makes one product from `per` fruit every `sec` (quicker with Farm Speed), up to its grid's max. */
    private make(delta: number): void {
        const farm = this.state;
        const product = this.crop.product;
        if (farm.machineIn < product.per || farm.made >= product.max) {
            this.makeTimer = 0;
            this.machineBody.position.x = this.layoutOf.machine.x;
            return;
        }
        this.makeTimer += delta;
        this.machineBody.position.x = this.layoutOf.machine.x + Math.sin(this.makeTimer * 40) * 0.015;
        const lesson = !farm.tutorial;
        if (this.makeTimer < (lesson ? 0.15 : product.sec / MowProgress.farmSpeed)) return;
        this.makeTimer = 0;
        farm.machineIn -= product.per;
        farm.made++;
        MowProgress.denChanged();
        this.hooks.xp('tray');
        this.sound('build');
    }

    /** On a ripe plot: its fruit into the backpack, one at a time. */
    private pick(delta: number, p: { x: number; z: number }): void {
        this.pickTimer -= delta;
        if (this.pickTimer > 0) return;
        const farm = this.state;
        if (MowProgress.carried(this.cropItem) >= this.def.carryMax) return;
        for (let i = 0; i < farm.plots; i++) {
            if ((farm.left[i] ?? 0) <= 0 || !this.onSquare(p, this.plotSquare(i))) continue;
            this.pickTimer = PICK_SEC;
            this.harvestOne(i);
            MowProgress.carryItem(this.cropItem, 1);
            const at = this.layoutOf.plots[i];
            this.hooks.effects.toss(this.world(at.x, 0.5, at.z), this.hooks.carryPoint(), new THREE.Color(this.crop.color), 0, () => this.sound('item'), farmItem(this.cropItem));
            this.hooks.xp('egg');
            return;
        }
    }

    private harvestOne(i: number): void {
        const farm = this.state;
        farm.left[i] = Math.max(0, (farm.left[i] ?? 0) - 1);
        if (farm.left[i] === 0) farm.grown[i] = 0;
        MowProgress.denChanged();
    }

    /** On the machine's square with fruit carried: in it goes, one at a time. */
    private feed(delta: number, p: { x: number; z: number }): void {
        this.dropTimer -= delta;
        const farm = this.state;
        const { machine } = this.layoutOf;
        if (this.dropTimer > 0 || !this.onSquare(p, machine.input)) return;
        if (MowProgress.carried(this.cropItem) <= 0 || farm.machineIn >= this.crop.product.max) return;
        this.dropTimer = DROP_SEC;
        MowProgress.carryItem(this.cropItem, -1);
        farm.machineIn++;
        MowProgress.denChanged();
        this.hooks.effects.toss(this.hooks.carryPoint(), this.world(machine.x, 1.4, machine.z), new THREE.Color(this.crop.color), 0, () => this.sound('item'), farmItem(this.cropItem));
    }

    /** On a grid: its goods into the backpack (the product's grid; the fresh crate). */
    private takeGoods(delta: number, p: { x: number; z: number }): void {
        this.takeTimer -= delta;
        if (this.takeTimer > 0) return;
        const farm = this.state;
        const { machine, fresh } = this.layoutOf;
        const take = (kind: CropItem, from: Square, pile: 'made' | 'fresh') => {
            if (farm[pile] <= 0 || !this.onSquare(p, from) || MowProgress.carried(kind) >= this.def.carryMax) return false;
            farm[pile]--;
            MowProgress.denChanged();
            MowProgress.carryItem(kind, 1);
            this.takeTimer = TAKE_SEC;
            this.hooks.effects.toss(this.world(from.x, 0.4, from.z), this.hooks.carryPoint(), new THREE.Color(0xffffff), 0, () => this.sound('item'), farmItem(kind));
            return true;
        };
        if (!take(this.productItem, machine.grid, 'made')) take(this.cropItem, fresh, 'fresh');
    }

    private price(item: OrderItem): number {
        return item === this.productItem ? this.crop.product.price : this.crop.price;
    }

    /** What's carried that `wants` asks for (the product first: it pays more). */
    private carriedFor(wants: (item: OrderItem) => boolean): CropItem | undefined {
        return [this.productItem, this.cropItem].find((item) => MowProgress.carried(item) > 0 && wants(item));
    }

    private sell(delta: number, p: { x: number; z: number }): void {
        this.sellTimer -= delta;
        const customers = this.customers;
        const customer = customers?.front;
        const onSell = this.onSquare(p, this.layoutOf.sell);
        const item = customers && customer ? this.carriedFor((wanted) => customers.wantsItem(customer, wanted)) : undefined;
        // Carrying what nobody there wants: unload it (the product onto its grid, fruit into the crate), after a moment.
        const spare = [this.productItem, this.cropItem].find((kind) => MowProgress.carried(kind) > 0);
        this.unloadWait = onSell && !item && spare ? this.unloadWait + delta : 0;
        if (spare && this.unloadWait >= UNLOAD_WAIT && this.sellTimer <= 0) {
            this.sellTimer = UNLOAD_SEC;
            MowProgress.carryItem(spare, -1);
            const farm = this.state;
            const to = spare === this.productItem ? this.layoutOf.machine.grid : this.layoutOf.fresh;
            if (spare === this.productItem) farm.made++;
            else farm.fresh++;
            MowProgress.denChanged();
            this.hooks.effects.toss(this.hooks.carryPoint(), this.world(to.x, 0.3, to.z), new THREE.Color(this.crop.color), 0, () => this.sound('item'), farmItem(spare));
            return;
        }
        if (this.sellTimer > 0 || !customers || !customer || !onSell || !item) return;
        this.sellTimer = SELL_SEC;
        MowProgress.carryItem(item, -1);
        this.serveCustomer(customer, item, this.hooks.carryPoint());
    }

    /** One `item` from `from` (world) to the customer at the counter; their last pays onto the cash square. */
    private serveCustomer(customer: Customer, item: CropItem, from: THREE.Vector3): void {
        const customers = this.customers!;
        const value = (this.sales.get(customer) ?? 0) + this.price(item);
        this.sales.set(customer, value);
        const last = customers.give(customer, item);
        this.hooks.xp('traySold');
        this.hooks.effects.toss(from, customers.handsOf(customer), new THREE.Color(0xffe066), 0, () => {
            this.sound('item');
            if (!last) return;
            this.sales.delete(customer);
            this.sound('buyCash');
            this.pay('cash', value, this.world(this.layoutOf.counter.x, 1.1, this.layoutOf.counter.z), this.layoutOf.cash);
            const farm = this.state;
            if (!farm.tutorial) {
                farm.tutorial = true;
                GameAnalytics.den(this.def.id, 'tutorial');
            }
        }, farmItem(item));
    }

    private loadBoat(delta: number, p: { x: number; z: number }): void {
        const boats = this.boats;
        this.boatTimer -= delta;
        if (!boats || this.boatTimer > 0 || !boats.parked || !this.onDock(p)) return;
        const item = this.carriedFor((wanted) => boats.wantsItem(wanted));
        if (!item) return;
        this.boatTimer = SELL_SEC * 0.7;
        MowProgress.carryItem(item, -1);
        this.serveBoat(item, this.hooks.carryPoint());
    }

    /** One `item` from `from` (world) into the docked boat; its last pays onto the harbour's cash square. */
    private serveBoat(item: CropItem, from: THREE.Vector3): void {
        const boats = this.boats!;
        this.boatSale += this.price(item);
        const value = this.boatSale;
        const last = boats.give(item);
        if (last) this.boatSale = 0;
        this.hooks.xp('traySold');
        const bed = boats.bed();
        this.hooks.effects.toss(from, bed, new THREE.Color(0xffe066), 0, () => {
            this.sound('item');
            if (!last) return;
            this.sound('buyCash');
            this.pay('boatCash', value, bed, this.boatCash);
        }, farmItem(item));
    }

    private pay(pile: 'cash' | 'boatCash', amount: number, from: THREE.Vector3, square: Square): void {
        // Money Gain boosts the farm's takings too.
        amount = MowProgress.farmPay(amount);
        this.state[pile] += amount;
        MowProgress.denChanged();
        const bundles = Math.min(8, Math.ceil(amount / CASH_PER_BUNDLE));
        for (let i = 0; i < bundles; i++) {
            this.hooks.effects.toss(from.clone().setY(from.y + 0.3), this.world(square.x, 0.1, square.z), new THREE.Color(0x5fc85a), i * 0.06,
                () => this.sound('coins'), farmItem('cash'));
        }
    }

    private pickCash(p: { x: number; z: number }): void {
        if (this.onSquare(p, this.layoutOf.cash)) this.collectPile('cash', this.layoutOf.cash);
        if (this.state.dock && this.def.harbour && this.onSquare(p, this.boatCash)) this.collectPile('boatCash', this.boatCash);
    }

    /** A cash pile to the player (by the player, or a helper taking it to them). */
    private collectPile(pile: 'cash' | 'boatCash', square: Square): void {
        const farm = this.state;
        const amount = farm[pile];
        if (amount <= 0) return;
        farm[pile] = 0;
        MowProgress.denChanged();
        MowProgress.addMoney(amount);
        for (let i = 0; i < Math.min(8, Math.ceil(amount / CASH_PER_BUNDLE)); i++) {
            this.hooks.effects.pickup(this.world(square.x, 0.2 + i * 0.05, square.z), new THREE.Color(0x5fc85a), () => this.sound('coins'), farmItem('cash'));
        }
        if (this.playerNear) this.hooks.effects.floatText(this.world(square.x, 1.8, square.z), `+${shortMoney(amount)}`, '#ffe27a');
    }

    // ---------------------------------------------------------------- buying

    /** Pours money into a buy square (`key`: kept between visits); true when it's paid. Says once a visit what's missing. */
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

    private buyPlot(delta: number, p: { x: number; z: number }): void {
        const farm = this.state;
        const i = farm.plots;
        const offer = this.def.plots[i];
        if (!offer || !this.onSquare(p, this.plotSquare(i))) return;
        const at = this.layoutOf.plots[i];
        if (!this.pourInto(this.plotKey(i), offer.price, offer.level, this.world(at.x, 0.1, at.z), delta, 'THIS PLOT')) return;
        farm.plots++;
        farm.grown[i] = 0;
        farm.left[i] = 0;
        MowProgress.denChanged();
        GameAnalytics.den(this.def.id, `plot-${String(farm.plots).padStart(2, '0')}`);
        this.hooks.xp('hen');
        MowAudio.play('buyFanfare');
        this.hooks.say('NEW PLOT!', 0x9cff6a);
        this.refreshPlots();
        this.plots[i].plants.forEach((plant) => this.popIn(plant));
    }

    private buyDock(delta: number, p: { x: number; z: number }): void {
        const harbour = this.def.harbour;
        const farm = this.state;
        if (!harbour || farm.dock || farm.plots < 2 || !this.onDock(p)) return;
        if (!this.pourInto(`${this.def.id}-dock`, harbour.price, harbour.level, new THREE.Vector3(harbour.x, 0.1, harbour.z), delta, 'THE BOATS')) return;
        farm.dock = true;
        MowProgress.denChanged();
        GameAnalytics.den(this.def.id, 'dock');
        MowAudio.play('buyFanfare');
        this.hooks.say('BOATS ARE COMING!', 0x9cff6a);
        this.startBoats();
    }

    // ---------------------------------------------------------------- the helpers

    private helperDef(key: HelperKey): BarnHelperDef | undefined {
        return this.def[key];
    }

    /** The picker once a few plots are owned; the counter's helper with the picker; the boats' with the harbour. */
    private helperOffered(key: HelperKey): boolean {
        const farm = this.state;
        if (!this.opened || farm[key] || !this.helperDef(key)) return false;
        if (key === 'picker') return farm.plots >= PICKER_AFTER_PLOTS;
        if (key === 'helper') return !!farm.picker;
        return !!farm.dock;
    }

    private static label(key: HelperKey): string {
        return key === 'picker' ? 'PICKER' : key === 'helper' ? 'HELPER' : 'BOAT HELPER';
    }

    private refreshHireSquares(): void {
        for (const [key, hire] of this.hireSquares) {
            const config = this.helperDef(key)!;
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
                text: shortMoney(left), sub: short ? `LEVEL ${config.level}` : CropFarm.label(key), subColor: short ? '#ff8a7a' : '#9cff6a',
            });
            material.needsUpdate = true;
        }
    }

    private buyHelpers(delta: number, p: { x: number; z: number }): void {
        for (const [key, hire] of this.hireSquares) {
            if (!hire.mesh.visible || !this.onSquare(p, hire.square)) continue;
            const config = this.helperDef(key)!;
            if (!this.pourInto(`${this.def.id}-${key}`, config.price, config.level, this.world(hire.square.x, 0.1, hire.square.z), delta, `THE ${CropFarm.label(key)}`)) continue;
            this.state[key] = true;
            MowProgress.denChanged();
            GameAnalytics.den(this.def.id, key);
            MowAudio.play('buyFanfare');
            this.hooks.xp('hen');
            this.hooks.say(`${CropFarm.label(key)} HIRED!`, 0x9cff6a);
            this.hire(key, true);
        }
    }

    /** The first ripe plot (owned), for the picker; -1 with none. */
    private ripePlot(): number {
        const farm = this.state;
        for (let i = 0; i < farm.plots; i++) if ((farm.left[i] ?? 0) > 0) return i;
        return -1;
    }

    /** Where a seller picks goods up: the grid of what `wants` asks for, else the fuller one; null with both empty. */
    private sellerPickSpot(wants: (item: OrderItem) => boolean): { at: THREE.Vector3; kind: FarmItem } | null {
        const farm = this.state;
        const { machine, fresh } = this.layoutOf;
        const stocked = ([[this.productItem, farm.made, machine.grid], [this.cropItem, farm.fresh, fresh]] as const).filter(([, count]) => count > 0);
        if (!stocked.length) return null;
        const pick = stocked.find(([item]) => wants(item)) ?? [...stocked].sort((a, b) => b[1] - a[1])[0];
        const grid = pick[2];
        return { at: new THREE.Vector3(grid.x, 0, grid.z + grid.d / 2 + 0.3), kind: pick[0] };
    }

    private sellerTake(kind: FarmItem): boolean {
        const farm = this.state;
        const pile = kind === this.productItem ? 'made' : kind === this.cropItem ? 'fresh' : undefined;
        if (!pile || farm[pile] <= 0) return false;
        farm[pile]--;
        MowProgress.denChanged();
        return true;
    }

    /** Something a seller carries that nobody there wants goes back on its grid (so a helper never stands stuck). */
    private putBack(kind: FarmItem): boolean {
        const farm = this.state;
        if (kind === this.productItem) farm.made++;
        else if (kind === this.cropItem) farm.fresh++;
        else return false;
        MowProgress.denChanged();
        return true;
    }

    /** The picker's drop: the machine while it has room and the crate's at least as full, else the crate. */
    private pickerDrop(): 'machine' | 'fresh' | null {
        const farm = this.state;
        const machineRoom = farm.machineIn < this.crop.product.max;
        const freshRoom = farm.fresh < FRESH_MAX;
        if (machineRoom && (!freshRoom || farm.machineIn / this.crop.product.per <= farm.fresh)) return 'machine';
        if (freshRoom) return 'fresh';
        return machineRoom ? 'machine' : null;
    }

    private hire(key: HelperKey, fanfare: boolean): void {
        const config = this.helperDef(key);
        if (!config || this.helpers[key]) return;
        const { machine, fresh, sell, cash } = this.layoutOf;
        let helper: DenHelper;
        if (key === 'picker') {
            helper = new DenHelper(this.group, new THREE.Vector3(fresh.x, 0, fresh.z + 1.5), config.carry, config.walkSpeed, {
                pickSpot: () => {
                    const i = this.ripePlot();
                    if (i < 0) return null;
                    const at = this.layoutOf.plots[i];
                    return { at: new THREE.Vector3(at.x, 0, at.z + PLOT / 2 + 0.3), kind: this.cropItem };
                },
                take: () => {
                    const i = this.ripePlot();
                    if (i < 0) return false;
                    this.harvestOne(i);
                    return true;
                },
                sellSpot: () => {
                    this.pickerTo = this.pickerDrop() ?? 'fresh';
                    const to = this.pickerTo === 'machine' ? machine.input : fresh;
                    return new THREE.Vector3(to.x, 0, to.z + (this.pickerTo === 'fresh' ? fresh.d / 2 + 0.3 : 0));
                },
                cashSpot: () => new THREE.Vector3(cash.x, 0, cash.z),
                serve: (_kind, from) => {
                    const to = this.pickerDrop();
                    if (!to) return false;
                    const farm = this.state;
                    if (to === 'machine') farm.machineIn++;
                    else farm.fresh++;
                    MowProgress.denChanged();
                    const target = to === 'machine' ? this.world(machine.x, 1.4, machine.z) : this.world(fresh.x, 0.3, fresh.z);
                    this.hooks.effects.toss(from.clone().add(this.group.position), target, new THREE.Color(this.crop.color), 0, () => this.sound('item'), farmItem(this.cropItem));
                    return true;
                },
                cashWaiting: () => 0,
                collect: () => {},
            });
        } else if (key === 'helper') {
            const wants = (item: OrderItem) => {
                const front = this.customers?.front;
                return !!front && !!this.customers?.wantsItem(front, item);
            };
            helper = new DenHelper(this.group, new THREE.Vector3(sell.x - 1, 0, sell.z), config.carry, config.walkSpeed, {
                pickSpot: () => this.sellerPickSpot(wants),
                take: (kind) => this.sellerTake(kind),
                sellSpot: () => new THREE.Vector3(sell.x, 0, sell.z),
                cashSpot: () => new THREE.Vector3(cash.x, 0, cash.z),
                serve: (kind, from) => {
                    const customers = this.customers;
                    const customer = customers?.front;
                    if (!customers || !customer) return false;
                    if (!customers.wantsItem(customer, kind as OrderItem)) return this.putBack(kind);
                    this.serveCustomer(customer, kind as CropItem, from.clone().add(this.group.position));
                    return true;
                },
                cashWaiting: () => this.state.cash,
                collect: () => this.collectPile('cash', cash),
            });
        } else {
            const harbour = this.def.harbour;
            if (!harbour) return;
            const dock = this.local(harbour.x, harbour.z);
            const wants = (item: OrderItem) => !!this.boats?.parked && this.boats.wantsItem(item);
            helper = new DenHelper(this.group, new THREE.Vector3(dock.x - 1, 0, dock.z), config.carry, config.walkSpeed, {
                pickSpot: () => this.sellerPickSpot(wants),
                take: (kind) => this.sellerTake(kind),
                sellSpot: () => new THREE.Vector3(dock.x, 0, dock.z),
                cashSpot: () => new THREE.Vector3(this.boatCash.x, 0, this.boatCash.z),
                serve: (kind, from) => {
                    const boats = this.boats;
                    if (!boats?.parked) return false;
                    if (!boats.wantsItem(kind as OrderItem)) return this.putBack(kind);
                    this.serveBoat(kind as CropItem, from.clone().add(this.group.position));
                    return true;
                },
                cashWaiting: () => this.state.boatCash,
                collect: () => this.collectPile('boatCash', this.boatCash),
            });
        }
        this.helpers[key] = helper;
        if (fanfare) this.popIn(helper.root);
    }

    public destroy(): void {
        gsap.killTweensOf(this.sign.scale);
        this.plots.forEach((plot) => plot.plants.forEach((plant) => gsap.killTweensOf(plant.scale)));
        this.customers?.destroy();
        this.boats?.destroy();
        for (const helper of Object.values(this.helpers)) helper?.destroy();
        this.group.removeFromParent();
    }
}
