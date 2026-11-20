// MowerBlades.ts
//
// The blades under a mower, the cutting power you can see (README_PROGRESSION.md, "Blades"). Their level (the Blades
// upgrade: ui/mow.json `bladeLevels`) is how many there are and how long: one small blade, one big, then 2, 3, 4...
// side by side across the cut. Each is a steel bar with red tips on a dark hub, spinning flat just over the ground,
// with a faint disc where it sweeps (so it reads as spinning, not as a stick). Together they span the cutting width
// (MowProgress.width): what you see is what cuts. They're mounted low against the mower's front edge (MOUNT; a reel
// mower's: its wheels), like an out-front deck — under the deck the body and the uncut grass would hide them.
//
// Used under the walked mower (MowPlayer), under the tractor (TractorRide), on the Blades pad's stand (UpgradePads) and
// in the padlocks over grass too tough (GrassLocks, via ModelIcons.bladesCanvas).

import * as THREE from 'three';
import { BladeLevelDef, MOW, bladeCount } from '../data/MowConfig';

/** Spin (radians a second) while the mower moves, and idling. */
const SPIN = { moving: 26, idle: 9 };
/** Within the group: the bars' height (the group itself is lifted: MOUNT). */
const HEIGHT = 0;
/** Where the callers mount them (world units): this high over the ground, their middles this share of a blade's radius past the mower's front edge. */
export const MOUNT = { lift: 0.1, ahead: 0.3 };
/** The bar's thickness and its width (x its length); the hub's radius (x the length). */
const BAR = { thick: 0.03, wide: 0.13, hub: 0.12 };
/**
 * Several blades: each at least MIN_SHARE of the cutting width long (so each still reads on a big mower), neighbours in
 * two rows (ahead / behind by STAGGER x a blade's length) so their sweeps overlap like a gang of cutter discs.
 */
const MIN_SHARE = 0.45;
const STAGGER = 0.5;

/**
 * Where each blade of a level goes (across `width`, centred on the group's middle) and how long it is:
 *   alternate  `count` across, neighbours staggered ahead / behind (two rows, so their sweeps overlap);
 *   grid       `rows` x `cols` evenly spaced, each a column's width (x `size`) long, rows a blade's length apart.
 * The editor's Tractor tab lays them out the same (tractor.js bladeSpots()).
 */
export function bladeSpots(look: BladeLevelDef, width: number): { x: number; z: number; length: number }[] {
    const spots: { x: number; z: number; length: number }[] = [];
    if (look.layout === 'grid') {
        const rows = Math.max(1, Math.round(look.rows ?? 1));
        const cols = Math.max(1, Math.round(look.cols ?? 1));
        const span = width / cols;
        const length = span * look.size;
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) spots.push({ x: -width / 2 + span * (c + 0.5), z: ((rows - 1) / 2 - r) * span, length });
        }
        return spots;
    }
    const count = Math.max(1, Math.round(look.count));
    const span = width / count;
    const length = count > 1 ? Math.max(span * look.size * 1.06, width * MIN_SHARE) : span * look.size;
    for (let i = 0; i < count; i++) {
        spots.push({ x: -width / 2 + span * (i + 0.5), z: count > 1 ? (i % 2 === 0 ? 1 : -1) * length * STAGGER : 0, length });
    }
    return spots;
}

/** A blade level's look (the last one past the end of the list). */
export const bladeLook = (level: number): BladeLevelDef => {
    const levels = MOW.bladeLevels;
    return levels[Math.max(0, Math.min(level, levels.length - 1))];
};

export class MowerBlades {
    public readonly group = new THREE.Group();
    private readonly spinners: THREE.Object3D[] = [];
    private built = '';
    /** One blade's radius now (half its length): how far past the front edge they sit (MOUNT.ahead). */
    public radius = 0;

    /** `prepare` runs on every material (the world bend). */
    public constructor(private readonly prepare: (material: THREE.Material) => void = () => {}) {
        this.group.name = 'blades';
    }

    /** Builds (or rebuilds, when they changed) the blades of `level` spanning `width` (in the group's units). */
    public set(level: number, width: number): void {
        const key = `${level}:${width.toFixed(3)}`;
        if (key === this.built) return;
        this.built = key;
        for (const child of [...this.group.children]) {
            child.traverse((part) => {
                if (part instanceof THREE.Mesh) part.geometry.dispose();
            });
            child.removeFromParent();
        }
        this.spinners.length = 0;
        const look = bladeLook(level);
        const materials = this.materials();
        for (const { x, z, length } of bladeSpots(look, width)) {
            const blade = MowerBlades.blade(length, materials);
            blade.position.set(x, HEIGHT, z);
            blade.rotation.y = (this.spinners.length * Math.PI) / Math.max(2, bladeCount(look));
            this.group.add(blade);
            this.spinners.push(blade);
            this.radius = length / 2;
        }
    }

    /** Spins them (`moving`: the mower's going). Neighbours turn opposite ways, as real twin decks do. */
    public spin(delta: number, moving: boolean): void {
        const speed = (moving ? SPIN.moving : SPIN.idle) * delta;
        this.spinners.forEach((blade, i) => (blade.rotation.y += i % 2 === 0 ? speed : -speed));
    }

    private materialSet?: { steel: THREE.Material; tip: THREE.Material; hub: THREE.Material; sweep: THREE.Material };

    private materials(): { steel: THREE.Material; tip: THREE.Material; hub: THREE.Material; sweep: THREE.Material } {
        if (this.materialSet) return this.materialSet;
        const make = <T extends THREE.Material>(material: T): T => {
            this.prepare(material);
            return material;
        };
        this.materialSet = {
            steel: make(new THREE.MeshStandardMaterial({ color: 0xe9eef3, metalness: 0.55, roughness: 0.3 })),
            tip: make(new THREE.MeshStandardMaterial({ color: 0xe0402f, roughness: 0.5 })),
            hub: make(new THREE.MeshStandardMaterial({ color: 0x2b2b30, roughness: 0.7 })),
            sweep: make(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.24, depthWrite: false, side: THREE.DoubleSide })),
        };
        return this.materialSet;
    }

    /** One blade `length` across: the bar, its red tips, the hub, the sweep disc under it. */
    private static blade(length: number, m: { steel: THREE.Material; tip: THREE.Material; hub: THREE.Material; sweep: THREE.Material }): THREE.Group {
        const blade = new THREE.Group();
        const wide = length * BAR.wide;
        const bar = new THREE.Mesh(new THREE.BoxGeometry(length * 0.78, BAR.thick, wide), m.steel);
        blade.add(bar);
        for (const side of [-1, 1]) {
            // The tips: a little wider, swept back a touch (a cutting edge), in red so the turn shows.
            const tip = new THREE.Mesh(new THREE.BoxGeometry(length * 0.11, BAR.thick * 1.2, wide * 1.15), m.tip);
            tip.position.set(side * length * 0.445, 0, side * wide * 0.12);
            tip.rotation.y = side * 0.25;
            blade.add(tip);
        }
        const hub = new THREE.Mesh(new THREE.CylinderGeometry(length * BAR.hub, length * BAR.hub, BAR.thick * 2.4, 14), m.hub);
        blade.add(hub);
        const sweep = new THREE.Mesh(new THREE.CircleGeometry(length / 2, 28), m.sweep);
        sweep.rotation.x = -Math.PI / 2;
        sweep.position.y = -BAR.thick;
        blade.add(sweep);
        return blade;
    }

    public dispose(): void {
        this.group.traverse((part) => {
            if (part instanceof THREE.Mesh) part.geometry.dispose();
        });
        if (this.materialSet) Object.values(this.materialSet).forEach((material) => material.dispose());
        this.group.removeFromParent();
    }
}
