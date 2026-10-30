// Town.ts
//
// The town around the grass, built from levels/town.json (edited in the editor: npm run editor): the ground, the
// pavements (plaza, road, park paths: walkable, no grass), the props (library models: KayKit City Builder Bits and
// Forest trees, fitted to their height like dig's hub props), the sections' separators (a fence with a sign closing
// each locked section off) and the ATMs — as many as the level places, each a pad with the ATM behind it and a
// floating money icon; standing on any one sells the bag and opens the shop. An ATM can belong to a section (`section`):
// it pops in when that section opens, so there's always one close to the grass being mowed.
//
// Models load in the background (`ready`); the boxes they block come from the level, so walking and the grass (which
// needs to know what's covered) never wait on them. Props marked `fade` (trees, buildings) dither out while they
// stand between the camera and the player: BendService's occlusion fade.
//
// It answers the two questions the rest asks of the layout: whether a point is walkable (inside an open section or a
// pavement, off the obstacles, not through a closed separator: TileWalkability) and whether a grass cell sits under
// something (no grass there: GrassField). Restoring a section opens the next one (unlock()) and plants flowers in it
// (bloom()).

import * as THREE from 'three';
import gsap from 'gsap';
import ModelLoaderManager from 'core/three/ModelLoaderManager';
import { MOW, TOWN, AtmSpot, DistrictDef, TownProp } from '../data/MowConfig';
import { BendService, OcclusionFadeConfig, STRUCTURE_OCCLUSION_FADE } from '../services/BendService';
import { CanvasArt } from '../ui/CanvasArt';
import { setWalkabilityQuery, clearWalkabilityQuery } from './TileWalkability';

/** An axis-aligned box on the ground (centre, half sizes). */
export interface Box {
    x: number;
    z: number;
    halfX: number;
    halfZ: number;
}

const MODEL_BASE = './mow/models/';
/** The player's footprint radius for walking. */
const BODY_RADIUS = 0.35;
/** ATM pads: radius (standing inside uses it). */
export const PAD_RADIUS = 1.4;
/**
 * Ground layers, far enough apart that nothing z-fights once the world bends: the town's ground, then the sections'
 * grass ground (GrassField, 0.01), then each pavement a step above the last (paths over the park, road over the town).
 */
const GROUND_Y = -0.05;
const PAVEMENT_Y = 0.03;
const PAVEMENT_STEP = 0.015;
/** Flat things are cut into pieces this small (world units) so they curve with the bend instead of cutting through it. */
const BEND_SEGMENT = 0.5;
/** Models flatter than this (the road tiles) get cut up like that. */
const FLAT_HEIGHT = 0.3;
/** A restored section's flowers (KayKit Mixed Bag), and how tall they stand. */
const FLOWER_MODELS = ['town/nature/flax_flower_A.gltf', 'town/nature/flax_flower_B.gltf'];
const FLOWER_HEIGHT = 0.85;
/** Trees and buildings: the whole model dithers out while the camera->player line runs through it. */
const FADE: OcclusionFadeConfig = { ...STRUCTURE_OCCLUSION_FADE, radius: 0.4 };

/** The box an ATM blocks (its model, `back` behind the pad). */
function atmBox(spot: AtmSpot): Box {
    const look = TOWN.atm;
    const turn = spot.rotationY ?? 0;
    const sideways = Math.abs(Math.sin(turn)) > 0.5;
    return {
        x: spot.x - Math.sin(turn) * look.back,
        z: spot.z - Math.cos(turn) * look.back,
        halfX: sideways ? look.collider.halfZ : look.collider.halfX,
        halfZ: sideways ? look.collider.halfX : look.collider.halfZ,
    };
}

/**
 * Splits a geometry's triangles (each on its longest edge, again and again) until no edge is longer than `max` at
 * `scale`, so a big flat model curves with the world bend (the shader moves vertices only). Every attribute is
 * interpolated along.
 */
function subdivide(source: THREE.BufferGeometry, max: number, scale: THREE.Vector3): THREE.BufferGeometry {
    const geometry = source.index ? source.toNonIndexed() : source.clone();
    const names = Object.keys(geometry.attributes);
    const attributes = names.map((name) => geometry.getAttribute(name) as THREE.BufferAttribute);
    // One vertex = every attribute's values, flattened.
    type Vertex = number[][];
    const read = (i: number): Vertex => attributes.map((a) => Array.from({ length: a.itemSize }, (_, k) => a.array[i * a.itemSize + k]));
    const mid = (a: Vertex, b: Vertex): Vertex => a.map((values, n) => values.map((v, k) => (v + b[n][k]) / 2));
    const position = names.indexOf('position');
    const length = (a: Vertex, b: Vertex) => Math.hypot(
        (a[position][0] - b[position][0]) * scale.x, (a[position][1] - b[position][1]) * scale.y, (a[position][2] - b[position][2]) * scale.z);
    const out: Vertex[] = [];
    const stack: Vertex[][] = [];
    for (let i = 0; i < geometry.getAttribute('position').count; i += 3) stack.push([read(i), read(i + 1), read(i + 2)]);
    while (stack.length) {
        const [a, b, c] = stack.pop()!;
        const edges = [length(a, b), length(b, c), length(c, a)];
        const longest = edges.indexOf(Math.max(...edges));
        if (edges[longest] <= max) {
            out.push(a, b, c);
            continue;
        }
        // Rotate so the longest edge is a-b, then split it at m.
        const [p, q, r] = longest === 0 ? [a, b, c] : longest === 1 ? [b, c, a] : [c, a, b];
        const m = mid(p, q);
        stack.push([p, m, r], [m, q, r]);
    }
    const result = new THREE.BufferGeometry();
    names.forEach((name, n) => {
        const size = attributes[n].itemSize;
        const array = new Float32Array(out.length * size);
        out.forEach((vertex, i) => array.set(vertex[n], i * size));
        result.setAttribute(name, new THREE.BufferAttribute(array, size, attributes[n].normalized));
    });
    result.computeBoundingBox();
    result.computeBoundingSphere();
    return result;
}

export class Town {
    private readonly group = new THREE.Group();
    /** What the props block (fixed). */
    private readonly propBoxes: Box[] = [];
    /** Each ATM's box (no grass under any of them; blocking once it's there). */
    private readonly atmBoxes: Box[] = TOWN.atms.map(atmBox);
    /** Each section's separator (index = section) and its box while it stands. */
    private readonly separators: (THREE.Group | undefined)[] = [];
    private readonly separatorBoxes: (Box | undefined)[] = [];
    private readonly open: boolean[];
    private readonly atmGroups: THREE.Group[] = [];
    /** Labels to draw again once the town is up (their atlas icons can come out blank while booting). */
    private readonly redraws: (() => void)[] = [];
    private readonly walkability = (x: number, z: number) => this.isWalkable(x, z);
    private readonly loads: Promise<unknown>[] = [];
    private destroyed = false;
    /** The player's footprint radius for walking (wider on the tractor). */
    public bodyRadius = BODY_RADIUS;
    /** Resolves once every model has loaded (or failed: the town still plays without one). */
    public readonly ready: Promise<void>;

    /** `open(d)`: whether section d is unlocked from the start (its predecessor restored). */
    public constructor(threeScene: THREE.Scene, open: (district: number) => boolean) {
        this.open = MOW.districts.map((_, d) => open(d));
        this.buildGround();
        TOWN.props.forEach((prop) => this.placeProp(prop));
        TOWN.atms.forEach((spot) => this.buildAtm(spot));
        this.buildSeparators();
        threeScene.add(this.group);
        setWalkabilityQuery(this.walkability);
        this.ready = Promise.all(this.loads).then(() => undefined);
        void this.ready.then(() => window.setTimeout(() => {
            if (!this.destroyed) this.redraws.forEach((redraw) => redraw());
        }, 300));
    }

    private material(color: number | string): THREE.MeshStandardMaterial {
        const material = new THREE.MeshStandardMaterial({ color, roughness: 0.85 });
        BendService.applyBend(material);
        return material;
    }

    /** A flat slab on the ground, subdivided so it follows the world bend. */
    private slab(x: number, z: number, width: number, depth: number, color: number | string, y: number): void {
        const geometry = new THREE.PlaneGeometry(width, depth, Math.ceil(width / BEND_SEGMENT), Math.ceil(depth / BEND_SEGMENT));
        geometry.rotateX(-Math.PI / 2);
        const mesh = new THREE.Mesh(geometry, this.material(color));
        mesh.position.set(x, y, z);
        this.group.add(mesh);
    }

    private buildGround(): void {
        const { ground } = TOWN;
        this.slab(ground.x, ground.z, ground.width, ground.depth, ground.color, GROUND_Y);
        TOWN.pavements.forEach((p, i) => this.slab(p.x, p.z, p.width, p.depth, p.color, PAVEMENT_Y + i * PAVEMENT_STEP));
    }

    private placeProp(prop: TownProp): void {
        if (prop.collider) this.propBoxes.push({ x: prop.x, z: prop.z, halfX: prop.collider.halfX, halfZ: prop.collider.halfZ });
        this.loads.push(this.loadModel(prop.model, prop.height, prop.fade, prop.stretch).then((object) => {
            if (!object) return;
            object.rotation.y = prop.rotationY;
            this.settle(object, prop.x, prop.elevation ?? 0, prop.z);
            this.group.add(object);
        }));
    }

    /**
     * Loads a model fitted to `height` (own materials, bent with the world; `fade`: the occlusion fade, measured while
     * it's still untransformed). Not placed yet: settle() does that once it's turned.
     */
    private async loadModel(model: string, height: number, fade?: boolean, stretch?: { x: number; z: number }): Promise<THREE.Object3D | undefined> {
        try {
            const object = await ModelLoaderManager.instance.loadModel(`${MODEL_BASE}${model}`);
            if (this.destroyed) return undefined;
            object.traverse((child) => {
                if (!(child instanceof THREE.Mesh)) return;
                child.material = Array.isArray(child.material) ? child.material.map((m) => m.clone()) : child.material.clone();
                (Array.isArray(child.material) ? child.material : [child.material]).forEach((m) => BendService.applyBend(m));
            });
            if (fade) BendService.applyOcclusionFadeToObject(object, FADE);
            object.updateMatrixWorld(true);
            const size = new THREE.Box3().setFromObject(object).getSize(new THREE.Vector3());
            if (size.y > 1e-4) object.scale.multiplyScalar(height / size.y);
            if (stretch) object.scale.multiply(new THREE.Vector3(stretch.x, 1, stretch.z));
            if (height < FLAT_HEIGHT) {
                object.updateMatrixWorld(true);
                object.traverse((child) => {
                    if (child instanceof THREE.Mesh) child.geometry = subdivide(child.geometry, BEND_SEGMENT, child.getWorldScale(new THREE.Vector3()));
                });
            }
            return object;
        } catch (error) {
            console.warn(`[Town] could not load ${model}`, error);
            return undefined;
        }
    }

    /** Puts a (turned) model's base at `y`, centred on x/z as modelled. */
    private settle(object: THREE.Object3D, x: number, y: number, z: number): void {
        object.position.set(0, 0, 0);
        object.updateMatrixWorld(true);
        const bounds = new THREE.Box3().setFromObject(object);
        object.position.set(x, y - bounds.min.y, z);
    }

    // ---------------------------------------------------------------- ATMs

    /** Whether an ATM is there: no section, or its section is open. */
    private atmShown(i: number): boolean {
        const section = TOWN.atms[i].section;
        if (!section) return true;
        const d = MOW.districts.findIndex((district) => district.id === section);
        return d < 0 || this.open[d];
    }

    /** An ATM, in its own frame (pad at the origin, the model `back` behind it on -Z, the label above the model). */
    private buildAtm(spot: AtmSpot): void {
        const look = TOWN.atm;
        const group = new THREE.Group();
        const pad = new THREE.Mesh(new THREE.CircleGeometry(PAD_RADIUS, 32), this.material(look.color));
        pad.rotation.x = -Math.PI / 2;
        pad.position.y = 0.1;
        (pad.material as THREE.MeshStandardMaterial).transparent = true;
        (pad.material as THREE.MeshStandardMaterial).opacity = 0.55;
        group.add(pad);
        this.loads.push(this.loadModel(look.model, look.height).then((object) => {
            if (!object) return;
            this.settle(object, 0, 0, -look.back);
            group.add(object);
        }));
        const canvas = document.createElement('canvas');
        // Just the money icon on its plaque: no words to translate.
        canvas.width = 128;
        canvas.height = 128;
        const g = canvas.getContext('2d')!;
        const draw = () => {
            g.clearRect(0, 0, canvas.width, canvas.height);
            CanvasArt.plaque(g, 6, 6, 116, 116, 24);
            CanvasArt.drawIcon(g, look.icon, 64, 64, 88);
        };
        draw();
        const texture = CanvasArt.texture(canvas);
        // Drawn while the game is still booting, the icon can come out blank: drawn again once the town is up.
        this.redraws.push(() => {
            CanvasArt.forgetIcon(look.icon);
            draw();
            texture.needsUpdate = true;
        });
        const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthWrite: false }));
        label.scale.set(1.3, 1.3, 1);
        label.position.set(0, look.label, -look.back);
        group.add(label);
        group.position.set(spot.x, 0, spot.z);
        group.rotation.y = spot.rotationY ?? 0;
        group.visible = this.atmShown(this.atmGroups.length);
        this.atmGroups.push(group);
        this.group.add(group);
    }

    /** The ATM whose pad is under (x, z), or -1. */
    public atmAt(x: number, z: number): number {
        return TOWN.atms.findIndex((spot, i) => this.atmShown(i) && Math.hypot(x - spot.x, z - spot.z) <= PAD_RADIUS);
    }

    /** The nearest ATM's pad that's there (where the arrows lead). */
    public nearestAtm(from: THREE.Vector3, out = new THREE.Vector3()): THREE.Vector3 {
        let best = Infinity;
        TOWN.atms.forEach((spot, i) => {
            const distance = Math.hypot(from.x - spot.x, from.z - spot.z);
            if (this.atmShown(i) && distance < best) {
                best = distance;
                out.set(spot.x, 0, spot.z);
            }
        });
        return out;
    }

    /** Where an ATM's model stands (the clippings are tossed into it). */
    public atmModelAt(i: number, out = new THREE.Vector3()): THREE.Vector3 {
        const box = this.atmBoxes[i];
        return out.set(box.x, TOWN.atm.height * 0.6, box.z);
    }

    /** A section's ATMs pop in (it just opened). */
    private revealAtms(): void {
        this.atmGroups.forEach((group, i) => {
            if (group.visible || !this.atmShown(i)) return;
            group.visible = true;
            group.scale.setScalar(0.01);
            gsap.to(group.scale, { x: 1, y: 1, z: 1, duration: 0.6, delay: 0.4, ease: 'back.out(2)' });
        });
    }

    // ---------------------------------------------------------------- separators

    /** A fence along each locked section's separator line, with a sign. */
    private buildSeparators(): void {
        MOW.districts.forEach((district, d) => {
            const line = district.separator;
            if (!line || d === 0) return;
            const fence = new THREE.Group();
            const white = this.material(0xffffff);
            const half = line.width / 2;
            for (let x = -half; x <= half + 0.01; x += 1.5) {
                const post = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.2, 0.2), white);
                post.position.set(x, 0.6, 0);
                fence.add(post);
            }
            for (const y of [0.45, 0.95]) {
                const rail = new THREE.Mesh(new THREE.BoxGeometry(line.width, 0.12, 0.08), white);
                rail.position.set(0, y, 0);
                fence.add(rail);
            }
            const canvas = document.createElement('canvas');
            canvas.width = 384;
            canvas.height = 96;
            const g = canvas.getContext('2d')!;
            CanvasArt.plaque(g, 6, 6, 372, 84, 20);
            CanvasArt.drawIcon(g, 'Icon_Lock02', 48, 48, 52);
            CanvasArt.text(g, `RESTORE THE ${MOW.districts[d - 1].name.toUpperCase()}`, 220, 50, 30, '#ffe27a', 290);
            const sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: CanvasArt.texture(canvas), depthWrite: false }));
            sign.scale.set(4.2, 1.05, 1);
            sign.position.set(0, 2.1, 0);
            fence.add(sign);
            fence.position.set(line.x, 0, line.z);
            fence.rotation.y = line.rotationY ?? 0;
            fence.visible = !this.open[d];
            this.group.add(fence);
            this.separators[d] = fence;
            const sideways = Math.abs(Math.sin(line.rotationY ?? 0)) > 0.5;
            this.separatorBoxes[d] = { x: line.x, z: line.z, halfX: sideways ? 0.25 : half, halfZ: sideways ? half : 0.25 };
        });
    }

    /** Opens a section: its fence sinks away (walkable now) and its ATMs pop in. */
    public unlock(district: number): void {
        this.open[district] = true;
        const fence = this.separators[district];
        if (fence) {
            gsap.to(fence.position, { y: -1.6, duration: 0.9, ease: 'power2.in', onComplete: () => void (fence.visible = false) });
        }
        this.revealAtms();
    }

    public isOpen(district: number): boolean {
        return this.open[district];
    }

    /** Where to look at a section from (its centre, on the ground). */
    public sectionCentre(district: DistrictDef, out = new THREE.Vector3()): THREE.Vector3 {
        return out.set(district.x, 0, district.z);
    }

    // ---------------------------------------------------------------- flowers

    /**
     * Flowers across a restored section (`points`: where, cut cells): the library's flax flowers, alternating between
     * its two kinds, each turned and sized a little differently, instanced (one draw per kind and part).
     */
    public bloom(points: THREE.Vector3[]): void {
        FLOWER_MODELS.forEach((model, kind) => {
            const spots = points.filter((_, i) => i % FLOWER_MODELS.length === kind);
            if (!spots.length) return;
            this.loads.push(this.loadModel(model, 1).then((object) => {
                if (!object || this.destroyed) return;
                object.updateMatrixWorld(true);
                const matrix = new THREE.Matrix4();
                const placed = new THREE.Matrix4();
                const turn = new THREE.Quaternion();
                const up = new THREE.Vector3(0, 1, 0);
                object.traverse((child) => {
                    if (!(child instanceof THREE.Mesh)) return;
                    const mesh = new THREE.InstancedMesh(child.geometry, child.material, spots.length);
                    spots.forEach((p, i) => {
                        const random = Math.abs(Math.sin(p.x * 12.9898 + p.z * 78.233)) % 1;
                        const size = FLOWER_HEIGHT * (0.75 + random * 0.5);
                        placed.compose(new THREE.Vector3(p.x, 0, p.z), turn.setFromAxisAngle(up, random * Math.PI * 2), new THREE.Vector3(size, size, size));
                        mesh.setMatrixAt(i, matrix.multiplyMatrices(placed, child.matrixWorld));
                    });
                    mesh.computeBoundingSphere();
                    this.group.add(mesh);
                });
            }));
        });
    }

    // ---------------------------------------------------------------- layout queries

    /** No grass under pavements, props or ATMs. */
    public isBlocked(x: number, z: number): boolean {
        const pad = 0.25;
        const under = (b: Box) => Math.abs(x - b.x) <= b.halfX + pad && Math.abs(z - b.z) <= b.halfZ + pad;
        return TOWN.pavements.some((p) => Math.abs(x - p.x) <= p.width / 2 + pad && Math.abs(z - p.z) <= p.depth / 2 + pad)
            || this.propBoxes.some(under) || this.atmBoxes.some(under);
    }

    /** Obstacles to walk around (for the guide's route): props, the ATMs that are there, closed fences. */
    public get blockers(): readonly Box[] {
        return [
            ...this.propBoxes,
            ...this.atmBoxes.filter((_, i) => this.atmShown(i)),
            ...this.separatorBoxes.filter((b, d): b is Box => !!b && !this.open[d]),
        ];
    }

    /** Inside the town (open sections, pavements), off obstacles and closed fences. */
    private isWalkable(x: number, z: number): boolean {
        const r = this.bodyRadius;
        const areas = [
            ...MOW.districts.filter((_, i) => this.open[i]).map((d) => [d.x, d.z, d.width / 2, d.depth / 2] as const),
            ...TOWN.pavements.map((p) => [p.x, p.z, p.width / 2, p.depth / 2] as const),
        ];
        // Each corner of the footprint inside some open area: areas that touch (park, road, plaza) join up.
        const inSome = (px: number, pz: number) => areas.some(([ax, az, hx, hz]) => Math.abs(px - ax) <= hx && Math.abs(pz - az) <= hz);
        if (!inSome(x - r, z - r) || !inSome(x + r, z - r) || !inSome(x - r, z + r) || !inSome(x + r, z + r)) return false;
        return !this.blockers.some((b) => Math.abs(x - b.x) <= b.halfX + r && Math.abs(z - b.z) <= b.halfZ + r);
    }

    public destroy(): void {
        this.destroyed = true;
        clearWalkabilityQuery(this.walkability);
        this.atmGroups.forEach((group) => gsap.killTweensOf(group.scale));
        this.separators.forEach((fence) => fence && gsap.killTweensOf(fence.position));
        this.group.removeFromParent();
    }
}
