// UpgradePads.ts
//
// The hub's upgrade stations (levels/hub.json `pads`), in place of a shop: a square marked on the floor (a thick white
// outline, what it upgrades, the money still needed, filling up green as it's paid) with the next thing on a little stand
// behind it — the next tractor turning slowly (in the player's own paint and part, with a green arrow up beside it: bigger
// is what's new), a bag for the bigger bag, or the next blades, spinning. Standing on the square pours the bag in (rocks and
// gems flying from the miner onto the stand, at what they sell for) and then the money; paid in full, the upgrade happens at
// once (DigProgress.deposit) and the stand shows the one after. No menus.

import * as THREE from 'three';
import gsap from 'gsap';
import { BendService } from '../services/BendService';
import { PadKind } from '../data/DigConfig';
import { DigProgress } from '../data/DigProgress';
import { HUB, HubPad } from '../data/HubData';
import { dressedTractor, freeDressed } from '../player/TractorDress';
import { MowerBlades } from '../player/MowerBlades';
import { shortMoney, shortNumber } from '../utils/Numbers';
import { t, names } from '../i18n/Localization';
import { CanvasArt } from '../ui/CanvasArt';
import type { Box } from './GuidePath';

/** The square on the floor (world units across), and how far behind its middle the stand is. */
const PAD_SIZE = 2.6;
/** The title over each stand (the next one's name). */
const SHOW_TITLES: boolean = true;
const STAND_BACK = 2.1;
const STAND_RADIUS = 0.55;
const STAND_HEIGHT = 0.7;
/** The thing on the stand fits in this (world units), floating this high over the stand's top. */
const SHOWN_SIZE = 1.25;
const SHOWN_LIFT = 0.45;
/**
 * How long a visit's pour takes (what's poured: the bag, or what the pad still needs if that's less), by its size, so
 * early upgrades are quick and nobody walks off before it's done: POUR.secondsPer per grass, never under POUR.least
 * (about 100 grass or less: at once) nor over FILL_SEC; at least MIN_RATE a second.
 */
const MIN_RATE = 9;
const FILL_SEC = 1.6;
const POUR = { secondsPer: 1 / 80, least: 0.25 };
/** The first station's arrow: how high over its square, and its size. */
const POINTER = { height: 2.6, radius: 0.42 };
/** The arrow up beside the next mower: its size, where it is from the stand's middle as seen on the screen, and its bob. */
const UP_ARROW = { size: 0.78, right: 0.98, nearer: 0.45, y: STAND_HEIGHT + SHOWN_LIFT + 0.55, bob: 0.07, speed: 2 };
/**
 * After an upgrade a pad rests this long (seconds) before it takes anything again: the player sees what they got and
 * can walk off before the next one starts eating their money.
 */
const UPGRADE_PAUSE = 0.5;
/** A clump flies from the pile every this many seconds while pouring. */
const TOSS_SEC = 0.06;
const FLOOR_Y = 0.1;
const CANVAS = 384;

interface Pad {
    def: HubPad;
    group: THREE.Group;
    canvas: HTMLCanvasElement;
    texture: THREE.CanvasTexture;
    /** Holds the thing shown on the stand (rebuilt when the next upgrade changes). */
    shown: THREE.Group;
    label: THREE.Sprite;
    labelCanvas: HTMLCanvasElement;
    labelTexture: THREE.CanvasTexture;
    /** What's drawn now (redrawn when it changes). */
    drawn: string;
    built: string;
    visible: boolean;
    /** The Blades pad's blades on the stand (spun each frame). */
    blades?: MowerBlades;
    /** The Mower pad's arrow up beside what's on its stand (while there's a next one). */
    upArrow?: THREE.Sprite;
    /** The first station's arrow (bobbing over its square while the Push Mower can be paid and hasn't been). */
    pointer?: THREE.Group;
    /** Seconds left of its rest after an upgrade (it takes nothing until then: UPGRADE_PAUSE). */
    pause: number;
}

const kindOf = (def: HubPad): PadKind => def.kind;

/** Bags' colours, level by level. */
const BAG_COLORS = [0xb98a5a, 0x4cc95a, 0x2f8fff, 0xe8352b, 0xf2b230, 0xa56bff, 0x21b6a8];

/** A rucksack: its body, a flap, a pocket and a strap, in the next level's colour. */
function bagModel(level: number, prepare: (material: THREE.Material) => void): THREE.Object3D {
    const color = new THREE.Color(BAG_COLORS[level % BAG_COLORS.length]);
    const make = (shade: THREE.Color) => {
        const material = new THREE.MeshStandardMaterial({ color: shade, roughness: 0.8 });
        prepare(material);
        return material;
    };
    const body = make(color);
    const dark = make(color.clone().multiplyScalar(0.62));
    const brass = make(new THREE.Color(0xf2c230));
    const bag = new THREE.Group();
    const add = (geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number) => {
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(x, y, z);
        bag.add(mesh);
        return mesh;
    };
    add(new THREE.CapsuleGeometry(0.36, 0.34, 6, 14), body, 0, 0.5, 0).scale.z = 0.72;
    add(new THREE.SphereGeometry(0.39, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), dark, 0, 0.66, 0.02).scale.z = 0.78;
    add(new THREE.BoxGeometry(0.4, 0.28, 0.16), dark, 0, 0.34, 0.26);
    add(new THREE.BoxGeometry(0.1, 0.1, 0.06), brass, 0, 0.58, 0.31);
    add(new THREE.TorusGeometry(0.11, 0.035, 8, 16), dark, 0, 1.05, 0);
    for (const side of [-1, 1]) add(new THREE.CapsuleGeometry(0.1, 0.22, 4, 8), dark, side * 0.38, 0.36, 0);
    return bag;
}

/** Where a pad's stand is from the square's middle: behind it (-Z) turned by its rotationY. */
const standOffset = (def: HubPad): { x: number; z: number } => {
    const turn = def.rotationY ?? 0;
    return { x: -STAND_BACK * Math.sin(turn), z: -STAND_BACK * Math.cos(turn) };
};

/** What a pad is offering now: its title on the floor, the name over the stand, and a key that changes with it. */
function offer(kind: PadKind): { title: string; name: string; key: string } {
    if (kind === 'tool') {
        const next = DigProgress.nextTool;
        const look = DigProgress.tractorLook;
        return { title: t('padTractor'), name: next ? names.tool(next).toUpperCase() : t('maxLabel'), key: `tool:${DigProgress.toolLevel}:${look.paints}:${look.parts}` };
    }
    if (kind === 'blades') return { title: t('padBlades'), name: t('padPower', { power: DigProgress.tool.power + DigProgress.bladesLevel + 1 }), key: `blades:${DigProgress.bladesLevel}` };
    return { title: t('padBag'), name: t('padBagMore', { count: shortNumber(DigProgress.capacityStep) }), key: `capacity:${DigProgress.backpackLevel}:${DigProgress.toolLevel}` };
}

/** An "up" chevron (the upgrade sign), centred on (x, y). */
function drawUpArrow(g: CanvasRenderingContext2D, x: number, y: number, size: number): void {
    const s = size / 2;
    g.beginPath();
    g.moveTo(x, y - s);
    g.lineTo(x + s, y);
    g.lineTo(x + s * 0.42, y);
    g.lineTo(x + s * 0.42, y + s);
    g.lineTo(x - s * 0.42, y + s);
    g.lineTo(x - s * 0.42, y);
    g.lineTo(x - s, y);
    g.closePath();
    g.lineJoin = 'round';
    g.lineWidth = 14;
    g.strokeStyle = 'rgba(20, 30, 20, 0.6)';
    g.stroke();
    g.fillStyle = '#ffffff';
    g.fill();
}

/** The upgrade sign: a fat green arrow up, a white rim and a dark line round it. */
function upArrowTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const g = canvas.getContext('2d')!;
    const points: [number, number][] = [[128, 34], [218, 128], [168, 128], [168, 220], [88, 220], [88, 128], [38, 128]];
    g.beginPath();
    points.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.closePath();
    g.lineJoin = 'round';
    for (const [width, color] of [[58, '#17451a'], [40, '#ffffff'], [14, '#2fbf3a']] as const) {
        g.lineWidth = width;
        g.strokeStyle = color;
        g.stroke();
    }
    const fill = g.createLinearGradient(0, 30, 0, 224);
    fill.addColorStop(0, '#8dff6a');
    fill.addColorStop(1, '#2fbf3a');
    g.fillStyle = fill;
    g.fill();
    return CanvasArt.texture(canvas);
}

export class UpgradePads {
    private readonly group = new THREE.Group();
    private readonly pads: Pad[];
    /** The pad stood on (-1: none), whether this visit took grass, grass owed to the pour, the next clump's timer. */
    private active = -1;
    private tookAny = false;
    private carry = 0;
    private tossTimer = 0;
    /** This visit's pour pace (grass a second; 0: worked out when it starts). */
    private rate = 0;

    /**
     * `onPour(to)`: something is poured, landing at `to`. `onUpgrade(kind, at)`: an upgrade was paid in full and applied.
     * `onAppear(def, at)`: a pad's just come out.
     */
    public constructor(threeScene: THREE.Scene, private readonly onPour: (to: THREE.Vector3) => void,
        private readonly onUpgrade: (kind: PadKind, at: THREE.Vector3) => void,
        private readonly onAppear: (def: HubPad, at: THREE.Vector3) => void = () => {}) {
        this.pads = HUB.pads.map((def) => this.build(def));
        threeScene.add(this.group);
    }

    /** The stands: solid. */
    public static boxes(): Box[] {
        return HUB.pads.map((def) => {
            const off = standOffset(def);
            return { x: def.x + off.x, z: def.z + off.z, halfX: STAND_RADIUS, halfZ: STAND_RADIUS };
        });
    }

    /** The tractor it waits for is had. */
    private shownNow(def: HubPad): boolean {
        return DigProgress.toolLevel >= (def.afterTool ?? 0);
    }

    private material<T extends THREE.Material>(material: T): T {
        BendService.applyBend(material);
        return material;
    }

    private build(def: HubPad): Pad {
        const group = new THREE.Group();
        group.position.set(def.x, 0, def.z);
        const canvas = document.createElement('canvas');
        canvas.width = CANVAS;
        canvas.height = CANVAS;
        const texture = CanvasArt.texture(canvas);
        const floorMaterial = this.material(new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }));
        floorMaterial.polygonOffset = true;
        floorMaterial.polygonOffsetFactor = -3;
        floorMaterial.polygonOffsetUnits = -3;
        const floorGeometry = new THREE.PlaneGeometry(PAD_SIZE, PAD_SIZE, 6, 6);
        floorGeometry.rotateX(-Math.PI / 2);
        const floor = new THREE.Mesh(floorGeometry, floorMaterial);
        floor.position.y = FLOOR_Y;
        floor.renderOrder = 2;
        group.add(floor);

        // The stand behind the square: a short white drum with a coloured top.
        const stand = new THREE.Group();
        const off = standOffset(def);
        stand.position.set(off.x, 0, off.z);
        const drum = new THREE.Mesh(new THREE.CylinderGeometry(STAND_RADIUS, STAND_RADIUS * 1.1, STAND_HEIGHT, 16),
            this.material(new THREE.MeshStandardMaterial({ color: 0xf2efe6, roughness: 0.6 })));
        drum.position.y = STAND_HEIGHT / 2;
        stand.add(drum);
        const top = new THREE.Mesh(new THREE.CylinderGeometry(STAND_RADIUS * 1.05, STAND_RADIUS * 1.05, 0.08, 16),
            this.material(new THREE.MeshStandardMaterial({ color: def.kind === 'tool' ? 0x3f8cff : def.kind === 'blades' ? 0xe0402f : 0xf2a33a, roughness: 0.5 })));
        top.position.y = STAND_HEIGHT;
        stand.add(top);
        const shown = new THREE.Group();
        shown.position.y = STAND_HEIGHT + SHOWN_LIFT;
        stand.add(shown);
        group.add(stand);

        const labelCanvas = document.createElement('canvas');
        labelCanvas.width = 384;
        labelCanvas.height = 96;
        const labelTexture = CanvasArt.texture(labelCanvas);
        const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture, depthWrite: false }));
        label.scale.set(2.6, 0.65, 1);
        label.visible = SHOW_TITLES;
        // Over the floor squares (transparent too, drawn in order).
        label.renderOrder = 20;
        label.position.set(off.x, STAND_HEIGHT + SHOWN_LIFT + SHOWN_SIZE + 0.35, off.z);
        group.add(label);

        const visible = this.shownNow(def);
        group.visible = visible;
        this.group.add(group);
        const pad: Pad = { def, group, canvas, texture, shown, label, labelCanvas, labelTexture, drawn: '', built: '', visible, pause: 0 };
        if (def.kind === 'tool') pad.pointer = this.buildPointer(group);
        if (def.kind === 'tool') {
            pad.upArrow = new THREE.Sprite(new THREE.SpriteMaterial({ map: upArrowTexture(), depthWrite: false }));
            pad.upArrow.scale.setScalar(UP_ARROW.size);
            pad.upArrow.renderOrder = 21;
            stand.add(pad.upArrow);
        }
        this.refresh(pad);
        // The kit's font may not be in yet: drawn again in a moment.
        window.setTimeout(() => {
            pad.drawn = '';
            pad.built = '';
            this.refresh(pad);
        }, 1200);
        return pad;
    }

    /** Draws the floor (and rebuilds the stand's thing) when what it shows has changed. */
    private refresh(pad: Pad): void {
        const kind = kindOf(pad.def);
        const cost = DigProgress.padCost(kind);
        const paid = DigProgress.padPaid(kind);
        const { title, name, key } = offer(kind);
        const drawn = `${key}|${cost}|${shortMoney(Math.max(0, Math.ceil((cost ?? 0) - paid)))}`;
        if (drawn !== pad.drawn) {
            pad.drawn = drawn;
            this.drawFloor(pad, title, cost, paid);
        }
        if (key !== pad.built) {
            const first = pad.built === '';
            pad.built = key;
            this.buildShown(pad, cost === undefined);
            this.drawLabel(pad, cost === undefined ? 'MAX' : name);
            if (!first) {
                pad.shown.scale.setScalar(0.01);
                gsap.to(pad.shown.scale, { x: 1, y: 1, z: 1, duration: 0.6, ease: 'back.out(2.2)' });
            }
        }
    }

    private drawFloor(pad: Pad, title: string, cost: number | undefined, paid: number): void {
        const g = pad.canvas.getContext('2d')!;
        const size = CANVAS;
        const inset = 18;
        const radius = 64;
        g.clearRect(0, 0, size, size);
        const outline = () => {
            g.beginPath();
            g.roundRect(inset, inset, size - inset * 2, size - inset * 2, radius);
        };
        // A dark wash inside, the paid share filling it green from the bottom (toward the player).
        outline();
        g.fillStyle = 'rgba(25, 35, 30, 0.38)';
        g.fill();
        if (cost !== undefined && paid > 0) {
            const share = Math.min(1, paid / cost);
            g.save();
            outline();
            g.clip();
            const height = (size - inset * 2) * share;
            g.fillStyle = 'rgba(122, 217, 87, 0.65)';
            g.fillRect(0, size - inset - height, size, height + inset);
            g.restore();
        }
        // The thick white border, with a darker line under it so it reads on any ground.
        outline();
        g.lineWidth = 26;
        g.strokeStyle = 'rgba(20, 30, 20, 0.45)';
        g.stroke();
        outline();
        g.lineWidth = 16;
        g.strokeStyle = '#ffffff';
        g.stroke();

        CanvasArt.text(g, title, size / 2, 82, 50, '#ffffff', size - 90);
        if (cost === undefined) {
            CanvasArt.text(g, 'MAX', size / 2, size / 2 + 20, 110, '#ffe27a', size - 90);
            pad.texture.needsUpdate = true;
            return;
        }
        drawUpArrow(g, size / 2, 172, 92);
        // What's left, in money (the bag's grass counts at its value, then the money carried).
        CanvasArt.text(g, shortMoney(Math.max(0, Math.ceil(cost - paid))), size / 2, 300, 96, '#ffe27a', size - 110);
        pad.texture.needsUpdate = true;
    }

    private drawLabel(pad: Pad, text: string): void {
        const g = pad.labelCanvas.getContext('2d')!;
        g.clearRect(0, 0, pad.labelCanvas.width, pad.labelCanvas.height);
        CanvasArt.plaque(g, 6, 6, pad.labelCanvas.width - 12, pad.labelCanvas.height - 12, 22);
        CanvasArt.text(g, text, pad.labelCanvas.width / 2, pad.labelCanvas.height / 2 + 2, 46, '#ffe27a', pad.labelCanvas.width - 40);
        pad.labelTexture.needsUpdate = true;
    }

    /** The thing on the stand: the next mower, a sack, or the next blades (none at the top). */
    private buildShown(pad: Pad, maxed: boolean): void {
        freeDressed(pad.shown);
        pad.shown.clear();
        pad.blades?.dispose();
        pad.blades = undefined;
        if (maxed) return;
        const prepare = (material: THREE.Material) => BendService.applyBend(material);
        let object: THREE.Object3D;
        if (pad.def.kind === 'tool') {
            // The tractor itself, dressed as the player's is (in its own colour if they've no paint on).
            const next = DigProgress.nextTool!;
            const holder = new THREE.Group();
            pad.shown.add(holder);
            const { key } = offer('tool');
            void dressedTractor(next, DigProgress.tractorLook, prepare).then((tractor) => {
                // (Something else is on the stand by now.)
                if (pad.built !== key || holder.parent !== pad.shown) {
                    freeDressed(tractor);
                    return;
                }
                // Its size is the model's alone (a part on it doesn't make it smaller).
                const box = new THREE.Box3().setFromObject(tractor.children[0]);
                const size = box.getSize(new THREE.Vector3());
                tractor.position.sub(box.getCenter(new THREE.Vector3())).setY(-box.min.y);
                holder.add(tractor);
                holder.scale.setScalar((SHOWN_SIZE * 1.3) / Math.max(size.x, size.y, size.z, 1e-3));
            }).catch(() => undefined);
            return;
        } else if (pad.def.kind === 'blades') {
            // The next blades, a little tilted toward the player so they read from above, spinning (update()).
            pad.blades = new MowerBlades(prepare);
            pad.blades.set(DigProgress.bladesLevel + 1, 1);
            object = new THREE.Group();
            object.add(pad.blades.group);
            object.rotation.x = 0.5;
        } else {
            object = bagModel(DigProgress.backpackLevel + 1, prepare);
        }
        const box = new THREE.Box3().setFromObject(object);
        const size = box.getSize(new THREE.Vector3());
        const holder = new THREE.Group();
        object.position.sub(box.getCenter(new THREE.Vector3())).setY(-box.min.y);
        holder.add(object);
        holder.scale.setScalar(SHOWN_SIZE / Math.max(size.x, size.y, size.z, 1e-3));
        pad.shown.add(holder);
    }

    /** Off: nothing's poured (a forced purchase, an offer up). */
    public enabled = true;
    private bob = 0;
    private arrowTime = 0;

    /** The first tractor can be paid, and hasn't been. */
    private get firstReady(): boolean {
        return DigProgress.toolLevel === 0 && DigProgress.pourable >= DigProgress.padLeft('tool');
    }

    /** The first station's square while it's waiting for the player (its arrow's up), or null. */
    public firstStation(out = new THREE.Vector3()): THREE.Vector3 | null {
        const pad = this.firstReady ? this.pads.find((entry) => entry.def.kind === 'tool' && entry.visible) : undefined;
        return pad ? out.set(pad.def.x, 0.5, pad.def.z) : null;
    }

    /** A gold arrow pointing down (over the first station's square). */
    private buildPointer(group: THREE.Group): THREE.Group {
        const gold = this.material(new THREE.MeshBasicMaterial({ color: 0xffc62e }));
        const pointer = new THREE.Group();
        const head = new THREE.Mesh(new THREE.ConeGeometry(POINTER.radius, POINTER.radius * 1.5, 4), gold);
        head.rotation.x = Math.PI;
        const shaft = new THREE.Mesh(new THREE.BoxGeometry(POINTER.radius * 0.7, POINTER.radius * 1.4, POINTER.radius * 0.7), gold);
        shaft.position.y = POINTER.radius * 1.3;
        pointer.add(head, shaft);
        pointer.visible = false;
        group.add(pointer);
        return pointer;
    }

    /** The pad whose square is under (x, z) (and is there), or -1. */
    public padAt(x: number, z: number): number {
        return this.pads.findIndex((pad) => pad.visible && Math.abs(x - pad.def.x) <= PAD_SIZE / 2 && Math.abs(z - pad.def.z) <= PAD_SIZE / 2);
    }

    /** The nearest pad that's there and can be paid in full now. */
    public payable(from: THREE.Vector3): THREE.Vector3 | null {
        const there = this.pads.filter((pad) => pad.visible && DigProgress.padLeft(pad.def.kind) <= DigProgress.pourable)
            .sort((a, b) => Math.hypot(from.x - a.def.x, from.z - a.def.z) - Math.hypot(from.x - b.def.x, from.z - b.def.z))[0];
        return there ? new THREE.Vector3(there.def.x, 0, there.def.z) : null;
    }

    /** A pad's square. */
    public static at(kind: PadKind): THREE.Vector3 | undefined {
        const def = HUB.pads.find((pad) => pad.kind === kind);
        return def && new THREE.Vector3(def.x, 0, def.z);
    }

    /** The nearest pad that's there and still has something to take (of `kind`, if given). */
    public nearest(from: THREE.Vector3, kind?: PadKind, out = new THREE.Vector3()): THREE.Vector3 | null {
        let best = Infinity;
        for (const pad of this.pads) {
            if (!pad.visible || (kind && pad.def.kind !== kind) || DigProgress.padCost(pad.def.kind) === undefined) continue;
            const distance = Math.hypot(from.x - pad.def.x, from.z - pad.def.z);
            if (distance < best) {
                best = distance;
                out.set(pad.def.x, 0, pad.def.z);
            }
        }
        return best < Infinity ? out : null;
    }

    /** Each frame: the stands turn, pads of sections just opened pop in, and the one stood on takes the bag's grass. */
    public update(delta: number, player: THREE.Vector3): void {
        this.arrowTime += delta * UP_ARROW.speed;
        for (const pad of this.pads) {
            pad.pause = Math.max(0, pad.pause - delta);
            pad.shown.rotation.y += delta * 0.9;
            pad.blades?.spin(delta, true);
            if (pad.upArrow) {
                // Beside it as seen on the screen (it faces the camera; the tractor turns under it).
                pad.upArrow.position.set(UP_ARROW.right, UP_ARROW.y + Math.sin(this.arrowTime) * UP_ARROW.bob, UP_ARROW.nearer);
                pad.upArrow.visible = DigProgress.padCost('tool') !== undefined;
            }
            const visible = this.shownNow(pad.def);
            if (visible && !pad.visible) {
                pad.visible = true;
                pad.group.visible = true;
                pad.group.scale.setScalar(0.01);
                gsap.to(pad.group.scale, { x: 1, y: 1, z: 1, duration: 0.6, delay: 0.4, ease: 'back.out(2)' });
                this.onAppear(pad.def, new THREE.Vector3(pad.def.x, 0, pad.def.z));
            }
            if (pad.pointer) {
                pad.pointer.visible = pad.visible && this.firstReady;
                this.bob += delta;
                pad.pointer.position.y = POINTER.height + Math.sin(this.bob * 5) * 0.25;
                pad.pointer.rotation.y += delta * 2;
            }
            if (pad.visible) this.refresh(pad);
        }
        const i = this.padAt(player.x, player.z);
        if (i !== this.active) {
            if (this.active >= 0 && this.tookAny) DigProgress.countPadVisit();
            this.active = i;
            this.tookAny = false;
            this.carry = 0;
            this.tossTimer = 0;
            this.rate = 0;
        }
        if (i < 0) return;
        const pad = this.pads[i];
        const kind = kindOf(pad.def);
        const cost = DigProgress.padCost(kind);
        // (A purchase to make first: nothing's poured meanwhile.)
        if (!this.enabled || cost === undefined || DigProgress.pourable < 1 || pad.pause > 0) return;
        // The pour's pace, set as it starts (and again after an upgrade): its size over the time it should take.
        if (this.rate <= 0) {
            const amount = Math.min(DigProgress.pourable, cost - DigProgress.padPaid(kind));
            const seconds = Math.min(FILL_SEC, Math.max(POUR.least, amount * POUR.secondsPer));
            this.rate = Math.max(MIN_RATE, amount / seconds);
        }
        this.carry += this.rate * delta;
        const amount = Math.floor(this.carry);
        if (amount < 1) return;
        this.carry -= amount;
        const { used, upgraded } = DigProgress.deposit(kind, amount);
        if (used > 0) this.tookAny = true;
        const off = standOffset(pad.def);
        const standTop = new THREE.Vector3(pad.def.x + off.x, STAND_HEIGHT + SHOWN_LIFT, pad.def.z + off.z);
        this.tossTimer -= delta;
        if (used > 0 && this.tossTimer <= 0) {
            this.tossTimer = TOSS_SEC;
            this.onPour(standTop);
        }
        this.refresh(pad);
        if (upgraded) {
            pad.pause = UPGRADE_PAUSE;
            this.onUpgrade(kind, standTop);
            // Whatever else shows this kind (another pad of it) follows on its next refresh.
            this.carry = 0;
            this.rate = 0;
        }
    }

    public destroy(): void {
        for (const pad of this.pads) {
            gsap.killTweensOf(pad.shown.scale);
            gsap.killTweensOf(pad.group.scale);
        }
        this.group.removeFromParent();
    }
}
