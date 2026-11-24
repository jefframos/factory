// ChickenDen.ts
//
// The farm test's chicken den (TOWN.farm.dens, tuned by TOWN.farm.eggs): a fenced yard of bare earth deep in the grass
// with a gate on its south side. It's there from the start but out of reach (tough grass all round it), and below its
// level (DenDef.level) its gate is boarded up with a padlock, its sign saying the level it opens at: players reaching it
// early aren't swamped by it. At that level the boards drop (and it's said); mowed up to its gate, it opens (open())
// and the first hen is in. Inside, the player walks without the mower.
// The first visit is short (the lesson): the first hen's spot is already full of eggs (EggLoopDef.startEggs), the
// packer packs at once and hands the packs straight to the player standing at it, and the first customers each want
// one pack — pick up once, drop once, serve. The loop:
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
//   - With every hen owned, the conveyor belt (EggLoopDef.belt, bought on its square at the belt's start): eggs leave
//     the egg spots onto it (where it passes nearest), ride it to its end and drop into the packing machine (queuing at
//     the end while it's full). Its path is drawn in the editor (DenDef.parts.belt).
//   - Then the helper (EggLoopDef.helper, hired on its square): a worker in a cap and uniform (DenHelper) who takes the
//     packs (gold first) to the customers at SELL and the cash pile to the player.
//   - Then the gold machine (EggLoopDef.gold, bought on its square): packs dropped on its square become gold packs on
//     its grid, sold for more. Then the gold belt (EggLoopDef.goldBelt): every pack packed rides it into the gold
//     machine — the packing grid and the gold drop square go: everything's gold.
//   - Later, the truck dock (TOWN.farm.trucks, bought the same way): trucks come along the roads from a `trucks` spawn
//     area (Trucks.ts), park by the dock's square and take a big load of trays handed over there; they pay onto the
//     cash square. Customers come from the `people` spawn areas (popping in), up the path to the counter.
// Everything that's kept (hens, the eggs on the floor, in the machine, the trays, the cash) is in MowProgress.den.

import * as THREE from 'three';
import gsap from 'gsap';
import { BendService } from '../services/BendService';
import { DenDef, DenPoint, EggLoopDef, TOWN, TruckDockDef, TruckPathPoint, shortMoney } from '../data/MowConfig';
import { MowProgress } from '../data/MowProgress';
import { CanvasArt } from '../ui/CanvasArt';
import { GameAnalytics } from '../analytics/GameAnalytics';
import { Animal, farmItem, ITEM_HEIGHT } from '../farm/FarmModels';
import { Customers, stockDemand } from '../farm/Customers';
import { Trucks } from '../farm/Trucks';
import { spawnPoint, truckRoutes } from '../farm/Roads';
import type { MowEffects } from '../vfx/MowEffects';
import { MowAudio } from '../audio/MowAudio';
import { ConveyorBelt } from '../farm/ConveyorBelt';
import { DenHelper } from '../farm/DenHelper';
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
/** The conveyor belt: its width, its surface's height, its band's thickness; the default path runs this far in front of the egg spots. */
const BELT = { width: 0.55, top: 0.32, height: 0.1, front: 0.95 };
/**
 * Buying on a square (a hen, the conveyor, the dock): the money pours in from what's carried (then the den's piles), a
 * bit at a time and kept between visits — the whole price in about `seconds`, at least `least` a second; a note flies
 * every `tossSec`.
 */
const POUR = { seconds: 1.4, least: 20, tossSec: 0.08 };
/** The lesson's hand: its size (world units), the fingertip in its picture (from the left, from the top), how high it taps and bobs. */
const HAND = { size: 1.3, tipX: 0.22, tipY: 0.16, lift: 0.25, bob: 0.35 };
/** The den's sounds are heard this far past its fence (from its middle, plus its half size). */
const SOUND_RANGE = 10;
/** Eggs from the hens (on their spots, on the belt) are drawn this much bigger than carried ones. */
const EGG_SCALE = 1.6;
/**
 * The packing machine's grid of packs: 2 across (traySlots / 2 rows: 4 slots, a 2 x 2), each slot this big, the packs
 * on it drawn this much bigger than carried ones; they pile up on their slots (EggLoopDef.trayLayers high).
 */
/** The lesson (the first visit): a pack every this many seconds, handed to a player within this of the EGGS square. */
const LESSON_PACK_SEC = 0.15;
const LESSON_REACH = 2.5;
const GRID_COLS = 2;
const GRID_CELL = 0.95;
const GRID_TRAY_SCALE = 1.45;

/** The den's parts, in its own frame (origin at its middle, +Z toward the gate). */
interface Layout {
    hw: number;
    hd: number;
    nests: number[];
    /** Each hen's egg spot (in front of its nest, unless placed in the editor: DenDef.parts.eggs). */
    eggs: DenPoint[];
    machine: { x: number; z: number };
    input: { x: number; z: number; w: number; d: number };
    grid: { x: number; z: number; cols: number; rows: number; cell: number };
    counter: { x: number; z: number };
    sell: { x: number; z: number; w: number; d: number };
    cash: { x: number; z: number; w: number; d: number };
    goldMachine: { x: number; z: number };
    goldInput: { x: number; z: number; w: number; d: number };
    goldGrid: { x: number; z: number; cols: number; rows: number; cell: number };
    helperHire: { x: number; z: number; w: number; d: number };
    goldBuy: { x: number; z: number; w: number; d: number };
}

/**
 * Where everything goes: the den's own layout (nests along the hen house at the back, the packing machine with its egg
 * square west and its grid of packs east, the counter by the west fence...), each part moved to where the editor
 * placed it (DenDef.parts, den-local). The editor's den markers use the same defaults (town3d.js denPartDefaults()).
 */
function layout(def: DenDef, hens: number, slots: number): Layout {
    const hw = def.width / 2;
    const hd = def.depth / 2;
    const spacing = (def.width - 3) / hens;
    const rows = Math.ceil(slots / GRID_COLS);
    const parts = def.parts ?? {};
    // A placed part takes its spot, and a square its size (w, d) when the editor set one.
    const at = <T extends DenPoint>(base: T, placed?: DenPoint): T => {
        if (!placed) return base;
        const moved = { ...base, x: placed.x, z: placed.z };
        if ('w' in base && placed.w) moved.w = placed.w;
        if ('d' in base && placed.d) moved.d = placed.d;
        return moved;
    };
    const nests = Array.from({ length: hens }, (_, i) => -hw + 1.5 + spacing * (i + 0.5));
    return {
        hw, hd,
        nests,
        eggs: nests.map((x, i) => at({ x, z: -hd + EGG_Z }, parts.eggs?.[i] ?? undefined)),
        machine: at({ x: 2.4, z: 0.9 }, parts.machine),
        input: at({ x: 0.45, z: 0.9, w: 1.5, d: 1.5 }, parts.input),
        grid: at({ x: 4.6, z: 0.9, cols: GRID_COLS, rows, cell: GRID_CELL }, parts.grid),
        counter: at({ x: -hw + 0.55, z: 0.6 }, parts.counter),
        sell: at({ x: -hw + 1.85, z: 0.6, w: 1.5, d: 2 }, parts.sell),
        cash: at({ x: -hw + 1.85, z: hd - 1.35, w: 1.5, d: 1.5 }, parts.cash),
        goldMachine: at({ x: 2.4, z: 3 }, parts.goldMachine),
        goldInput: at({ x: 4.6, z: 3, w: 1.5, d: 1.5 }, parts.goldInput),
        goldGrid: at({ x: 0.45, z: 3, cols: GRID_COLS, rows: 2, cell: GRID_CELL }, parts.goldGrid),
        helperHire: at({ x: 4.6, z: 2.4, w: 1.6, d: 1.6 }, parts.helperHire),
        goldBuy: at({ x: 2.4, z: 4.4, w: 1.6, d: 1.6 }, parts.goldBuy),
    };
}

/** A floor square: an outline (dashed or not) with a word or an icon, on a dark wash. */
export function squareTexture(width: number, height: number, color: string, opts: { text?: string; icon?: string; egg?: boolean; dashed?: boolean; sub?: string; subColor?: string }): THREE.CanvasTexture {
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

/** The sign's size in the world (its width; its height follows the picture). */
const SIGN_WIDTH = 4.2;

export function signTexture(name: string, locked: boolean, level?: number): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 448;
    canvas.height = level ? 150 : 96;
    const g = canvas.getContext('2d')!;
    CanvasArt.plaque(g, 6, 6, 436, canvas.height - 12, 20);
    if (level) {
        // Not open yet: the padlock, its name, and the level it opens at.
        CanvasArt.drawIcon(g, 'Icon_Lock03', 54, 75, 64);
        CanvasArt.text(g, name, 256, 50, 38, '#ffe27a', 320);
        CanvasArt.text(g, `REACH LEVEL ${level}`, 256, 104, 40, '#ff8a7a', 320);
    } else if (locked) {
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
    /** Its egg spot (den-local). */
    egg: DenPoint;
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
    /**
     * The den's level reached: show it (the camera glides over to `at`, holds, glides back). Returns the seconds until
     * the camera's there (the opening plays then).
     */
    showUnlock?: (at: THREE.Vector3) => number;
}

/**
 * Unloading: standing on SELL with goods nobody in the queue wants (or nobody there) for this long, they go back onto
 * their grid one by one (stock the helpers sell later): the player always has somewhere to put things down.
 */
const UNLOAD_WAIT = 0.6;
const UNLOAD_SEC = 0.08;
/** The conveyor is offered once this many hens are in (automation comes early: the den should run alone soon). */
const BELT_AFTER_HENS = 4;

/** Confetti over a den opening at its level. */
const UNLOCK_CONFETTI = [0xff5a6e, 0xffd23f, 0x4fc3ff, 0x9cff6a, 0xc36bff, 0xffffff].map((c) => new THREE.Color(c));

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
    /** The den's first-visit lesson: the pointing hand (over what to do next) until the first customer's cash is taken. */
    private tutorialHand?: THREE.Sprite;
    private tutorialTime = 0;
    private dockDrawn = '';
    private trucks?: Trucks;
    private truckTimer = 0;
    private opened: boolean;
    /** Timers for moving items one at a time, and the machine's packing. */
    private pickTimer = 0;
    private dropTimer = 0;
    private trayTimer = 0;
    private sellTimer = 0;
    private unloadWait = 0;
    private packTimer = 0;
    private shownTrays = -1;
    private shownCash = -1;
    /** The boards and padlock across the gate while it's below its level (gone at the level: dropGate()). */
    private gateBoards?: THREE.Group;
    /** Where the player is (den-local), for the lesson's packer handing packs straight over. */
    private playerAt = { x: 1e6, z: 1e6 };
    /**
     * Buying (a hen, the conveyor, the dock: pourInto()): money still to pour this frame (a fraction carried over), the
     * square told about once per visit (level / money short), and whether the player stood on one this frame.
     */
    private pourCarry = 0;
    private pourTold = '';
    private pourTossed = 0;
    private onPour = false;

    public constructor(threeScene: THREE.Scene, public readonly def: DenDef, private readonly config: EggLoopDef, found: boolean,
        private readonly hooks: DenHooks, private readonly dock?: TruckDockDef, private readonly truckPath?: TruckPathPoint[]) {
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
        this.sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: signTexture(def.name.toUpperCase(), !found, this.levelLocked ? def.level : undefined), depthWrite: false }));
        this.fitSign();
        this.sign.position.set(0, 2.5, this.layoutOf.hd);
        // Over the floor squares (they're transparent too, drawn in order): last.
        this.sign.renderOrder = 20;
        this.group.add(this.sign);
        this.redraws.push(() => this.redrawSign());
        if (this.levelLocked) this.buildGateBoards();
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
        this.buildBelt();
        this.buildGold();
        if (found) this.startCustomers(threeScene);
        if (found && den.dock) this.startTrucks(threeScene);
        this.threeScene = threeScene;
        this.refreshNests();
    }

    private readonly threeScene: THREE.Scene;
    private gridDecal?: THREE.Mesh;

    // ---------------------------------------------------------------- the level it opens at

    /** Not open yet and below its level (DenDef.level): boarded up, can't be reached. */
    public get levelLocked(): boolean {
        return !this.opened && MowProgress.level < (this.def.level ?? 0);
    }

    /** What stands in its gate while it's below its level (world): the scene keeps the player out with it. */
    public gateBox(): Box {
        return { x: this.def.x, z: this.def.z + this.layoutOf.hd, halfX: this.def.gate / 2 + 0.1, halfZ: 0.3 };
    }

    private redrawSign(): void {
        this.sign.material.map = signTexture(this.def.name.toUpperCase(), !this.opened, this.levelLocked ? this.def.level : undefined);
        this.sign.material.needsUpdate = true;
        this.fitSign();
    }

    /** The sign sized to its picture (taller while it says the level). */
    private fitSign(): void {
        // Only while it's locked: open, its name over it is just more text.
        this.sign.visible = !this.opened && (this.levelLocked || !this.def.level);
        const image = this.sign.material.map?.image as { width: number; height: number } | undefined;
        const ratio = image ? image.height / image.width : 96 / 448;
        this.sign.scale.set(SIGN_WIDTH, SIGN_WIDTH * ratio, 1);
    }

    /** Boards nailed across the gate, crossed by two more, and a big padlock hung on them. */
    private buildGateBoards(): void {
        const boards = new THREE.Group();
        const wood = this.material(0x8a5a32);
        const width = this.def.gate + 0.2;
        for (const y of [0.35, 0.8, 1.25]) this.box(width, 0.22, 0.1, wood, 0, y, 0, boards);
        for (const turn of [0.5, -0.5]) this.box(width * 1.05, 0.16, 0.08, wood, 0, 0.8, 0.07, boards).rotation.z = turn;
        const lock = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.lockTexture(), depthWrite: false }));
        lock.scale.set(1, 1, 1);
        lock.position.set(0, 0.85, 0.3);
        lock.renderOrder = 20;
        boards.add(lock);
        this.redraws.push(() => {
            lock.material.map = this.lockTexture();
            lock.material.needsUpdate = true;
        });
        boards.position.set(0, 0, this.layoutOf.hd);
        this.group.add(boards);
        this.gateBoards = boards;
    }

    private lockTexture(): THREE.CanvasTexture {
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        CanvasArt.drawIcon(canvas.getContext('2d')!, 'Icon_Lock03', 64, 64, 112);
        return CanvasArt.texture(canvas);
    }

    /** The level's reached: the boards drop into the ground, the sign drops the level, and it's said. */
    private dropGate(): void {
        const boards = this.gateBoards;
        if (!boards) return;
        this.gateBoards = undefined;
        // The camera goes to show it (the scene takes control a moment); the opening plays once it's there.
        const gate = this.gate(new THREE.Vector3());
        const delay = this.hooks.showUnlock?.(gate) ?? 0;
        gsap.delayedCall(delay, () => this.playUnlock(boards, gate));
    }

    /**
     * The opening, for the camera: the padlock flies off spinning, the boards sink into the ground, the sign pops up
     * without its level, confetti and a puff at the gate, a fanfare, and it's said.
     */
    private playUnlock(boards: THREE.Group, gate: THREE.Vector3): void {
        // (The scene gone meanwhile: nothing to show.)
        if (!boards.parent || !this.group.parent) return;
        const lock = boards.children.find((child) => child instanceof THREE.Sprite) as THREE.Sprite | undefined;
        if (lock) {
            lock.removeFromParent();
            this.group.add(lock);
            lock.position.set(0, 0.85, this.layoutOf.hd + 0.3);
            gsap.to(lock.position, { y: 3.2, duration: 0.6, ease: 'power2.out' });
            gsap.to(lock.material, { rotation: Math.PI * 2, duration: 0.6 });
            gsap.to(lock.material, { opacity: 0, duration: 0.35, delay: 0.45, onComplete: () => void lock.removeFromParent() });
        }
        gsap.to(boards.position, { y: -1.6, duration: 0.9, delay: 0.25, ease: 'power2.in', onComplete: () => void boards.removeFromParent() });
        this.redrawSign();
        const to = this.sign.scale.clone();
        this.sign.scale.multiplyScalar(0.1);
        gsap.to(this.sign.scale, { x: to.x, y: to.y, duration: 0.7, delay: 0.3, ease: 'back.out(2)' });
        const effects = this.hooks.effects;
        effects.smoke(gate.clone().setY(0.6), 10, 1.2, new THREE.Color(0xfff2a0), 1.2);
        for (let wave = 0; wave < 3; wave++) {
            gsap.delayedCall(0.3 + wave * 0.2, () => {
                UNLOCK_CONFETTI.forEach((color) => effects.burst(new THREE.Vector3(gate.x + (Math.random() - 0.5) * 3, 0.5, gate.z + (Math.random() - 0.5) * 2), color, 5, 6));
            });
        }
        this.hooks.say(`${this.def.name.toUpperCase()} UNLOCKED! MOW YOUR WAY TO IT`, 0x9cff6a);
        MowAudio.play('buyFanfare');
        MowAudio.play('sparkle');
        MowAudio.play('cheer');
    }

    // ---------------------------------------------------------------- the helper, the gold machine and its belt

    private helper?: DenHelper;
    /** The trucks' helper (packs to the parked truck, its cash to the player). */
    private truckHelper?: DenHelper;
    /** What the parked truck's packs are worth so far (gold ones more): paid with its last. */
    private truckSale = 0;
    private readonly goldBody = new THREE.Group();
    private readonly goldStack = new THREE.Group();
    private goldInSquare?: THREE.Mesh;
    private goldGridDecal?: THREE.Mesh;
    private goldCanvas = document.createElement('canvas');
    private goldTexture?: THREE.CanvasTexture;
    private goldCounter?: THREE.Sprite;
    private goldDrawn = '';
    private goldTimer = 0;
    private goldDropTimer = 0;
    private goldPickTimer = 0;
    private shownGoldTrays = -1;
    private goldBelt?: ConveyorBelt;
    /** The three buy squares (helper, gold machine, gold belt): their mesh and what's drawn on it. */
    private readonly buySquares = new Map<string, { mesh: THREE.Mesh; drawn: string; w: number; d: number; x: number; z: number }>();

    /** The gold machine (a gold box, its counter), its drop square, its grid; the gold belt; the buy squares; the helper. */
    private buildGold(): void {
        const den = MowProgress.den;
        const gold = this.config.gold;
        const { goldMachine, goldInput, goldGrid, helperHire, goldBuy } = this.layoutOf;
        if (this.config.helper) this.buySquare('helper', helperHire);
        if (this.config.truckHelper && this.dock) {
            // By the dock unless placed (den-local).
            const placed = this.def.parts?.truckHelperHire;
            const at = placed ?? { x: this.dock.x - this.def.x, z: this.dock.z - this.def.z - 2 };
            this.buySquare('truckHelper', { x: at.x, z: at.z, w: placed?.w ?? 1.6, d: placed?.d ?? 1.6 });
        }
        if (gold) {
            this.goldBody.position.set(goldMachine.x, 0, goldMachine.z);
            this.box(1.4, 0.95, 1.1, 0xf2b230, 0, 0.5, 0, this.goldBody);
            this.box(1.46, 0.12, 1.16, 0xb8801c, 0, 0.06, 0, this.goldBody);
            this.box(0.9, 0.35, 0.8, 0xfff1c0, -0.1, 1.15, 0, this.goldBody);
            this.box(0.5, 0.12, 0.55, 0xfff1c0, 0.85, 0.42, 0, this.goldBody);
            this.group.add(this.goldBody);
            this.goldCanvas.width = 220;
            this.goldCanvas.height = 96;
            this.goldTexture = CanvasArt.texture(this.goldCanvas);
            this.goldCounter = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.goldTexture, depthWrite: false }));
            this.goldCounter.scale.set(1.3, 0.57, 1);
            this.goldCounter.position.set(goldMachine.x, 2, goldMachine.z);
            this.goldCounter.renderOrder = 20;
            this.group.add(this.goldCounter);
            this.goldInSquare = this.decal(squareTexture(goldInput.w, goldInput.d, '#ffd34d', { text: 'PACKS', dashed: true }), goldInput.w, goldInput.d, goldInput.x, goldInput.z);
            const canvas = document.createElement('canvas');
            const scale = 128;
            canvas.width = goldGrid.cols * goldGrid.cell * scale;
            canvas.height = goldGrid.rows * goldGrid.cell * scale;
            const g = canvas.getContext('2d')!;
            g.strokeStyle = '#ffd34d';
            g.lineWidth = 8;
            g.fillStyle = 'rgba(25, 35, 30, 0.35)';
            for (let r = 0; r < goldGrid.rows; r++) {
                for (let c = 0; c < goldGrid.cols; c++) {
                    g.beginPath();
                    g.roundRect(c * goldGrid.cell * scale + 6, r * goldGrid.cell * scale + 6, goldGrid.cell * scale - 12, goldGrid.cell * scale - 12, 14);
                    g.fill();
                    g.stroke();
                }
            }
            this.goldGridDecal = this.decal(CanvasArt.texture(canvas), goldGrid.cols * goldGrid.cell, goldGrid.rows * goldGrid.cell, goldGrid.x, goldGrid.z);
            this.goldStack.position.set(goldGrid.x, 0.06, goldGrid.z);
            this.group.add(this.goldStack);
            this.buySquare('gold', goldBuy);
        }
        if (gold && this.config.goldBelt) {
            const drawn = this.def.parts?.goldBelt;
            const { grid } = this.layoutOf;
            const points = drawn && drawn.length >= 2
                ? drawn.map((p) => new THREE.Vector2(p.x, p.z))
                : [new THREE.Vector2(grid.x, grid.z), new THREE.Vector2(goldInput.x, goldInput.z)];
            this.goldBelt = new ConveyorBelt(this.group, points, this.material(0x9aa3ad, { metalness: 0.4, roughness: 0.4 }), this.material(0x5a5f68));
            const start = this.def.parts?.goldBeltBuy ?? { x: points[0].x, z: points[0].y };
            this.buySquare('goldBelt', { x: start.x, z: start.z, w: this.def.parts?.goldBeltBuy?.w ?? 1.6, d: this.def.parts?.goldBeltBuy?.d ?? 1.6 });
        }
        this.refreshGold();
        if (den.helper) this.hireHelper(false);
        if (den.truckHelper) this.hireTruckHelper(false);
    }

    /** A buy square (`key`: helper, gold, goldBelt) at a spot, hidden until it's offered. */
    private buySquare(key: string, at: { x: number; z: number; w: number; d: number }): void {
        const mesh = this.decal(new THREE.Texture(), at.w, at.d, at.x, at.z);
        mesh.visible = false;
        this.buySquares.set(key, { mesh, drawn: '', ...at });
    }

    /** What's built shows, what's offered shows its buy square (with what's left to pay), the rest hides. */
    private refreshGold(): void {
        const den = MowProgress.den;
        const offers: Record<string, { offered: boolean; price: number; level: number; label: string } | undefined> = {
            helper: this.config.helper && { offered: this.opened && !!den.belt && !den.helper, price: this.config.helper.price, level: this.config.helper.level, label: 'HIRE HELPER' },
            truckHelper: this.config.truckHelper && { offered: this.opened && !!den.dock && !den.truckHelper, price: this.config.truckHelper.price, level: this.config.truckHelper.level, label: 'TRUCK HELPER' },
            gold: this.config.gold && { offered: this.opened && !!den.helper && !den.gold, price: this.config.gold.price, level: this.config.gold.level, label: 'GOLD MACHINE' },
            goldBelt: this.config.goldBelt && { offered: this.opened && !!den.gold && !den.goldBelt, price: this.config.goldBelt.price, level: this.config.goldBelt.level, label: 'GOLD BELT' },
        };
        for (const [key, square] of this.buySquares) {
            const offer = offers[key];
            square.mesh.visible = !!offer?.offered;
            if (!offer?.offered) continue;
            const short = MowProgress.level < offer.level;
            const left = Math.ceil(offer.price - MowProgress.paid(key));
            const drawn = `${left}|${short}`;
            if (drawn === square.drawn) continue;
            square.drawn = drawn;
            const material = square.mesh.material as THREE.MeshBasicMaterial;
            material.map = squareTexture(square.w, square.d, '#ffffff', { text: shortMoney(left), sub: short ? `LEVEL ${offer.level}` : offer.label, subColor: short ? '#ff8a7a' : '#9cff6a' });
            material.needsUpdate = true;
        }
        const gold = !!den.gold;
        this.goldBody.visible = gold;
        if (this.goldCounter) this.goldCounter.visible = gold;
        if (this.goldGridDecal) this.goldGridDecal.visible = gold;
        // With the gold belt, packs ride in on their own: no drop square, and the packing grid goes once it's empty.
        if (this.goldInSquare) this.goldInSquare.visible = gold && !den.goldBelt;
        if (this.goldBelt) this.goldBelt.group.visible = !!den.goldBelt;
        const gridShown = !den.goldBelt || den.trays > 0;
        if (this.gridDecal) this.gridDecal.visible = gridShown;
        if (gold && this.goldTexture) {
            const key = `${den.goldMachine ?? 0}`;
            if (key !== this.goldDrawn) {
                this.goldDrawn = key;
                counterTexture(this.goldCanvas, den.goldMachine ?? 0, this.config.gold!.max);
                this.goldTexture.needsUpdate = true;
            }
        }
        this.drawGoldTrays(den.goldTrays ?? 0);
    }

    /** The gold grid's packs (as the packing grid's: a layer at a time, big). */
    private drawGoldTrays(count: number): void {
        if (count === this.shownGoldTrays) return;
        this.shownGoldTrays = count;
        this.goldStack.clear();
        const { goldGrid } = this.layoutOf;
        const slots = goldGrid.cols * goldGrid.rows;
        for (let i = 0; i < count; i++) {
            const slot = i % slots;
            const tray = farmItem('goldTray');
            tray.scale.setScalar(GRID_TRAY_SCALE);
            tray.position.set(((slot % goldGrid.cols) - (goldGrid.cols - 1) / 2) * goldGrid.cell, Math.floor(i / slots) * ITEM_HEIGHT.tray * GRID_TRAY_SCALE,
                (Math.floor(slot / goldGrid.cols) - (goldGrid.rows - 1) / 2) * goldGrid.cell);
            this.goldStack.add(tray);
        }
    }

    /** The helper's in (a pop, or quietly on loading a save that has it). */
    /**
     * Where a helper picks packs up: the grid with the most on it (gold on a tie). Everyone takes either kind (gold pays
     * more); once everything's gold the plain grid runs dry and everyone's on the gold one.
     */
    private helperPickSpot(): { at: THREE.Vector3; kind: 'goldTray' | 'tray' } | null {
        const den = MowProgress.den;
        const { goldGrid, grid } = this.layoutOf;
        const gold = den.gold ? den.goldTrays ?? 0 : 0;
        const plain = den.trays;
        if (gold <= 0 && plain <= 0) return null;
        if (gold >= plain) return { at: new THREE.Vector3(goldGrid.x, 0, goldGrid.z + goldGrid.rows * goldGrid.cell / 2 + 0.3), kind: 'goldTray' };
        return { at: new THREE.Vector3(grid.x, 0, grid.z + grid.rows * grid.cell / 2 + 0.3), kind: 'tray' };
    }

    /** A pack of `kind` off its grid for a helper; false if there's none. */
    private helperTake(kind: 'goldTray' | 'tray'): boolean {
        const den = MowProgress.den;
        if (kind === 'goldTray' ? (den.goldTrays ?? 0) <= 0 : den.trays <= 0) return false;
        if (kind === 'goldTray') den.goldTrays = (den.goldTrays ?? 0) - 1;
        else den.trays--;
        MowProgress.denChanged();
        return true;
    }

    /** The trucks' helper: packs to the parked truck at the dock, the truck's cash to the player. */
    private hireTruckHelper(fanfare: boolean): void {
        const helper = this.config.truckHelper;
        const dock = this.dock;
        if (!helper || !dock || this.truckHelper) return;
        const at = new THREE.Vector3(dock.x - this.def.x, 0, dock.z - this.def.z);
        this.truckHelper = new DenHelper(this.group, at.clone().add(new THREE.Vector3(0, 0, -1)), helper.carry, helper.walkSpeed, {
            pickSpot: () => this.helperPickSpot(),
            take: (kind) => this.helperTake(kind as 'goldTray' | 'tray'),
            sellSpot: () => at.clone(),
            cashSpot: () => new THREE.Vector3(this.truckCash.x, 0, this.truckCash.z),
            serve: (kind, from) => this.handOverTruck(kind as 'goldTray' | 'tray', from.clone().add(this.group.position)),
            cashWaiting: () => MowProgress.den.truckCash ?? 0,
            collect: () => {
                const den = MowProgress.den;
                const amount = den.truckCash ?? 0;
                if (amount <= 0) return;
                den.truckCash = 0;
                this.collect(amount, this.truckCash);
            },
        });
        if (fanfare) this.popIn(this.truckHelper.root);
    }

    /** A pack of `kind` from `from` (world) into the parked truck (the player's or the truck helper's). False: none parked. */
    private handOverTruck(kind: 'goldTray' | 'tray', from: THREE.Vector3): boolean {
        const trucks = this.trucks;
        const dock = this.dock;
        if (!trucks?.parked || !dock) return false;
        // A gold pack's worth to a truck: its price, by as much as gold's worth over a plain pack at the counter.
        const goldRatio = (this.config.gold?.trayPrice ?? this.config.trayPrice) / this.config.trayPrice;
        this.truckSale += kind === 'goldTray' ? Math.round(dock.trayPrice * goldRatio) : dock.trayPrice;
        const last = trucks.give();
        this.hooks.xp('traySold');
        const bed = trucks.bed();
        const value = this.truckSale;
        if (last) this.truckSale = 0;
        this.hooks.effects.toss(from, bed, new THREE.Color(kind === 'goldTray' ? 0xffc83d : 0xe2c48e), 0, () => {
            this.sound('item');
            if (!last) return;
            this.sound('buyCash');
            this.payFrom(bed, value);
        }, farmItem(kind));
        return true;
    }

    private hireHelper(fanfare: boolean): void {
        const helper = this.config.helper;
        if (!helper || this.helper) return;
        const { sell } = this.layoutOf;
        this.helper = new DenHelper(this.group, new THREE.Vector3(sell.x + 1, 0, sell.z), helper.carry, helper.walkSpeed, {
            pickSpot: () => this.helperPickSpot(),
            take: (kind) => this.helperTake(kind as 'goldTray' | 'tray'),
            sellSpot: () => new THREE.Vector3(this.layoutOf.sell.x, 0, this.layoutOf.sell.z),
            cashSpot: () => new THREE.Vector3(this.layoutOf.cash.x, 0, this.layoutOf.cash.z),
            serve: (kind, from) => this.handOver(kind as 'goldTray' | 'tray', from.clone().add(this.group.position)),
            cashWaiting: () => MowProgress.den.cash,
            collect: () => {
                const den = MowProgress.den;
                if (den.cash <= 0) return;
                const amount = den.cash;
                den.cash = 0;
                this.collect(amount, this.layoutOf.cash);
            },
        });
        if (fanfare) this.popIn(this.helper.root);
    }

    /** The gold machine's loop: its buy squares, the drop square, the making, its grid, the gold belt. */
    private goldLoop(delta: number, p: { x: number; z: number }): void {
        this.refreshGold();
        const den = MowProgress.den;
        // Buying: on an offered square, the money pours in.
        for (const [key, square] of this.buySquares) {
            if (!square.mesh.visible || !this.onSquare(p, square)) continue;
            const config = key === 'helper' ? this.config.helper : key === 'truckHelper' ? this.config.truckHelper : key === 'gold' ? this.config.gold : this.config.goldBelt;
            if (!config) continue;
            const label = key === 'helper' ? 'THE HELPER' : key === 'truckHelper' ? 'THE TRUCK HELPER' : key === 'gold' ? 'THE GOLD MACHINE' : 'THE GOLD BELT';
            if (!this.pourInto(key, config.price, config.level, this.world(square.x, 0.1, square.z), delta, label)) continue;
            this.sound('buyFanfare');
            this.hooks.xp('hen');
            if (key === 'helper') {
                den.helper = true;
                GameAnalytics.den(this.def.id, 'helper');
                this.hooks.say('HELPER HIRED!', 0x9cff6a);
                this.hireHelper(true);
            } else if (key === 'truckHelper') {
                den.truckHelper = true;
                GameAnalytics.den(this.def.id, 'truck-helper');
                this.hooks.say('TRUCK HELPER HIRED!', 0x9cff6a);
                this.hireTruckHelper(true);
            } else if (key === 'gold') {
                den.gold = true;
                GameAnalytics.den(this.def.id, 'gold');
                this.hooks.say('GOLD MACHINE!', 0x9cff6a);
                this.popIn(this.goldBody);
            } else {
                den.goldBelt = true;
                GameAnalytics.den(this.def.id, 'gold-belt');
                this.hooks.say('EVERYTHING IS GOLD NOW!', 0xffe27a);
                if (this.goldBelt) this.popIn(this.goldBelt.group);
            }
            MowProgress.denChanged();
            this.refreshGold();
        }
        const gold = this.config.gold;
        if (!gold || !den.gold) return;
        // The gold belt: packs ride in, into the machine while it has room.
        if (den.goldBelt && this.goldBelt) {
            this.goldBelt.update(delta, this.config.goldBelt!.speed, this.config.goldBelt!.spacing, () => {
                if ((den.goldMachine ?? 0) >= gold.max) return false;
                den.goldMachine = (den.goldMachine ?? 0) + 1;
                MowProgress.denChanged();
                return true;
            });
        }
        // By hand (before the belt): packs carried onto its drop square go in.
        this.goldDropTimer -= delta;
        if (!den.goldBelt && this.goldDropTimer <= 0 && MowProgress.goods.trays > 0 && (den.goldMachine ?? 0) < gold.max && this.onSquare(p, this.layoutOf.goldInput)) {
            this.goldDropTimer = DROP_EGG_SEC * 2;
            MowProgress.carry('trays', -1);
            den.goldMachine = (den.goldMachine ?? 0) + 1;
            MowProgress.denChanged();
            const { goldMachine } = this.layoutOf;
            this.hooks.effects.toss(this.hooks.carryPoint(), this.world(goldMachine.x - 0.1, 1.35, goldMachine.z), new THREE.Color(0xe2c48e), 0, () => {}, farmItem('tray'));
        }
        // Making: a pack in, a gold pack out, while its grid has room.
        const room = gold.slots * gold.layers;
        if ((den.goldMachine ?? 0) > 0 && (den.goldTrays ?? 0) < room) {
            this.goldTimer += delta;
            this.goldBody.position.x = this.layoutOf.goldMachine.x + Math.sin(this.goldTimer * 40) * 0.015;
            if (this.goldTimer >= gold.packSec / MowProgress.farmSpeed) {
                this.goldTimer = 0;
                den.goldMachine = (den.goldMachine ?? 0) - 1;
                den.goldTrays = (den.goldTrays ?? 0) + 1;
                MowProgress.denChanged();
                this.hooks.xp('tray');
                this.goldBody.position.x = this.layoutOf.goldMachine.x;
            }
        } else this.goldTimer = 0;
        // Its grid: gold packs into the backpack (their own carry limit).
        this.goldPickTimer -= delta;
        const { goldGrid } = this.layoutOf;
        if (this.goldPickTimer <= 0 && (den.goldTrays ?? 0) > 0 && (MowProgress.goods.goldTrays ?? 0) < this.config.carryMax
            && this.onSquare(p, { x: goldGrid.x, z: goldGrid.z, w: goldGrid.cols * goldGrid.cell + 0.4, d: goldGrid.rows * goldGrid.cell + 0.4 })) {
            this.goldPickTimer = PICK_TRAY_SEC;
            den.goldTrays = (den.goldTrays ?? 0) - 1;
            MowProgress.denChanged();
            MowProgress.carry('goldTrays', 1);
            this.hooks.effects.pickup(this.world(goldGrid.x, 0.2, goldGrid.z), new THREE.Color(0xffc83d), () => this.sound('item'), farmItem('goldTray'));
        }
    }

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

    /** The player is at the gate (mowed their way up to it), or already in; never while it's below its level. */
    public reached(x: number, z: number): boolean {
        if (this.levelLocked) return false;
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
            const egg = this.layoutOf.eggs[i];
            this.box(1.2, 0.42, 0.85, 0x8a5a32, x, 0.21, z);
            const bed = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.46, 0.1, 12), straw);
            bed.position.set(x, 0.46, z);
            this.group.add(bed);
            const hen = new Animal('animals/animal-chick.glb', HEN_HEIGHT);
            hen.object.position.set(x, 0.48, z);
            this.group.add(hen.object);
            // The spot the eggs drop to: a straw mat.
            const mat = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.03, 16), straw);
            mat.position.set(egg.x, 0.05, egg.z);
            this.group.add(mat);
            const eggs = new THREE.Group();
            eggs.position.set(egg.x, 0.065, egg.z);
            this.group.add(eggs);
            const buy = this.decal(new THREE.Texture(), 1.4, 1.4, egg.x, egg.z);
            const padlock = new THREE.Sprite(new THREE.SpriteMaterial({ map: lockTexture, depthWrite: false }));
            padlock.scale.set(0.7, 0.7, 1);
            padlock.position.set(x, 1.3, z);
            padlock.renderOrder = 20;
            this.group.add(padlock);
            this.nests.push({ x, egg, hen, buy, buyDrawn: '', lock: padlock, eggs, layTimer: this.config.layEverySec * (0.4 + i * 0.25) });
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
        this.gridDecal = this.decal(CanvasArt.texture(gridCanvas), grid.cols * grid.cell, grid.rows * grid.cell, grid.x, grid.z);
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
        // The level's customer paths (the editor's: in from where they come, out to where they go), when drawn.
        const paths = this.customerPaths;
        this.customers = new Customers(threeScene, slots, entry, () => spawnPoint('people') ?? entry.clone(), new THREE.Vector3(1, 0, 0),
            { wants: this.config.wants, queue: this.config.queue, everySec: this.config.customerEverySec }, paths);
        // The lesson: the first customers want one pack each, as many as the waiting eggs make.
        if (!this.tutorialDone) this.customers.firstOnes = Math.max(1, Math.floor(this.startEggs / this.config.eggsPerTray));
    }

    /** The eggs waiting on the first hen's spot on the first visit (EggLoopDef.startEggs, else a full spot). */
    private get startEggs(): number {
        return this.config.startEggs ?? this.config.floorMax;
    }

    /** The customers' paths in and out (TownLevel farm.peopleIn / peopleOut, 2+ points each), or undefined. */
    private get customerPaths(): { in: THREE.Vector3[]; out: THREE.Vector3[] } | undefined {
        const farm = TOWN.farm;
        if ((farm?.peopleIn?.length ?? 0) < 2 || (farm?.peopleOut?.length ?? 0) < 2) return undefined;
        const v = (p: { x: number; z: number }) => new THREE.Vector3(p.x, 0, p.z);
        return { in: farm!.peopleIn!.map(v), out: farm!.peopleOut!.map(v) };
    }

    /** The trucks: from a `trucks` spawn area over the roads to the road nearest the dock's square. */
    private startTrucks(threeScene: THREE.Scene): void {
        const dock = this.dock;
        if (this.trucks || !dock) return;
        // The level's truck path (the editor's): in along it to its park point, then on out through the rest (no park
        // point: park at its end, back the same way).
        const own = this.truckPath ?? [];
        if (own.length >= 2) {
            const points = own.map((p) => new THREE.Vector3(p.x, 0, p.z));
            const marked = own.findIndex((p) => p.park);
            const park = marked > 0 ? marked : points.length - 1;
            const path = points.slice(0, park + 1);
            const out = park < points.length - 1 ? points.slice(park) : [...path].reverse();
            const last = path[path.length - 1];
            const before = path[path.length - 2];
            this.trucks = new Trucks(threeScene, dock, path, out, Math.atan2(last.x - before.x, last.z - before.z));
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
                const left = Math.ceil(hen.price - MowProgress.paid(`hen:${i}`));
                const key = `${left}|${short}`;
                if (key !== nest.buyDrawn) {
                    nest.buyDrawn = key;
                    const material = nest.buy.material as THREE.MeshBasicMaterial;
                    material.map = squareTexture(1.4, 1.4, '#ffffff', {
                        text: shortMoney(left), sub: short ? `LEVEL ${hen.level}` : 'NEW HEN', subColor: short ? '#ff8a7a' : '#9cff6a',
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
        // (The trucks come after the den's lesson: their square pops in once it's done.)
        const shown = this.opened && this.tutorialDone;
        if (shown && !square.visible) this.popIn(square);
        square.visible = shown;
        const open = !!MowProgress.den.dock;
        const short = MowProgress.level < dock.level;
        const key = `${open}|${short}|${Math.ceil(MowProgress.paid('dock'))}`;
        if (key === this.dockDrawn) return;
        this.dockDrawn = key;
        const material = square.material as THREE.MeshBasicMaterial;
        material.map = open
            ? squareTexture(1.6, 1.6, '#4fe3ff', { text: 'TRUCK' })
            : squareTexture(1.6, 1.6, '#ffffff', { text: shortMoney(Math.ceil(dock.price - MowProgress.paid('dock'))), sub: short ? `LEVEL ${dock.level}` : 'TRUCKS', subColor: short ? '#ff8a7a' : '#9cff6a' });
        material.needsUpdate = true;
    }

    /** A nest's eggs on its mat: up to six in a little heap (two layers of three). */
    private drawEggs(nest: Nest, count: number): void {
        if (nest.eggs.children.length === count) return;
        nest.eggs.clear();
        for (let i = 0; i < count; i++) {
            const egg = farmItem('egg');
            egg.scale.setScalar(EGG_SCALE);
            const layer = Math.floor(i / 4);
            const k = i % 4;
            egg.position.set(((k % 2 - 0.5) * 0.24 + layer * 0.05) * EGG_SCALE, layer * 0.2 * EGG_SCALE, (Math.floor(k / 2) - 0.5) * 0.24 * EGG_SCALE);
            egg.rotation.z = (i % 3 - 1) * 0.2;
            nest.eggs.add(egg);
        }
    }

    /** The machine's grid: packs on their slots, a layer at a time (each piled up to trayLayers), drawn big. */
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
            tray.scale.setScalar(GRID_TRAY_SCALE);
            tray.position.set(((slot % grid.cols) - (grid.cols - 1) / 2) * grid.cell, layer * ITEM_HEIGHT.tray * GRID_TRAY_SCALE, (Math.floor(slot / grid.cols) - (grid.rows - 1) / 2) * grid.cell);
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
        // The lesson: the first hen's spot already full of eggs (one pick-up is all the first customers need).
        if (!this.tutorialDone) den.floor[0] = Math.max(den.floor[0] ?? 0, this.startEggs);
        MowProgress.denChanged();
        this.redrawSign();
        const to = this.sign.scale.clone();
        this.sign.scale.set(0.1, 0.02, 1);
        gsap.to(this.sign.scale, { x: to.x, y: to.y, duration: 0.7, ease: 'back.out(2)' });
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
    /** The market's hunger from the stock waiting (bigger orders, more often, with a big pile: stockDemand()). */
    private readonly marketDemand = (): number => stockDemand(MowProgress.den.trays + (MowProgress.den.goldTrays ?? 0));

    public update(delta: number, player: THREE.Vector3): void {
        if (this.customers) this.customers.demand = this.marketDemand;
        if (this.trucks) this.trucks.demand = this.marketDemand;
        this.playerNear = Math.hypot(player.x - this.def.x, player.z - this.def.z) <= SOUND_RANGE + Math.max(this.def.width, this.def.depth) / 2;
        this.playerAt = this.local(player.x, player.z);
        if (this.gateBoards && !this.levelLocked) this.dropGate();
        // (Set again by any buy square stood on this frame: pourInto().)
        this.onPour = false;
        for (const nest of this.nests) nest.hen.update(delta);
        if (this.opened) this.beltLoop(delta, this.local(player.x, player.z));
        this.customers?.update(delta);
        this.drawMachine();
        this.drawTrays(MowProgress.den.trays);
        this.drawCash(MowProgress.den.cash);
        if (!this.opened) return;
        this.lay(delta);
        this.pack(delta);
        this.goldLoop(delta, this.local(player.x, player.z));
        this.helper?.update(delta);
        this.truckHelper?.update(delta);
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
        this.updateTutorial(delta, p);
        if (!this.onPour && !this.beltOnSquare) {
            this.pourCarry = 0;
            this.pourTold = '';
        }
    }

    /**
     * Pours money into `key` (`price` in all, needing `level`) from what the player carries first, then the den's cash
     * piles: a bit each frame, kept between visits (MowProgress.paid), so it's never all-or-nothing. True once paid
     * (the poured money's cleared then). `at`: the square (the notes fly there); `what`: for "REACH LEVEL n FOR ...".
     */
    private pourInto(key: string, price: number, level: number, at: THREE.Vector3, delta: number, what: string): boolean {
        this.onPour = true;
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

    /** Each hen lays on its floor spot (a hop, the egg dropping down), up to floorMax there. */
    private lay(delta: number): void {
        const den = MowProgress.den;
        const { hd } = this.layoutOf;
        this.nests.forEach((nest, i) => {
            if (i >= den.hens) return;
            nest.layTimer -= delta;
            if (nest.layTimer > 0) return;
            nest.layTimer = this.config.layEverySec / MowProgress.farmSpeed;
            if ((den.floor[i] ?? 0) >= this.config.floorMax) return;
            den.floor[i] = (den.floor[i] ?? 0) + 1;
            MowProgress.denChanged();
            gsap.fromTo(nest.hen.object.position, { y: 0.48 }, { y: 0.68, duration: 0.15, yoyo: true, repeat: 1, ease: 'power1.out' });
            nest.hen.play('eat');
            gsap.delayedCall(0.8, () => nest.hen.play('idle'));
            const from = this.world(nest.x, 0.7, -hd + NEST_Z);
            const to = this.world(nest.egg.x, 0.08, nest.egg.z);
            const laid = farmItem('egg');
            laid.scale.setScalar(EGG_SCALE);
            this.hooks.effects.toss(from, to, new THREE.Color(0xfff0d0), 0, () => this.refreshNests(), laid);
        });
    }

    /** The machine packs a tray whenever it has the eggs for one and its grid has room. */
    private pack(delta: number): void {
        const den = MowProgress.den;
        const room = this.config.traySlots * (this.config.trayLayers ?? 2);
        // With the gold belt: onto it while it has room; backed up (the gold machine and its grid full), onto the white
        // grid instead — both piles fill up.
        const toBelt = !!den.goldBelt && !!this.goldBelt && this.goldBelt.roomAtStart(this.config.goldBelt?.spacing ?? 0.7);
        const full = !toBelt && den.trays >= room;
        if (den.machine < this.config.eggsPerTray || full) {
            this.packTimer = 0;
            return;
        }
        this.packTimer += delta;
        // Working: a little shudder.
        this.machineBody.position.x = this.layoutOf.machine.x + Math.sin(this.packTimer * 40) * 0.015;
        // The lesson: packed at once, and (the player at the machine, with room) straight into their backpack.
        const lesson = !this.tutorialDone;
        if (this.packTimer < (lesson ? LESSON_PACK_SEC : this.config.packSec / MowProgress.farmSpeed)) return;
        this.packTimer = 0;
        den.machine -= this.config.eggsPerTray;
        const { machine, input } = this.layoutOf;
        const atMachine = Math.hypot(this.playerAt.x - input.x, this.playerAt.z - input.z) <= LESSON_REACH;
        if (lesson && !toBelt && atMachine && MowProgress.goodsCount < this.config.carryMax) {
            MowProgress.carry('trays', 1);
            MowProgress.denChanged();
            GameAnalytics.den(this.def.id, 'pack');
            this.hooks.xp('tray');
            this.hooks.effects.pickup(this.world(machine.x, 1, machine.z), new THREE.Color(0xe2c48e), () => this.sound('item'), farmItem('tray'));
            this.machineBody.position.x = machine.x;
            return;
        }
        if (toBelt) {
            const pack = farmItem('tray');
            pack.scale.setScalar(GRID_TRAY_SCALE);
            this.goldBelt!.add(pack);
        } else den.trays++;
        MowProgress.denChanged();
        this.hooks.xp('tray');
        this.machineBody.position.x = this.layoutOf.machine.x;
    }

    /** Next to a nest's eggs: they fly into the backpack, one at a time. */
    private pickEggs(delta: number, p: { x: number; z: number }): void {
        this.pickTimer -= delta;
        if (this.pickTimer > 0 || MowProgress.goods.eggs >= this.config.carryMax) return;
        const den = MowProgress.den;
        const { hd } = this.layoutOf;
        const i = this.nests.findIndex((nest, n) => n < den.hens && (den.floor[n] ?? 0) > 0 && Math.hypot(p.x - nest.egg.x, p.z - nest.egg.z) <= EGG_REACH);
        if (i < 0) return;
        this.pickTimer = PICK_EGG_SEC;
        den.floor[i]--;
        MowProgress.denChanged();
        MowProgress.carry('eggs', 1);
        GameAnalytics.den(this.def.id, 'egg');
        this.refreshNests();
        this.hooks.xp('egg');
        this.hooks.effects.pickup(this.world(this.nests[i].egg.x, 0.15, this.nests[i].egg.z), new THREE.Color(0xfff0d0), () => this.sound('item'), farmItem('egg'));
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
        if (this.trayTimer > 0 || den.trays <= 0 || MowProgress.goods.trays >= this.config.carryMax) return;
        const { grid } = this.layoutOf;
        if (!this.onSquare(p, { x: grid.x, z: grid.z, w: grid.cols * grid.cell + 0.4, d: grid.rows * grid.cell + 0.4 })) return;
        this.trayTimer = PICK_TRAY_SEC;
        den.trays--;
        MowProgress.denChanged();
        MowProgress.carry('trays', 1);
        GameAnalytics.den(this.def.id, 'pack');
        this.hooks.effects.pickup(this.world(grid.x, 0.2, grid.z), new THREE.Color(0xe2c48e), () => this.sound('item'), farmItem('tray'));
    }

    /** On the SELL square: trays go to the customer at the counter; their last one paid, the cash lands on its square. */
    private sell(delta: number, p: { x: number; z: number }): void {
        this.sellTimer -= delta;
        const customer = this.customers?.front;
        const gold = (MowProgress.goods.goldTrays ?? 0) > 0;
        const onSell = this.onSquare(p, this.layoutOf.sell);
        const carrying = gold || MowProgress.goods.trays > 0;
        // Nobody to sell to: unload onto the grids instead (after a moment).
        this.unloadWait = onSell && carrying && !customer ? this.unloadWait + delta : 0;
        if (this.unloadWait >= UNLOAD_WAIT && this.sellTimer <= 0) {
            this.sellTimer = UNLOAD_SEC;
            const den = MowProgress.den;
            MowProgress.carry(gold ? 'goldTrays' : 'trays', -1);
            if (gold) den.goldTrays = (den.goldTrays ?? 0) + 1;
            else den.trays++;
            MowProgress.denChanged();
            const grid = gold ? this.layoutOf.goldGrid : this.layoutOf.grid;
            this.hooks.effects.toss(this.hooks.carryPoint(), this.world(grid.x, 0.3, grid.z), new THREE.Color(0xe2c48e), 0, () => this.sound('item'), farmItem(gold ? 'goldTray' : 'tray'));
            return;
        }
        if (this.sellTimer > 0 || !customer || !carrying || !onSell) return;
        this.sellTimer = SELL_TRAY_SEC;
        MowProgress.carry(gold ? 'goldTrays' : 'trays', -1);
        this.handOver(gold ? 'goldTray' : 'tray', this.hooks.carryPoint());
        GameAnalytics.den(this.def.id, 'sale');
    }

    /** What each customer's packs are worth so far (gold ones more): paid all at once with their last. */
    private readonly saleValue = new WeakMap<object, number>();

    /** A pack of `kind` from `from` (world) to the customer at the counter (the player's, or the helper's). False: no one there. */
    private handOver(kind: 'goldTray' | 'tray', from: THREE.Vector3): boolean {
        const customer = this.customers?.front;
        if (!customer) return false;
        const customers = this.customers!;
        const to = customers.handsOf(customer);
        // Counted as handed over now (so the next one isn't sent for nothing), told when it lands.
        const last = customer.got + 1 >= customer.wants;
        const value = (this.saleValue.get(customer) ?? 0) + (kind === 'goldTray' ? this.config.gold?.trayPrice ?? this.config.trayPrice : this.config.trayPrice);
        this.saleValue.set(customer, value);
        customers.give(customer);
        this.hooks.xp('traySold');
        this.hooks.effects.toss(from, to, new THREE.Color(kind === 'goldTray' ? 0xffc83d : 0xe2c48e), 0, () => {
            this.sound('item');
            if (!last) return;
            this.sound('buyCash');
            this.pay(value);
        }, farmItem(kind));
        return true;
    }

    /** A customer pays: notes fly from the counter onto the cash square. */
    private pay(amount: number): void {
        // Money Gain boosts the den's takings too.
        amount = MowProgress.farmPay(amount);
        const den = MowProgress.den;
        den.cash += amount;
        MowProgress.denChanged();
        const { counter, cash } = this.layoutOf;
        const bundles = Math.min(6, Math.ceil(amount / CASH_PER_BUNDLE));
        for (let i = 0; i < bundles; i++) {
            this.hooks.effects.toss(this.world(counter.x, 1.1, counter.z), this.world(cash.x, 0.1, cash.z), new THREE.Color(0x5fc85a), i * 0.06,
                () => this.sound('coins'), farmItem('cash'));
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
        if (!this.tutorialDone) {
            den.tutorial = true;
            GameAnalytics.den(this.def.id, 'tutorial');
            MowProgress.denChanged();
            this.hooks.say('THE TRUCKS ARE FOR SALE!', 0x9cff6a);
        }
    }

    /** `amount` taken off the cash square `cash` (den-local): the notes fly to the player. */
    private collect(amount: number, cash: { x: number; z: number }): void {
        MowProgress.denChanged();
        MowProgress.addMoney(amount);
        const bundles = Math.min(8, Math.ceil(amount / CASH_PER_BUNDLE));
        for (let i = 0; i < bundles; i++) {
            this.hooks.effects.pickup(this.world(cash.x, 0.2 + i * 0.05, cash.z), new THREE.Color(0x5fc85a), () => this.sound('coins'), farmItem('cash'));
        }
        this.hooks.effects.floatText(this.world(cash.x, 1.8, cash.z), `+${shortMoney(amount)}`, '#ffe27a');
    }

    /** On the next nest's square: with the money and the level, the money pours in and a new hen pops onto the nest. */
    private buyHen(delta: number, p: { x: number; z: number }): void {
        const den = MowProgress.den;
        const i = den.hens;
        const hen = this.config.hens[i];
        if (!hen || Math.hypot(p.x - this.nests[i].egg.x, p.z - this.nests[i].egg.z) > 0.7) return;
        const at = this.world(this.nests[i].egg.x, 0.1, this.nests[i].egg.z);
        const done = this.pourInto(`hen:${i}`, hen.price, hen.level, at, delta, 'THIS HEN');
        this.refreshNests();
        if (!done) return;
        den.hens++;
        GameAnalytics.den(this.def.id, `hen-${String(den.hens).padStart(2, '0')}`);
        MowProgress.denChanged();
        this.hooks.xp('hen');
        this.sound('buyFanfare');
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
            if (!on || !this.dockSquare?.visible) return;
            const done = this.pourInto('dock', dock.price, dock.level, new THREE.Vector3(dock.x, 0.1, dock.z), delta, 'THE TRUCKS');
            this.dockDrawn = '';
            if (!done) return;
            den.dock = true;
            GameAnalytics.den(this.def.id, 'dock');
            MowProgress.denChanged();
            this.hooks.xp('hen');
            this.sound('buyFanfare');
            this.hooks.say('TRUCKS ARE COMING!', 0x9cff6a);
            this.startTrucks(this.threeScene);
            return;
        }
        this.truckTimer -= delta;
        const trucks = this.trucks;
        const gold = (MowProgress.goods.goldTrays ?? 0) > 0;
        if (!on || !trucks?.parked || this.truckTimer > 0 || (!gold && MowProgress.goods.trays <= 0)) return;
        this.truckTimer = SELL_TRAY_SEC * 0.7;
        MowProgress.carry(gold ? 'goldTrays' : 'trays', -1);
        this.handOverTruck(gold ? 'goldTray' : 'tray', this.hooks.carryPoint());
    }

    // ---------------------------------------------------------------- the first visit's lesson

    /** Done: the first customer's cash was taken (or the den's further along than the lesson: an older save). */
    private get tutorialDone(): boolean {
        const den = MowProgress.den;
        return !!den.tutorial || !!den.dock || !!den.belt || den.hens > 1;
    }

    /**
     * Where the lesson's hand points now (den-local), from what's going on, so it never gets stuck: the cash waiting ->
     * the cash square; packs carried -> SELL; packs on the grid -> the grid; eggs carried -> the machine's EGGS square;
     * the machine packing -> the grid (the pack's coming); else -> the eggs on the floor (the first hen's).
     */
    private tutorialTarget(): { x: number; z: number } | null {
        const den = MowProgress.den;
        const goods = MowProgress.goods;
        const { cash, sell, grid, input } = this.layoutOf;
        if (den.cash > 0) return cash;
        if (goods.trays > 0 || (goods.goldTrays ?? 0) > 0) return sell;
        if (den.trays > 0) return grid;
        if (goods.eggs > 0) return input;
        if (den.machine >= this.config.eggsPerTray) return grid;
        const laid = this.nests.findIndex((nest, i) => i < den.hens && (den.floor[i] ?? 0) > 0);
        const nest = this.nests[Math.max(0, laid)];
        return nest ? nest.egg : null;
    }

    /** The pointing hand over the lesson's next step while the player's in the den (its first visit: until done). */
    private updateTutorial(delta: number, p: { x: number; z: number }): void {
        const inside = Math.abs(p.x) < this.layoutOf.hw && Math.abs(p.z) < this.layoutOf.hd;
        const target = this.opened && !this.tutorialDone && inside ? this.tutorialTarget() : null;
        if (!target) {
            if (this.tutorialHand) this.tutorialHand.visible = false;
            return;
        }
        const hand = this.tutorialHand ?? this.makeTutorialHand();
        if (!hand) return;
        this.tutorialTime += delta;
        hand.visible = true;
        // Tapping down at it.
        hand.position.copy(this.world(target.x, HAND.lift + Math.abs(Math.sin(this.tutorialTime * 4)) * HAND.bob, target.z));
    }

    /** The UI's pointing hand (handHud), turned to point down, its fingertip at the sprite's position. Null: the atlas isn't ready. */
    private makeTutorialHand(): THREE.Sprite | undefined {
        const image = CanvasArt.atlasImage('handHud') as (CanvasImageSource & { width: number; height: number }) | null;
        if (!image) return undefined;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 256;
        const g = canvas.getContext('2d')!;
        // The hand's fingertip is up-left in the picture; half a turn points it down-right.
        g.translate(256, 256);
        g.rotate(Math.PI);
        g.drawImage(image, 0, 0, 256, 256);
        const texture = CanvasArt.texture(canvas);
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, depthWrite: false, transparent: true }));
        sprite.center.set(1 - HAND.tipX, HAND.tipY);
        sprite.scale.set(HAND.size, HAND.size, 1);
        sprite.renderOrder = 40;
        this.threeScene.add(sprite);
        this.tutorialHand = sprite;
        return sprite;
    }

    /** The den's sounds: only heard with the player near it (SOUND_RANGE from its middle). */
    private sound(name: Parameters<typeof MowAudio.play>[0], ...rest: unknown[]): void {
        if (!this.playerNear) return;
        (MowAudio.play as (name: unknown, ...more: unknown[]) => void)(name, ...rest);
    }

    /** The player's within earshot (set each update). */
    private playerNear = false;

    // ---------------------------------------------------------------- the conveyor belt

    /** The belt's path (den-local, start to end), its segments' lengths and the whole length. */
    private belt: { points: THREE.Vector2[]; lengths: number[]; total: number } = { points: [], lengths: [], total: 0 };
    private readonly beltGroup = new THREE.Group();
    private beltTexture?: THREE.CanvasTexture;
    private beltSquare?: THREE.Mesh;
    private beltDrawn = '';
    /** Eggs on the belt: how far along (from its start), their model. */
    private readonly beltEggs: { s: number; object: THREE.Object3D }[] = [];
    /** Per egg spot: the next egg it sends, and where along the belt it joins. */
    private beltTake: number[] = [];
    private beltJoin: number[] = [];

    /** Its path: the editor's (DenDef.parts.belt), else from the egg row's far end along its front to over the EGGS drop, then down into it. */
    private beltPath(): THREE.Vector2[] {
        const drawn = this.def.parts?.belt;
        if (drawn && drawn.length >= 2) return drawn.map((p) => new THREE.Vector2(p.x, p.z));
        const { eggs, input } = this.layoutOf;
        const z = Math.max(...eggs.map((e) => e.z)) + BELT.front;
        const left = Math.min(...eggs.map((e) => e.x)) - 0.4;
        const right = Math.max(...eggs.map((e) => e.x)) + 0.4;
        const far = Math.abs(left - input.x) > Math.abs(right - input.x) ? left : right;
        return [new THREE.Vector2(far, z), new THREE.Vector2(input.x, z), new THREE.Vector2(input.x, input.z)];
    }

    /** The belt: a dark band (its surface's stripes scroll) on rails along each stretch, a roller at each corner; and its buy square. */
    private buildBelt(): void {
        const config = this.config.belt;
        if (!config) return;
        const points = this.beltPath();
        const lengths = points.slice(1).map((p, i) => p.distanceTo(points[i]));
        this.belt = { points, lengths, total: lengths.reduce((a, b) => a + b, 0) };
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;
        const g = canvas.getContext('2d')!;
        g.fillStyle = '#2c2f36';
        g.fillRect(0, 0, 64, 64);
        g.fillStyle = '#4a4f5a';
        for (let y = 0; y < 64; y += 16) g.fillRect(0, y, 64, 6);
        this.beltTexture = CanvasArt.texture(canvas);
        this.beltTexture.wrapS = this.beltTexture.wrapT = THREE.RepeatWrapping;
        const surface = new THREE.MeshStandardMaterial({ map: this.beltTexture, roughness: 0.7 });
        BendService.applyBend(surface);
        const rail = this.material(0x9aa3ad, { metalness: 0.4, roughness: 0.4 });
        const leg = this.material(0x5a5f68);
        points.slice(1).forEach((to, i) => {
            const from = points[i];
            const length = lengths[i];
            const middle = from.clone().add(to).multiplyScalar(0.5);
            const angle = Math.atan2(to.x - from.x, to.y - from.y);
            const stretch = new THREE.Group();
            stretch.position.set(middle.x, 0, middle.y);
            stretch.rotation.y = angle;
            // Each stretch's texture runs along it (its own copy: its own repeat).
            const map = this.beltTexture!.clone();
            map.repeat.set(1, length / BELT.width);
            const band = new THREE.Mesh(new THREE.BoxGeometry(BELT.width, BELT.height, length + BELT.width * 0.5), [rail, rail, surface.clone(), rail, rail, rail]);
            ((band.material as THREE.Material[])[2] as THREE.MeshStandardMaterial).map = map;
            band.position.y = BELT.top - BELT.height / 2;
            stretch.add(band);
            for (const side of [-1, 1]) this.box(0.05, 0.08, length + BELT.width * 0.5, rail, side * (BELT.width / 2 + 0.02), BELT.top + 0.02, 0, stretch);
            for (let along = -length / 2; along <= length / 2 + 0.01; along += 1.2) this.box(0.08, BELT.top - BELT.height, 0.08, leg, 0, (BELT.top - BELT.height) / 2, along, stretch);
            this.beltGroup.add(stretch);
        });
        this.beltGroup.visible = !!MowProgress.den.belt;
        this.group.add(this.beltGroup);
        const buyAt = this.beltBuyAt;
        this.beltSquare = this.decal(new THREE.Texture(), this.def.parts?.beltBuy?.w ?? 1.6, this.def.parts?.beltBuy?.d ?? 1.6, buyAt.x, buyAt.y);
        this.beltSquare.visible = false;
        // Where each egg spot's eggs join it: the nearest point along it.
        this.beltJoin = this.layoutOf.eggs.map((egg) => this.nearestAlong(new THREE.Vector2(egg.x, egg.z)));
        this.beltTake = this.layoutOf.eggs.map((_, i) => config.takeSec * (0.3 + i * 0.17));
    }

    /** The conveyor's buy square (den-local): where the editor placed it (DenDef.parts.beltBuy), else the belt's start. */
    private get beltBuyAt(): THREE.Vector2 {
        const placed = this.def.parts?.beltBuy;
        return placed ? new THREE.Vector2(placed.x, placed.z) : this.belt.points[0] ?? new THREE.Vector2();
    }

    /** Standing on the conveyor's buy square this frame (its pouring isn't reset). */
    private beltOnSquare = false;

    /** How far along the belt its nearest point to `at` is. */
    private nearestAlong(at: THREE.Vector2): number {
        const { points, lengths } = this.belt;
        let best = Infinity;
        let bestS = 0;
        let before = 0;
        for (let i = 0; i < lengths.length; i++) {
            const a = points[i];
            const ab = points[i + 1].clone().sub(a);
            const t = Math.max(0, Math.min(1, at.clone().sub(a).dot(ab) / Math.max(1e-6, ab.lengthSq())));
            const distance = a.clone().addScaledVector(ab, t).distanceTo(at);
            if (distance < best) {
                best = distance;
                bestS = before + t * lengths[i];
            }
            before += lengths[i];
        }
        return bestS;
    }

    /** The belt's point `s` along it (den-local, on its surface). */
    private alongBelt(s: number, out: THREE.Vector3): THREE.Vector3 {
        const { points, lengths } = this.belt;
        let left = Math.max(0, s);
        for (let i = 0; i < lengths.length; i++) {
            if (left <= lengths[i] || i === lengths.length - 1) {
                const t = lengths[i] > 0 ? Math.min(1, left / lengths[i]) : 0;
                const p = points[i].clone().lerp(points[i + 1], t);
                return out.set(p.x, BELT.top + 0.01, p.y);
            }
            left -= lengths[i];
        }
        return out.set(points[0].x, BELT.top, points[0].y);
    }

    /** The buy square at its start: shown once every hen is owned, until it's bought. */
    private refreshBelt(): void {
        const config = this.config.belt;
        const square = this.beltSquare;
        if (!config || !square) return;
        const den = MowProgress.den;
        const offered = this.opened && !den.belt && den.hens >= Math.min(BELT_AFTER_HENS, this.config.hens.length);
        square.visible = offered;
        if (!offered) return;
        const short = MowProgress.level < config.level;
        const left = Math.ceil(config.price - MowProgress.paid('belt'));
        const key = `${short}|${left}`;
        if (key === this.beltDrawn) return;
        this.beltDrawn = key;
        const material = square.material as THREE.MeshBasicMaterial;
        material.map = squareTexture(1.6, 1.6, '#ffffff', { text: shortMoney(left), sub: short ? `LEVEL ${config.level}` : 'CONVEYOR', subColor: short ? '#ff8a7a' : '#9cff6a' });
        material.needsUpdate = true;
    }

    /** Bought on its square (money and a level, poured in); then it runs: eggs off the spots, along, into the machine. */
    private beltLoop(delta: number, p: { x: number; z: number }): void {
        const config = this.config.belt;
        if (!config || !this.belt.total) return;
        this.refreshBelt();
        const den = MowProgress.den;
        if (!den.belt) {
            const buyAt = this.beltBuyAt;
            const on = !!this.beltSquare?.visible && Math.abs(p.x - buyAt.x) <= 0.8 && Math.abs(p.z - buyAt.y) <= 0.8;
            this.beltOnSquare = on;
            if (!on) return;
            const done = this.pourInto('belt', config.price, config.level, this.world(buyAt.x, 0.1, buyAt.y), delta, 'THE CONVEYOR');
            if (!done) return;
            this.beltOnSquare = false;
            den.belt = true;
            GameAnalytics.den(this.def.id, 'belt');
            MowProgress.denChanged();
            this.hooks.xp('hen');
            this.sound('buyFanfare');
            this.hooks.say('CONVEYOR BELT!', 0x9cff6a);
            this.beltGroup.visible = true;
            this.popIn(this.beltGroup);
            return;
        }
        // The surface scrolls.
        this.beltGroup.traverse((child) => {
            const material = (child as THREE.Mesh).material;
            const surface = Array.isArray(material) ? material[2] : undefined;
            if (surface instanceof THREE.MeshStandardMaterial && surface.map) surface.map.offset.y -= (delta * config.speed) / BELT.width;
        });
        // Each egg spot sends its eggs on, one every takeSec, where there's room where it joins.
        this.layoutOf.eggs.forEach((_, i) => {
            if (i >= den.hens || (den.floor[i] ?? 0) <= 0) return;
            this.beltTake[i] -= delta;
            if (this.beltTake[i] > 0) return;
            const join = this.beltJoin[i];
            if (this.beltEggs.some((egg) => Math.abs(egg.s - join) < config.spacing)) return;
            this.beltTake[i] = config.takeSec;
            den.floor[i]--;
            MowProgress.denChanged();
            this.refreshNests();
            const egg = farmItem('egg');
            egg.scale.setScalar(EGG_SCALE);
            this.alongBelt(join, egg.position);
            this.group.add(egg);
            this.popIn(egg);
            this.beltEggs.push({ s: join, object: egg });
        });
        // They ride along (never closer than `spacing` to the one ahead); at the end, into the machine while it has room.
        this.beltEggs.sort((a, b) => b.s - a.s);
        let ahead = Infinity;
        for (let k = 0; k < this.beltEggs.length; k++) {
            const egg = this.beltEggs[k];
            const limit = Math.min(this.belt.total, ahead - config.spacing);
            egg.s = Math.min(limit, egg.s + config.speed * delta);
            ahead = egg.s;
            this.alongBelt(egg.s, egg.object.position);
        }
        const first = this.beltEggs[0];
        if (first && first.s >= this.belt.total - 1e-3 && den.machine < this.config.machineMax) {
            this.beltEggs.shift();
            first.object.removeFromParent();
            den.machine++;
            MowProgress.denChanged();
            const { machine } = this.layoutOf;
            this.hooks.effects.toss(this.world(first.object.position.x, BELT.top, first.object.position.z), this.world(machine.x - 0.1, 1.35, machine.z), new THREE.Color(0xfff0d0), 0, () => {}, farmItem('egg'));
        }
    }

    /** A truck's payment: from `from` onto its own cash square by the dock. */
    private payFrom(from: THREE.Vector3, amount: number): void {
        amount = MowProgress.farmPay(amount);
        const den = MowProgress.den;
        den.truckCash = (den.truckCash ?? 0) + amount;
        MowProgress.denChanged();
        const cash = this.truckCash;
        const bundles = Math.min(10, Math.ceil(amount / CASH_PER_BUNDLE));
        for (let i = 0; i < bundles; i++) {
            this.hooks.effects.toss(from.clone().setY(from.y + 0.5), this.world(cash.x, 0.1, cash.z), new THREE.Color(0x5fc85a), i * 0.05,
                () => this.sound('coins'), farmItem('cash'));
        }
        this.shownTruckCash = -1;
    }

    public destroy(): void {
        this.helper?.destroy();
        if (this.tutorialHand) {
            this.tutorialHand.removeFromParent();
            this.tutorialHand.material.map?.dispose();
            this.tutorialHand.material.dispose();
        }
        this.truckHelper?.destroy();
        this.goldBelt?.destroy();
        this.beltEggs.forEach((egg) => gsap.killTweensOf(egg.object.scale));
        gsap.killTweensOf(this.beltGroup.scale);
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
