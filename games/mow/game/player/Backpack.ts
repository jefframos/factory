// Backpack.ts
//
// The farm test's backpack: a rounded rucksack on the player's back (a body, a top flap, an outer pocket, the straps
// against the back), following the chest as they walk. Its colour is the bag's level (each Bag upgrade a new one:
// BAG_COLORS; the Bag station shows the next in its colour). It shows how full it is twice over:
//   - it swells as it fills, and pulses bright when it's full;
//   - a stack on top of it: the bag's grass as bales (one more every tenth of the bag), then the den goods carried
//     (eggs two a layer, then trays).
// It swells a touch as it fills. Riding a mower, it sits on the back of the mower, behind the seat. A change makes the
// stack give a little bounce; things flying in and out aim at its top (top()).

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { BendService } from '../services/BendService';
import { farmItem, FarmItem, ITEM_HEIGHT } from '../farm/FarmModels';
import type MowPlayer from './MowPlayer';
import { MowProgress } from '../data/MowProgress';
import { MOW } from '../data/MowConfig';

/** The bag (at the player's size 1): width, height, depth; how far behind the chest; how far down from it. */
const BAG = { width: 0.46, height: 0.5, depth: 0.28, back: 0.16, down: 0.2 };
/** Riding: behind the seated player (on the tractor's back) and how high (times the mower's ride scale and the player's size). */
const RIDE = { back: 1.2, height: 0.74 };
/** Bales for a full bag (one per tenth), eggs per layer, and the most layers drawn. */
const MAX_BALES = 10;
const EGGS_PER_LAYER = 2;
const MAX_LAYERS = 16;
/** The bag's colour at each Bag level (the last one past the end), and the bright pulse it gives when full. */
const BAG_COLORS = [0xd8b98a, 0x4fc23a, 0x3a8cf0, 0xe8473a, 0x9a5cf0, 0xf2a33a, 0x2fc4b2, 0xf06bb4, 0xf2c94c, 0x3d3d46, 0xf4f1ea].map((c) => new THREE.Color(c));
const FLASH = new THREE.Color(0xffffff);
/** The bag's colour at Bag level `level`. */
export const bagColor = (level: number): THREE.Color => BAG_COLORS[Math.max(0, Math.min(level, BAG_COLORS.length - 1))];
/** The full bag's "!": on the bag itself (its middle's height, out on its back), its size (in the bag's units, x the player's size). */
const ALERT = { height: 0.55, out: 0.12, size: 0.26 };
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

/** The rucksack as the Bag station shows it: in Bag level `level`'s colour (the one the player will wear). */
export function rucksackPicture(level: number): THREE.Group {
    const color = bagColor(level);
    const body = new THREE.MeshStandardMaterial({ color, roughness: 0.85 });
    const trim = new THREE.MeshStandardMaterial({ color: color.clone().multiplyScalar(TRIM_SHADE), roughness: 0.85 });
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
    /** The "!" over a full bag. */
    private readonly alert: THREE.Sprite;

    /** A round red badge with a white "!" (drawn once), over everything. */
    private static alertSprite(): THREE.Sprite {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 128;
        const g = canvas.getContext('2d')!;
        g.fillStyle = '#ff4b3a';
        g.beginPath();
        g.arc(64, 64, 54, 0, Math.PI * 2);
        g.fill();
        g.lineWidth = 9;
        g.strokeStyle = '#ffffff';
        g.stroke();
        g.fillStyle = '#ffffff';
        g.font = 'bold 84px sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText('!', 64, 70);
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true }));
        sprite.renderOrder = 15;
        return sprite;
    }
    private readonly forward = new THREE.Vector3();

    public constructor(threeScene: THREE.Scene, private readonly player: MowPlayer) {
        this.body = new THREE.MeshStandardMaterial({ color: bagColor(0), roughness: 0.85 });
        this.trim = new THREE.MeshStandardMaterial({ color: bagColor(0).clone().multiplyScalar(TRIM_SHADE), roughness: 0.85 });
        this.buildBag();
        this.group.add(this.bag);
        this.stack.position.y = BAG.height + 0.06;
        this.group.add(this.stack);
        this.alert = Backpack.alertSprite();
        this.alert.visible = false;
        this.group.add(this.alert);
        threeScene.add(this.group);
    }

    /** The rucksack, its bottom at y 0, the side against the player's back on +Z. */
    private buildBag(): void {
        this.bag.add(buildRucksack(this.body, this.trim));
    }

    /** What's stacked on top now, bottom to top. */
    private layers(fill: number, eggs: number, trays: number, goldTrays = 0): Layer[] {
        const layers: Layer[] = [];
        const bales = fill <= 0 ? 0 : Math.max(1, Math.ceil(Math.min(1, fill) * MAX_BALES));
        for (let i = 0; i < bales; i++) layers.push({ kind: 'bale', count: 1 });
        for (let left = eggs; left > 0; left -= EGGS_PER_LAYER) layers.push({ kind: 'egg', count: Math.min(EGGS_PER_LAYER, left) });
        for (let i = 0; i < trays; i++) layers.push({ kind: 'tray', count: 1 });
        for (let i = 0; i < goldTrays; i++) layers.push({ kind: 'goldTray', count: 1 });
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
    public update(delta: number, fill: number, eggs: number, trays: number, scale: number, riding: boolean, rideScale: number, goldTrays = 0): void {
        this.time += delta;
        const layers = this.layers(fill, eggs, trays, goldTrays);
        const key = layers.map((l) => `${l.kind}${l.count}`).join(',');
        if (key !== this.key) {
            this.key = key;
            this.rebuild(layers);
            this.bounce = 1;
        }
        this.bounce = Math.max(0, this.bounce - delta * 4);
        const squash = 1 + Math.sin(this.bounce * Math.PI) * 0.1;
        this.stack.scale.set(squash, 1 / squash, squash);

        // Its level's colour, pulsing bright when it's full; it swells a little as it fills.
        this.shownFill += (Math.min(1, fill) - this.shownFill) * Math.min(1, delta * 6);
        this.color.copy(bagColor(MowProgress.upgradeLevel('capacity')));
        if (fill >= 1) this.color.lerp(FLASH, (Math.sin(this.time * 8) * 0.5 + 0.5) * 0.45);
        this.body.color.copy(this.color);
        this.trim.color.copy(this.color).multiplyScalar(TRIM_SHADE);
        // Full: a small "!" pulsing on the bag (its back, the side away from the player).
        this.alert.visible = fill >= 1;
        if (this.alert.visible) {
            this.alert.position.set(0, BAG.height * ALERT.height, -(BAG.depth / 2 + ALERT.out));
            this.alert.scale.setScalar(ALERT.size * (1 + Math.max(0, Math.sin(this.time * 6)) * 0.12));
        }
        const swell = 1 + this.shownFill * 0.12;
        this.bag.scale.set(swell, 1, 1 + this.shownFill * 0.25);

        const position = this.player.transform.position;
        const forward = this.player.heading(this.forward);
        this.group.scale.setScalar(scale);
        this.group.rotation.y = Math.atan2(forward.x, forward.z);
        if (riding) {
            // The tractor's bag point (MOW.tractor.bag, in its frame: the same spot on every tractor), else behind the seat.
            const s = rideScale * scale;
            const at = MOW.tractor.bag ?? { x: 0, y: RIDE.height, z: -RIDE.back };
            this.group.position.copy(position).addScaledVector(forward, at.z * s).setY(at.y * s);
            this.group.position.x += forward.z * at.x * s;
            this.group.position.z -= forward.x * at.x * s;
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
