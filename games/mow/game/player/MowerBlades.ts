// MowerBlades.ts
//
// The blades under a mower, the cutting power you can see (README_PROGRESSION.md, "Blades"). Their level (the Blades
// upgrade: ui/mow.json `bladeLevels`) is how many there are and how long: one small blade, one big, then 2, 3, 4...
// side by side across the cut. Each is a circular saw — a disc with big rounded teeth (clearly a saw, never sharp: a
// kids' game) on a dark hub with a coloured ring — spinning flat just over the ground, a faint disc in its colour where
// it sweeps. Its colour climbs with the level (LEVEL_COLORS: steel, bronze, copper... gold, ruby, diamond), the top
// ones glowing a little, so better blades look better. Together they span the cutting width
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
/** The saw: its thickness, its rounded teeth (how many, how deep: a share of the radius), the hub (x the length). */
const SAW = { thick: 0.035, teeth: 12, depth: 0.16, hub: 0.11 };
/**
 * The saw's colour by Blades level (0 = before the first upgrade), the last for any past it: steel, bright steel,
 * bronze, copper, silver-blue, emerald, sapphire, amethyst, gold, ruby, diamond, rose gold, rainbow pink.
 * (A level's `color` in ui/mow.json overrides it.)
 */
const LEVEL_COLORS = [0x9aa3ad, 0xd5dbe2, 0xc98a45, 0xd2693a, 0x9fc4e8, 0x2fbf71, 0x2f7de0, 0x9a5cf0, 0xf2c230, 0xe0384e, 0x7fe9ff, 0xf3a6a0, 0xff5fd2];
/** From this level on the saw glows a little in its own colour. */
const GLOW_FROM = 8;

interface SawMaterials {
    face: THREE.Material;
    edge: THREE.Material;
    ring: THREE.Material;
    hub: THREE.Material;
    sweep: THREE.Material;
}

/** The saw discs' geometry by radius (shared: every saw of a size is the same shape). */
const sawShapes = new Map<string, THREE.ExtrudeGeometry>();

/**
 * A circular saw's disc of `radius`, flat in XY (extruded along Z): SAW.teeth big teeth, each a soft bump that rises
 * steeply and slopes back (so it reads as a saw turning one way), all curves, no points. Caps take material 0, the
 * rim material 1. Cached per size: callers must not dispose it on their own (MowerBlades.set() skips them).
 */
function sawGeometry(radius: number): THREE.ExtrudeGeometry {
    const key = radius.toFixed(3);
    const cached = sawShapes.get(key);
    if (cached) return cached;
    const shape = new THREE.Shape();
    const steps = SAW.teeth * 12;
    for (let i = 0; i <= steps; i++) {
        const angle = (i / steps) * Math.PI * 2;
        const t = (i % 12) / 12;
        // A tooth: up quickly (eased), then down slowly, rounded at the top and at the gullet.
        const rise = t < 0.3 ? Math.sin((t / 0.3) * Math.PI / 2) : Math.cos(((t - 0.3) / 0.7) * Math.PI / 2);
        const r = radius * (1 - SAW.depth + SAW.depth * Math.pow(Math.max(0, rise), 0.8));
        const x = Math.cos(angle) * r;
        const y = Math.sin(angle) * r;
        if (i === 0) shape.moveTo(x, y);
        else shape.lineTo(x, y);
    }
    const geometry = new THREE.ExtrudeGeometry(shape, {
        depth: SAW.thick, bevelEnabled: true, bevelThickness: SAW.thick * 0.3, bevelSize: radius * 0.02, bevelSegments: 2, curveSegments: 4,
    });
    geometry.translate(0, 0, -SAW.thick / 2);
    sawShapes.set(key, geometry);
    return geometry;
}
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
                if (part instanceof THREE.Mesh && !(part.geometry instanceof THREE.ExtrudeGeometry)) part.geometry.dispose();
            });
            child.removeFromParent();
        }
        this.spinners.length = 0;
        const look = bladeLook(level);
        const materials = this.materials(level);
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

    private materialSet?: SawMaterials;
    private materialLevel = -1;

    /** The saw's materials at `level` (made again when the level changes: each level has its colour). */
    private materials(level: number): SawMaterials {
        if (this.materialSet && this.materialLevel === level) return this.materialSet;
        if (this.materialSet) Object.values(this.materialSet).forEach((material) => material.dispose());
        this.materialLevel = level;
        const make = <T extends THREE.Material>(material: T): T => {
            this.prepare(material);
            return material;
        };
        const color = new THREE.Color(bladeLook(level).color ?? LEVEL_COLORS[Math.min(level, LEVEL_COLORS.length - 1)]);
        // The top levels glow a little in their own colour.
        const glow = level >= GLOW_FROM ? color.clone().multiplyScalar(0.35) : new THREE.Color(0x000000);
        this.materialSet = {
            face: make(new THREE.MeshStandardMaterial({ color, metalness: 0.45, roughness: 0.32, emissive: glow })),
            edge: make(new THREE.MeshStandardMaterial({ color: color.clone().lerp(new THREE.Color(0xffffff), 0.45), metalness: 0.5, roughness: 0.25, emissive: glow })),
            ring: make(new THREE.MeshStandardMaterial({ color: color.clone().lerp(new THREE.Color(0xffffff), 0.7), roughness: 0.4, emissive: glow })),
            hub: make(new THREE.MeshStandardMaterial({ color: 0x2b2b30, roughness: 0.7 })),
            sweep: make(new THREE.MeshBasicMaterial({ color: color.clone().lerp(new THREE.Color(0xffffff), 0.5), transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide })),
        };
        return this.materialSet;
    }

    /**
     * One saw `length` across: the disc (big rounded teeth round its rim, their faces in the level's colour, their
     * edges lighter), a ring and the hub on top, the sweep disc under it.
     */
    private static blade(length: number, m: SawMaterials): THREE.Group {
        const blade = new THREE.Group();
        const disc = new THREE.Mesh(sawGeometry(length / 2), [m.face, m.edge]);
        disc.rotation.x = -Math.PI / 2;
        disc.position.y = -SAW.thick / 2;
        blade.add(disc);
        const ring = new THREE.Mesh(new THREE.RingGeometry(length * 0.2, length * 0.27, 28), m.ring);
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = SAW.thick / 2 + 0.004;
        blade.add(ring);
        const hub = new THREE.Mesh(new THREE.CylinderGeometry(length * SAW.hub, length * SAW.hub, SAW.thick * 2.6, 14), m.hub);
        blade.add(hub);
        const sweep = new THREE.Mesh(new THREE.CircleGeometry(length / 2, 28), m.sweep);
        sweep.rotation.x = -Math.PI / 2;
        sweep.position.y = -SAW.thick * 1.2;
        blade.add(sweep);
        return blade;
    }

    public dispose(): void {
        this.group.traverse((part) => {
            if (part instanceof THREE.Mesh && !(part.geometry instanceof THREE.ExtrudeGeometry)) part.geometry.dispose();
        });
        if (this.materialSet) Object.values(this.materialSet).forEach((material) => material.dispose());
        this.group.removeFromParent();
    }
}
