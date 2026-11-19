// Backpack.ts
//
// The farm test's backpack: a rounded rucksack on the player's back (a body, a top flap, an outer pocket, the straps
// against the back), following the chest as they walk. It shows how full the bag is twice over:
//   - its colour: canvas when empty, turning grass green as it fills, and pulsing bright when it's full;
//   - a stack on top of it: the bag's grass as bales (one more every tenth of the bag), then the den goods carried
//     (eggs two a layer, then trays).
// It swells a touch as it fills. Riding a mower, it sits on the back of the mower, behind the seat. A change makes the
// stack give a little bounce; things flying in and out aim at its top (top()).

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { BendService } from '../services/BendService';
import { farmItem, FarmItem, ITEM_HEIGHT } from '../farm/FarmModels';
import type MowPlayer from './MowPlayer';

/** The bag (at the player's size 1): width, height, depth; how far behind the chest; how far down from it. */
const BAG = { width: 0.46, height: 0.5, depth: 0.28, back: 0.16, down: 0.2 };
/** Riding: behind the player and how high (times the mower's ride scale and the player's size). */
const RIDE = { back: 0.85, height: 0.72 };
/** Bales for a full bag (one per tenth), eggs per layer, and the most layers drawn. */
const MAX_BALES = 10;
const EGGS_PER_LAYER = 2;
const MAX_LAYERS = 16;
/** The bag's colour: empty, full, and the bright pulse it gives when full. */
const COLORS = { empty: new THREE.Color(0xd8b98a), full: new THREE.Color(0x4fc23a), flash: new THREE.Color(0xc8ff6a) };
/** The flap and pocket are this much darker than the body. */
const TRIM_SHADE = 0.72;

/**
 * A rucksack (the player's backpack, and the bag upgrade's picture: UpgradePads), its bottom at y 0, the side against
 * the back on +Z: a rounded body (`body`), a top flap with a buckle, an outer pocket (`trim`), the straps and side loops.
 */
export function buildRucksack(body: THREE.MeshStandardMaterial, trim: THREE.MeshStandardMaterial): THREE.Group {
    const group = new THREE.Group();
    const strap = new THREE.MeshStandardMaterial({ color: 0x4a3324, roughness: 0.8 });
    const metal = new THREE.MeshStandardMaterial({ color: 0xe8d27a, roughness: 0.4, metalness: 0.3 });
    [body, trim, strap, metal].forEach((m) => BendService.applyBend(m));
    const { width, height, depth } = BAG;
    const add = (geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number) => {
        const part = new THREE.Mesh(geometry, material);
        part.position.set(x, y, z);
        group.add(part);
        return part;
    };
    add(new RoundedBoxGeometry(width, height, depth, 3, 0.1), body, 0, height / 2, 0);
    const flap = add(new RoundedBoxGeometry(width + 0.02, 0.12, depth + 0.04, 2, 0.05), trim, 0, height - 0.02, -0.01);
    flap.rotation.x = 0.08;
    add(new RoundedBoxGeometry(0.1, 0.16, 0.03, 1, 0.012), trim, 0, height - 0.12, -depth / 2 - 0.03);
    add(new THREE.BoxGeometry(0.05, 0.04, 0.02), metal, 0, height - 0.19, -depth / 2 - 0.045);
    add(new RoundedBoxGeometry(width * 0.66, height * 0.36, 0.1, 2, 0.04), trim, 0, height * 0.28, -depth / 2 - 0.03);
    for (const x of [-0.12, 0.12]) add(new RoundedBoxGeometry(0.06, height * 0.9, 0.035, 1, 0.015), strap, x, height * 0.52, depth / 2 + 0.02);
    for (const x of [-1, 1]) add(new RoundedBoxGeometry(0.03, height * 0.5, 0.08, 1, 0.012), strap, x * (width / 2 + 0.01), height * 0.45, 0);
    return group;
}

/** The rucksack as the bag upgrade shows it: full (grass green). */
export function rucksackPicture(): THREE.Group {
    const body = new THREE.MeshStandardMaterial({ color: COLORS.full, roughness: 0.85 });
    const trim = new THREE.MeshStandardMaterial({ color: COLORS.full.clone().multiplyScalar(TRIM_SHADE), roughness: 0.85 });
    return buildRucksack(body, trim);
}

interface Layer {
    kind: FarmItem;
    count: number;
}

export class Backpack {
    private readonly group = new THREE.Group();
    private readonly bag = new THREE.Group();
    private readonly stack = new THREE.Group();
    private readonly body: THREE.MeshStandardMaterial;
    private readonly trim: THREE.MeshStandardMaterial;
    private readonly color = new THREE.Color();
    private key = '';
    private bounce = 0;
    private shownFill = 0;
    private time = 0;
    private topY = BAG.height;
    private readonly chest = new THREE.Vector3();
    private readonly forward = new THREE.Vector3();

    public constructor(threeScene: THREE.Scene, private readonly player: MowPlayer) {
        this.body = new THREE.MeshStandardMaterial({ color: COLORS.empty, roughness: 0.85 });
        this.trim = new THREE.MeshStandardMaterial({ color: COLORS.empty.clone().multiplyScalar(TRIM_SHADE), roughness: 0.85 });
        this.buildBag();
        this.group.add(this.bag);
        this.stack.position.y = BAG.height + 0.06;
        this.group.add(this.stack);
        threeScene.add(this.group);
    }

    /** The rucksack, its bottom at y 0, the side against the player's back on +Z. */
    private buildBag(): void {
        this.bag.add(buildRucksack(this.body, this.trim));
    }

    /** What's stacked on top now, bottom to top. */
    private layers(fill: number, eggs: number, trays: number): Layer[] {
        const layers: Layer[] = [];
        const bales = fill <= 0 ? 0 : Math.max(1, Math.ceil(Math.min(1, fill) * MAX_BALES));
        for (let i = 0; i < bales; i++) layers.push({ kind: 'bale', count: 1 });
        for (let left = eggs; left > 0; left -= EGGS_PER_LAYER) layers.push({ kind: 'egg', count: Math.min(EGGS_PER_LAYER, left) });
        for (let i = 0; i < trays; i++) layers.push({ kind: 'tray', count: 1 });
        return layers.slice(0, MAX_LAYERS);
    }

    private rebuild(layers: Layer[]): void {
        this.stack.clear();
        let y = 0;
        layers.forEach((layer, i) => {
            for (let n = 0; n < layer.count; n++) {
                const item = farmItem(layer.kind);
                const spread = layer.kind === 'egg' ? (n - (layer.count - 1) / 2) * 0.22 : 0;
                // A little stagger, so the tower looks stacked by hand.
                item.position.set(spread + Math.sin(i * 2.3) * 0.02, y, Math.cos(i * 1.7) * 0.02);
                item.rotation.y = layer.kind === 'egg' ? 0 : Math.sin(i * 1.3) * 0.12;
                this.stack.add(item);
            }
            y += ITEM_HEIGHT[layer.kind];
        });
        this.topY = BAG.height + 0.06 + y;
    }

    /**
     * Each frame: on the player's back (or, `riding` with `rideScale`, behind the seat), facing their way, with the
     * bag's `fill` (0..1) and the den goods carried. `scale`: the player's size.
     */
    public update(delta: number, fill: number, eggs: number, trays: number, scale: number, riding: boolean, rideScale: number): void {
        this.time += delta;
        const layers = this.layers(fill, eggs, trays);
        const key = layers.map((l) => `${l.kind}${l.count}`).join(',');
        if (key !== this.key) {
            this.key = key;
            this.rebuild(layers);
            this.bounce = 1;
        }
        this.bounce = Math.max(0, this.bounce - delta * 4);
        const squash = 1 + Math.sin(this.bounce * Math.PI) * 0.1;
        this.stack.scale.set(squash, 1 / squash, squash);

        // Its colour follows the fill (eased), pulsing bright when it's full; it swells a little as it fills.
        this.shownFill += (Math.min(1, fill) - this.shownFill) * Math.min(1, delta * 6);
        this.color.copy(COLORS.empty).lerp(COLORS.full, this.shownFill);
        if (fill >= 1) this.color.lerp(COLORS.flash, (Math.sin(this.time * 8) * 0.5 + 0.5) * 0.6);
        this.body.color.copy(this.color);
        this.trim.color.copy(this.color).multiplyScalar(TRIM_SHADE);
        const swell = 1 + this.shownFill * 0.12;
        this.bag.scale.set(swell, 1, 1 + this.shownFill * 0.25);

        const position = this.player.transform.position;
        const forward = this.player.heading(this.forward);
        this.group.scale.setScalar(scale);
        this.group.rotation.y = Math.atan2(forward.x, forward.z);
        if (riding) {
            const s = rideScale * scale;
            this.group.position.copy(position).addScaledVector(forward, -RIDE.back * s).setY(RIDE.height * s);
            return;
        }
        const chest = this.player.chestPoint(this.chest);
        if (chest) {
            this.group.position.copy(chest).addScaledVector(forward, -(BAG.back + BAG.depth / 2) * scale);
            this.group.position.y -= (BAG.down + BAG.height / 2) * scale;
        } else {
            this.group.position.copy(position).addScaledVector(forward, -0.35 * scale).setY(0.6 * scale);
        }
    }

    /** The stack's top, in the world (things fly in and out here). */
    public top(out = new THREE.Vector3()): THREE.Vector3 {
        return out.set(0, this.topY, 0).applyMatrix4(this.group.matrixWorld);
    }

    public destroy(): void {
        this.group.removeFromParent();
    }
}
