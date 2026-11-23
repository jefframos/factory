// UpgradePads.ts
//
// The farm test's upgrade stations (TOWN.farm.pads), in place of the shop: a square marked on the floor (a thick
// white outline, what it upgrades, the grass still needed, filling up green as it's paid) with the next thing on a
// little stand behind it — the next mower turning slowly, the player's rucksack for the bigger bag, or the next blades
// (spinning: MowerBlades) for sharper ones. Standing on the square pours
// the bag's grass in (clumps flying from the player's pile onto the stand); paid in full, the upgrade happens at once
// (MowProgress.deposit) and the stand shows the one after. No menus.

import * as THREE from 'three';
import gsap from 'gsap';
import { BendService } from '../services/BendService';
import { MOW, UpgradePadDef, bladeCount, shortMoney, shortNumber } from '../data/MowConfig';
import { MowProgress, PadKind } from '../data/MowProgress';
import { buildMower } from '../player/MowerModel';
import { TractorRide } from '../player/TractorRide';
import { MowerBlades, bladeLook } from '../player/MowerBlades';
import { rucksackPicture } from '../player/Backpack';
import { CanvasArt } from '../ui/CanvasArt';
import type { Box } from './GuidePath';

/** The square on the floor (world units across), and how far behind its middle the stand is. */
const PAD_SIZE = 2.6;
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
/**
 * After an upgrade a pad rests this long (seconds) before it takes anything again: the player sees what they got and
 * can walk off before the next one starts eating their money.
 */
const UPGRADE_PAUSE = 3;
/** A clump flies from the pile every this many seconds while pouring. */
const TOSS_SEC = 0.06;
const FLOOR_Y = 0.1;
const CANVAS = 384;

interface Pad {
    def: UpgradePadDef;
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
    /** Seconds left of its rest after an upgrade (it takes nothing until then: UPGRADE_PAUSE). */
    pause: number;
}

const kindOf = (def: UpgradePadDef): PadKind => def.kind;

/** Where a pad's stand is from the square's middle: behind it (-Z) turned by its rotationY. */
const standOffset = (def: UpgradePadDef): { x: number; z: number } => {
    const turn = def.rotationY ?? 0;
    return { x: -STAND_BACK * Math.sin(turn), z: -STAND_BACK * Math.cos(turn) };
};

/** What a pad is offering now: its title on the floor, the name over the stand, and a key that changes with it. */
function offer(kind: PadKind): { title: string; name: string; key: string } {
    if (kind === 'tool') {
        const next = MowProgress.nextTool;
        return { title: 'MOWER', name: next ? next.name.toUpperCase() : 'MAX', key: `tool:${MowProgress.toolLevel}` };
    }
    if (kind === 'blades') {
        const level = MowProgress.bladesLevel + 1;
        const look = bladeLook(level);
        const count = bladeCount(look);
        const size = look.size;
        return { title: 'BLADES', name: count > 1 ? `${count} BLADES` : size >= 1 ? 'BIG BLADE' : 'BLADE', key: `blades:${MowProgress.bladesLevel}` };
    }
    const capacity = MOW.upgrades.find((u) => u.id === 'capacity')!;
    return { title: 'BIGGER BAG', name: `BAG +${shortNumber(MowProgress.capacityStep)}`, key: `capacity:${MowProgress.upgradeLevel('capacity')}:${MowProgress.toolLevel}` };
}

/** A small grass tuft (the price's unit), centred on (x, y), `size` tall. */
function drawTuft(g: CanvasRenderingContext2D, x: number, y: number, size: number): void {
    const blades = [[-0.32, -0.55], [-0.15, -0.95], [0.05, -1], [0.22, -0.8], [0.38, -0.5]];
    g.lineJoin = 'round';
    for (const pass of [0, 1]) {
        for (const [tipX, tipY] of blades) {
            g.beginPath();
            g.moveTo(x + tipX * size * 0.35 - size * 0.08, y + size * 0.45);
            g.quadraticCurveTo(x + tipX * size * 0.6, y, x + tipX * size, y + tipY * size * 0.55);
            g.quadraticCurveTo(x + tipX * size * 0.45, y + size * 0.05, x + tipX * size * 0.35 + size * 0.08, y + size * 0.45);
            g.closePath();
            if (pass === 0) {
                g.lineWidth = size * 0.16;
                g.strokeStyle = '#1d3a14';
                g.stroke();
            } else {
                g.fillStyle = '#7ad957';
                g.fill();
            }
        }
    }
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
     * `isOpen(section)`: whether a pad's section is open (a pad with none is always there). `onPour(to)`: a clump of
     * grass is poured, landing at `to`. `onUpgrade(kind, at)`: an upgrade was paid in full and applied.
     */
    public constructor(threeScene: THREE.Scene, defs: UpgradePadDef[], private readonly isOpen: (section: string) => boolean,
        private readonly onPour: (to: THREE.Vector3) => void,
        private readonly onUpgrade: (kind: PadKind, at: THREE.Vector3) => void) {
        this.pads = defs.map((def) => this.build(def));
        threeScene.add(this.group);
    }

    /** The stands (solid) and the squares (bare ground) of these pads, for the town before the grass grows. */
    public static boxes(defs: UpgradePadDef[]): { solid: Box[]; bare: Box[] } {
        return {
            solid: defs.map((def) => {
                const off = standOffset(def);
                return { x: def.x + off.x, z: def.z + off.z, halfX: STAND_RADIUS, halfZ: STAND_RADIUS };
            }),
            bare: defs.map((def) => {
                const off = standOffset(def);
                return { x: def.x + off.x / 2, z: def.z + off.z / 2, halfX: PAD_SIZE / 2 + Math.abs(off.x) / 2 + 0.4, halfZ: PAD_SIZE / 2 + Math.abs(off.z) / 2 + 0.4 };
            }),
        };
    }

    /** Its section's open, the mower it waits for is had, and (the first station) the bag has been full. */
    private shownNow(def: UpgradePadDef): boolean {
        if (def.section && !this.isOpen(def.section)) return false;
        if (def.afterTool !== undefined && MowProgress.toolLevel < def.afterTool) return false;
        // The first station: out once the bag's worth its upgrade (or full), the player still mowing meanwhile.
        const affordable = MowProgress.pourable >= (MowProgress.padCost('tool') ?? Infinity);
        if (def.appearsWhenFull && !(affordable || MowProgress.full || MowProgress.toolLevel > 0 || MowProgress.padPaid('tool') > 0)) return false;
        return true;
    }

    private material<T extends THREE.Material>(material: T): T {
        BendService.applyBend(material);
        return material;
    }

    private build(def: UpgradePadDef): Pad {
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
        // Over the floor squares (transparent too, drawn in order).
        label.renderOrder = 20;
        label.position.set(off.x, STAND_HEIGHT + SHOWN_LIFT + SHOWN_SIZE + 0.35, off.z);
        group.add(label);

        const visible = this.shownNow(def);
        group.visible = visible;
        this.group.add(group);
        const pad: Pad = { def, group, canvas, texture, shown, label, labelCanvas, labelTexture, drawn: '', built: '', visible, pause: 0 };
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
        const cost = MowProgress.padCost(kind);
        const paid = MowProgress.padPaid(kind);
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
        pad.shown.clear();
        pad.blades?.dispose();
        pad.blades = undefined;
        if (maxed) return;
        const prepare = (material: THREE.Material) => BendService.applyBend(material);
        let object: THREE.Object3D;
        if (pad.def.kind === 'tool' && MowProgress.nextTool!.ride) {
            // A driven mower: the tractor itself (its model, in its paint), as it'll be ridden.
            const next = MowProgress.nextTool!;
            const holder = new THREE.Group();
            pad.shown.add(holder);
            void TractorRide.copy(next).then((tractor) => {
                if (!tractor || pad.built !== offer('tool').key) return;
                const box = new THREE.Box3().setFromObject(tractor);
                const size = box.getSize(new THREE.Vector3());
                tractor.position.sub(box.getCenter(new THREE.Vector3())).setY(-box.min.y);
                holder.add(tractor);
                holder.scale.setScalar((SHOWN_SIZE * 1.3) / Math.max(size.x, size.y, size.z, 1e-3));
            });
            return;
        } else if (pad.def.kind === 'tool') {
            const next = MowProgress.nextTool!;
            object = buildMower(next, prepare).group;
        } else if (pad.def.kind === 'blades') {
            // The next blades, a little tilted toward the player so they read from above, spinning (update()).
            pad.blades = new MowerBlades(prepare);
            pad.blades.set(MowProgress.bladesLevel + 1, 1);
            object = new THREE.Group();
            object.add(pad.blades.group);
            object.rotation.x = 0.5;
        } else {
            // The player's own rucksack (Backpack.ts) in the next bag's colour: what they'll wear.
            object = rucksackPicture(MowProgress.upgradeLevel('capacity') + 1);
        }
        const box = new THREE.Box3().setFromObject(object);
        const size = box.getSize(new THREE.Vector3());
        const holder = new THREE.Group();
        object.position.sub(box.getCenter(new THREE.Vector3())).setY(-box.min.y);
        holder.add(object);
        holder.scale.setScalar(SHOWN_SIZE / Math.max(size.x, size.y, size.z, 1e-3));
        pad.shown.add(holder);
    }

    /** The pad whose square is under (x, z) (and is there), or -1. */
    public padAt(x: number, z: number): number {
        return this.pads.findIndex((pad) => pad.visible && Math.abs(x - pad.def.x) <= PAD_SIZE / 2 && Math.abs(z - pad.def.z) <= PAD_SIZE / 2);
    }

    /** The nearest pad that's there and still has something to take (of `kind`, if given). */
    public nearest(from: THREE.Vector3, kind?: PadKind, out = new THREE.Vector3()): THREE.Vector3 | null {
        let best = Infinity;
        for (const pad of this.pads) {
            if (!pad.visible || (kind && pad.def.kind !== kind) || MowProgress.padCost(pad.def.kind) === undefined) continue;
            const distance = Math.hypot(from.x - pad.def.x, from.z - pad.def.z);
            if (distance < best) {
                best = distance;
                out.set(pad.def.x, 0, pad.def.z);
            }
        }
        return best < Infinity ? out : null;
    }

    /** Money still needed for a pad's next upgrade (Infinity at the top). */
    public static left(kind: PadKind): number {
        const cost = MowProgress.padCost(kind);
        return cost === undefined ? Infinity : cost - MowProgress.padPaid(kind);
    }

    /** Each frame: the stands turn, pads of sections just opened pop in, and the one stood on takes the bag's grass. */
    public update(delta: number, player: THREE.Vector3): void {
        for (const pad of this.pads) {
            pad.pause = Math.max(0, pad.pause - delta);
            pad.shown.rotation.y += delta * 0.9;
            pad.blades?.spin(delta, true);
            const visible = this.shownNow(pad.def);
            if (visible && !pad.visible) {
                pad.visible = true;
                pad.group.visible = true;
                pad.group.scale.setScalar(0.01);
                gsap.to(pad.group.scale, { x: 1, y: 1, z: 1, duration: 0.6, delay: 0.4, ease: 'back.out(2)' });
            }
            if (pad.visible) this.refresh(pad);
        }
        const i = this.padAt(player.x, player.z);
        if (i !== this.active) {
            if (this.active >= 0 && this.tookAny) MowProgress.countPadVisit();
            this.active = i;
            this.tookAny = false;
            this.carry = 0;
            this.tossTimer = 0;
            this.rate = 0;
        }
        if (i < 0) return;
        const pad = this.pads[i];
        const kind = kindOf(pad.def);
        const cost = MowProgress.padCost(kind);
        if (cost === undefined || MowProgress.pourable <= 0 || pad.pause > 0) return;
        // The pour's pace, set as it starts (and again after an upgrade): its size over the time it should take.
        if (this.rate <= 0) {
            const amount = Math.min(MowProgress.pourable, cost - MowProgress.padPaid(kind));
            const seconds = Math.min(FILL_SEC, Math.max(POUR.least, amount * POUR.secondsPer));
            this.rate = Math.max(MIN_RATE, amount / seconds);
        }
        this.carry += this.rate * delta;
        const amount = this.carry;
        if (amount <= 0) return;
        this.carry = 0;
        const { used, upgraded } = MowProgress.deposit(kind, amount);
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
