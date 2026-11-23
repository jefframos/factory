// Growth.ts
//
// What grows past grass, the mower's next steps (ui/mow.json `growth`): bushes to dig out, trees to chop down, then
// rocks to break up (the end zones) —
// part of the same ladder as the grass, each type a step tougher (`resistance`, the cutting power it takes) and worth
// more clippings (`value`). A section lists what grows in it (DistrictDef.growth: a type and how many per square
// unit); they're scattered over it at seeded spots (the same every game), off anything else (props, pavements, dens,
// stations: Town.isBlocked) and apart from each other.
//
// Standing, each is solid (blockers(): the player walks round it, the mower stops at it). The mower's sweep (cut(),
// from MowingSystem) chews it by power, as with grass: more power than it takes clears it fast, as much labours,
// one short chews slowly, two short or more is a wall (with the hint saying the blades it takes). While chewed it
// shakes; cleared, a bush squashes into the ground (a patch of earth left), a tree falls over away from the mower and
// sinks (a stump left). Cleared ones are saved (MowProgress.growthCleared); a section restored clears what's left.

import * as THREE from 'three';
import gsap from 'gsap';
import ModelLoaderManager from 'core/three/ModelLoaderManager';
import { BendService } from '../services/BendService';
import { MOW, TOWN, GrowthDef, lawnLift, choppableKind, districtAt } from '../data/MowConfig';
import type { Box } from './GuidePath';

/** Fewest units between two growths, and how far in from a section's edge they stay. */
const SPACING = 1.9;
const EDGE = 1.2;
/** Chewing time (x the type's chewSec) by how many powers short the mower is: one short, as tough as it, more than it. */
const CHEW_SHORT = 4;
const CHEW_EVEN = 1.6;
const CHEW_OVER = 0.6;
/** How much of its radius is solid (the trunk, the bush's core). */
const SOLID = 0.6;

interface Item {
    id: number;
    def: GrowthDef;
    district: number;
    x: number;
    z: number;
    radius: number;
    object: THREE.Group;
    /** Seconds of chewing so far. */
    chew: number;
    cleared: boolean;
    shake: number;
    /** A hand-placed tree or bush (the level's props): its own model and height; restoring its area leaves it. */
    fixed?: { model: string; height: number };
}

/** Hand-placed trees and bushes take ids from here (the scattered ones count up from 0: saves keep both apart). */
const FIXED_ID_BASE = 100000;
/** A hand-placed one pays this many times its clippings' worth (MowingSystem: a lump worth going back for). */
export const FIXED_BONUS = 10;

export interface GrowthCut {
    /** Cleared this step: what it was, where, its clippings. */
    cleared: { id: number; def: GrowthDef; at: THREE.Vector3; value: number; district: number; fixed: boolean }[];
    /** Being chewed (not through yet): where, and its colour (the chips). */
    chewing?: { at: THREE.Vector3; color: THREE.Color };
    /** The toughest one met that the mower can't cut at all. */
    blocked?: GrowthDef;
}

/** Seeded random in [0, 1). */
function seeded(seed: number): () => number {
    let s = seed % 233280;
    return () => {
        s = (s * 9301 + 49297) % 233280;
        return s / 233280;
    };
}

export class Growth {
    private readonly group = new THREE.Group();
    private readonly items: Item[] = [];
    private boxes: Box[] = [];
    /** Each type's model, sized and painted once (copies share its materials). */
    private readonly templates = new Map<string, Promise<THREE.Object3D | null>>();
    private readonly color = new THREE.Color();

    /**
     * `isBlocked(x, z)`: where nothing may grow (Town.isBlocked). `cleared(id)`: already cleared (a save).
     * `restored(d)`: a restored section (all its growth gone).
     */
    public constructor(threeScene: THREE.Scene, isBlocked: (x: number, z: number) => boolean, cleared: (id: number) => boolean,
        restored: (district: number) => boolean) {
        const types = new Map((MOW.growth ?? []).map((def) => [def.id, def]));
        let id = 0;
        MOW.districts.forEach((district, d) => {
            const random = seeded(Math.round(Math.abs(district.x * 73 + district.z * 151 + d * 977)) + 11);
            for (const entry of district.growth ?? []) {
                const def = types.get(entry.type);
                if (!def) continue;
                const want = Math.round(district.width * district.depth * entry.density);
                // Tries enough for a crowded section, the rest skipped.
                for (let tries = 0, placed = 0; placed < want && tries < want * 12; tries++) {
                    const x = district.x + (random() - 0.5) * (district.width - EDGE * 2);
                    const z = district.z + (random() - 0.5) * (district.depth - EDGE * 2);
                    const scale = 0.85 + random() * 0.3;
                    const turn = random() * Math.PI * 2;
                    const radius = def.radius * scale;
                    if (isBlocked(x, z) || this.items.some((item) => Math.hypot(item.x - x, item.z - z) < SPACING + (item.radius + radius) * 0.5)) continue;
                    const item: Item = { id: id++, def, district: d, x, z, radius, object: new THREE.Group(), chew: 0, cleared: cleared(id - 1) || restored(d), shake: 0 };
                    placed++;
                    item.object.position.set(x, lawnLift(), z);
                    item.object.rotation.y = turn;
                    item.object.scale.setScalar(scale);
                    item.object.visible = !item.cleared;
                    this.group.add(item.object);
                    this.items.push(item);
                    if (!item.cleared) void this.fill(item);
                    else this.addRemains(item, def.kind);
                }
            }
        });
        this.addHandPlaced(types, cleared);
        this.refreshBoxes();
        threeScene.add(this.group);
    }

    /**
     * The level's hand-placed trees and bushes inside an area (choppableKind): a tree or a bush like the rest (its
     * toughness and clippings), in its own model and height, where it was placed. Restoring the area leaves them: they
     * wait until the blades are up to them.
     */
    private addHandPlaced(types: Map<string, GrowthDef>, cleared: (id: number) => boolean): void {
        let id = FIXED_ID_BASE;
        for (const prop of TOWN.props) {
            const kind = choppableKind(prop);
            if (!kind) continue;
            const def = types.get(kind);
            if (!def) continue;
            const itemId = id++;
            const half = Math.max(prop.collider?.halfX ?? 0, prop.collider?.halfZ ?? 0);
            const radius = half > 0 ? half / SOLID : def.radius;
            const item: Item = {
                id: itemId, def, district: districtAt(prop.x, prop.z), x: prop.x, z: prop.z, radius, object: new THREE.Group(),
                chew: 0, cleared: cleared(itemId), shake: 0, fixed: { model: prop.model, height: prop.height ?? def.height },
            };
            item.object.position.set(prop.x, lawnLift(), prop.z);
            item.object.rotation.y = prop.rotationY ?? 0;
            item.object.visible = !item.cleared;
            this.group.add(item.object);
            this.items.push(item);
            if (!item.cleared) void this.fill(item);
            else this.addRemains(item, def.kind);
        }
    }

    /** A type's model (its first: a type lists several, picked by the item's id), its height the type's. */
    private template(def: GrowthDef, index: number): Promise<THREE.Object3D | null> {
        return this.load(def.models[index % def.models.length], def.height, def.tint);
    }

    /** A model fitted to `height` (its base on the ground, centred), painted by `tint`; loaded once per look. */
    private load(path: string, height: number, tintHex?: string): Promise<THREE.Object3D | null> {
        const key = `${path}:${height}:${tintHex ?? ''}`;
        let found = this.templates.get(key);
        if (!found) {
            found = ModelLoaderManager.instance.loadModel(`./mow/models/${path}`).then((object) => {
                const tint = tintHex ? new THREE.Color(tintHex) : null;
                object.traverse((child) => {
                    if (!(child instanceof THREE.Mesh)) return;
                    child.material = [child.material].flat().map((m) => {
                        const copy = (m as THREE.MeshStandardMaterial).clone();
                        if (tint && 'color' in copy) copy.color.multiply(tint);
                        BendService.applyBend(copy);
                        return copy;
                    });
                    if ((child.material as THREE.Material[]).length === 1) child.material = (child.material as THREE.Material[])[0];
                });
                const box = new THREE.Box3().setFromObject(object);
                const size = box.getSize(new THREE.Vector3());
                const holder = new THREE.Group();
                object.position.set(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
                holder.add(object);
                holder.scale.setScalar(height / Math.max(size.y, 1e-3));
                return holder;
            }).catch((error) => {
                console.warn('[Growth] model', path, error);
                return null;
            });
            this.templates.set(key, found);
        }
        return found;
    }

    private async fill(item: Item): Promise<void> {
        const template = item.fixed ? await this.load(item.fixed.model, item.fixed.height) : await this.template(item.def, item.id);
        if (template && !item.cleared) item.object.add(template.clone(true));
    }

    private refreshBoxes(): void {
        this.boxes = this.items.filter((item) => !item.cleared).map((item) => ({ x: item.x, z: item.z, halfX: item.radius * SOLID, halfZ: item.radius * SOLID }));
    }

    /** What stands in the way (the growth not cleared yet). */
    public blockers(): readonly Box[] {
        return this.boxes;
    }

    /**
     * Chews whatever stands within `radius` of the segment a -> b (the mower's sweep) with `power`, `delta` seconds of
     * it, in sections `canCut` allows (open ones). Too tough: reported (`blocked`), untouched.
     */
    public cut(ax: number, az: number, bx: number, bz: number, radius: number, power: number, delta: number, canCut: (district: number) => boolean): GrowthCut {
        const result: GrowthCut = { cleared: [] };
        const abx = bx - ax;
        const abz = bz - az;
        const length2 = abx * abx + abz * abz;
        for (const item of this.items) {
            if (item.cleared || !canCut(item.district)) continue;
            const t = length2 > 0 ? Math.min(1, Math.max(0, ((item.x - ax) * abx + (item.z - az) * abz) / length2)) : 0;
            const dx = item.x - (ax + abx * t);
            const dz = item.z - (az + abz * t);
            const reach = radius + item.radius * 0.5;
            if (dx * dx + dz * dz > reach * reach) continue;
            const short = item.def.resistance - power;
            if (short >= 2) {
                // (A hand-placed one far out of reach stays quiet, like the scenery it was: no "needs blades 7" for a
                // new player; it speaks up once the blades are one step from it.)
                const quiet = !!item.fixed && short > 2;
                if (!quiet && (!result.blocked || item.def.resistance > result.blocked.resistance)) result.blocked = item.def;
                continue;
            }
            item.chew += delta;
            item.shake = 0.15;
            const need = item.def.chewSec * (short >= 1 ? CHEW_SHORT : short === 0 ? CHEW_EVEN : CHEW_OVER);
            if (item.chew < need) {
                result.chewing ??= { at: new THREE.Vector3(item.x, item.def.height * 0.4, item.z), color: this.color.set(item.def.color).clone() };
                continue;
            }
            this.clear(item, ax, az, true);
            result.cleared.push({ id: item.id, def: item.def, at: new THREE.Vector3(item.x, item.def.height * 0.4, item.z), value: item.def.value, district: item.district, fixed: !!item.fixed });
        }
        if (result.cleared.length) this.refreshBoxes();
        return result;
    }

    /** Whether a bush, tree or rock `power` can clear (or chew) stands within `radius` of (x, z), in a section `canCut` allows. */
    public mowableNear(x: number, z: number, radius: number, power: number, canCut: (district: number) => boolean): boolean {
        for (const item of this.items) {
            if (item.cleared || item.def.resistance - power >= 2 || !canCut(item.district)) continue;
            const reach = radius + item.radius;
            if ((item.x - x) ** 2 + (item.z - z) ** 2 <= reach * reach) return true;
        }
        return false;
    }

    /** How many of a section's own bushes, trees and rocks still stand (the hand-placed ones don't count). */
    public standingIn(district: number): number {
        return this.items.filter((item) => item.district === district && !item.cleared && !item.fixed).length;
    }

    /** The ids cleared (for the save). */
    public get clearedIds(): number[] {
        return this.items.filter((item) => item.cleared).map((item) => item.id);
    }

    /** A section restored: whatever still grows there goes (popping, if `animate`). */
    public clearSection(district: number, animate: boolean): void {
        let any = false;
        for (const item of this.items) {
            if (item.cleared || item.district !== district || item.fixed) continue;
            this.clear(item, item.x, item.z + 1, animate);
            any = true;
        }
        if (any) this.refreshBoxes();
    }

    /**
     * Cleared: a bush squashes into the ground leaving a patch of earth; a tree falls over away from (fromX, fromZ)
     * and sinks, leaving a stump.
     */
    private clear(item: Item, fromX: number, fromZ: number, animate: boolean): void {
        item.cleared = true;
        const object = item.object;
        const tree = item.def.kind === 'tree';
        this.addRemains(item, item.def.kind);
        if (!animate) {
            object.visible = false;
            return;
        }
        if (tree) {
            // Falls away from the mower: turned about the horizontal axis across that way.
            const away = new THREE.Vector3(item.x - fromX, 0, item.z - fromZ);
            if (away.lengthSq() < 1e-6) away.set(0, 0, 1);
            away.normalize();
            const axis = new THREE.Vector3(away.z, 0, -away.x);
            const start = object.quaternion.clone();
            const fall = { t: 0 };
            gsap.timeline({ onComplete: () => void (object.visible = false) })
                .to(fall, {
                    t: 1, duration: 0.7, ease: 'power2.in',
                    onUpdate: () => void object.quaternion.copy(new THREE.Quaternion().setFromAxisAngle(axis, (Math.PI / 2) * fall.t).multiply(start)),
                })
                .to(object.position, { y: -1.5, duration: 0.5, ease: 'power1.in' });
        } else if (item.def.kind === 'rock') {
            // Breaks up: a jolt, then it crumbles down into its rubble.
            const s = object.scale.x;
            gsap.timeline({ onComplete: () => void (object.visible = false) })
                .to(object.scale, { x: s * 1.12, y: s * 0.9, z: s * 1.12, duration: 0.08 })
                .to(object.scale, { x: s * 0.4, y: 0.01, z: s * 0.4, duration: 0.3, ease: 'power2.in' });
        } else {
            gsap.to(object.scale, { x: object.scale.x * 1.25, y: 0.01, z: object.scale.z * 1.25, duration: 0.35, ease: 'back.in(2)', onComplete: () => void (object.visible = false) });
        }
    }

    /** What's left: a stump (a tree), a patch of earth (a bush), a few bits of rubble (a rock). */
    private addRemains(item: Item, kind: GrowthDef['kind']): void {
        if (kind === 'rock') {
            const stone = new THREE.MeshStandardMaterial({ color: 0x8a8f96, roughness: 1, flatShading: true });
            BendService.applyBend(stone);
            for (let i = 0; i < 4; i++) {
                const bit = new THREE.Mesh(new THREE.DodecahedronGeometry(item.radius * (0.16 + (i % 2) * 0.08), 0), stone);
                const a = i * 1.7 + item.id;
                bit.position.set(item.x + Math.cos(a) * item.radius * 0.45, lawnLift() + 0.06, item.z + Math.sin(a) * item.radius * 0.45);
                bit.rotation.set(a, a * 0.7, 0);
                this.group.add(bit);
            }
            return;
        }
        const tree = kind === 'tree';
        const material = new THREE.MeshStandardMaterial({ color: tree ? 0x7a5236 : 0x6b4f3a, roughness: 1 });
        BendService.applyBend(material);
        const mesh = tree
            ? new THREE.Mesh(new THREE.CylinderGeometry(item.radius * 0.45, item.radius * 0.55, 0.35, 10), material)
            : new THREE.Mesh(new THREE.CylinderGeometry(item.radius * 0.9, item.radius * 0.9, 0.03, 14), material);
        mesh.position.set(item.x, lawnLift() + (tree ? 0.17 : 0.03), item.z);
        this.group.add(mesh);
    }

    /** Each frame: what's being chewed shakes. */
    public update(delta: number): void {
        for (const item of this.items) {
            if (item.shake <= 0 || item.cleared) continue;
            item.shake = Math.max(0, item.shake - delta);
            const wobble = item.shake > 0 ? Math.sin(performance.now() / 30 + item.id) * 0.05 : 0;
            item.object.rotation.z = wobble;
            item.object.rotation.x = wobble * 0.6;
        }
    }

    public destroy(): void {
        for (const item of this.items) {
            gsap.killTweensOf(item.object.scale);
            gsap.killTweensOf(item.object.position);
        }
        this.group.removeFromParent();
    }
}
