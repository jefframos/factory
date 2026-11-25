// Backpack.ts
//
// The miner's backpack (Mow's rucksack): on their back, on foot and on the tractor, following the chest; its colour is the
// bag's level (BAG_COLORS; the Bag pad shows the next). What's dug is piled on top of it, block by block: cheap rock at the
// bottom, the ores and gems on top, the pile as high as the bag is full. It swells a touch as it fills, and pulses bright with a
// "! FULL" badge when it is. Things flying in and out aim at the pile's top (top()).

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { BendService } from '../services/BendService';
import type DigPlayer from './DigPlayer';
import type { VoxelTerrain } from '../world/VoxelTerrain';
import { DigProgress } from '../data/DigProgress';
import { DIG } from '../data/DigConfig';
import { CanvasArt } from '../ui/CanvasArt';

/** The bag: width, height, depth; how far behind the chest; how far down from it; and its size on the miner. */
const BAG = { width: 0.46, height: 0.5, depth: 0.28, back: 0.16, down: 0.2 };
const SIZE = 1.25;
/** The pile: layers of a full bag, blocks a layer, a block's size and the gap between two, how far in the bag's top it starts. */
const PILE = { layers: 12, across: 2, block: 0.23, gap: 0.015, ore: 0.8, sink: 0.04 };
/** The pile's made again at most this often (seconds). */
const REBUILD_SEC = 0.12;
/** The bag's colour at each Bag level (round again past the end), and the bright pulse it gives when full. */
const BAG_COLORS = [0xd8b98a, 0x4fc23a, 0x3a8cf0, 0xe8473a, 0x9a5cf0, 0xf2a33a, 0x2fc4b2, 0xf06bb4, 0xf2c94c, 0x3d3d46, 0xf4f1ea].map((c) => new THREE.Color(c));
const FLASH = new THREE.Color(0xffffff);
export const bagColor = (level: number): THREE.Color => BAG_COLORS[Math.max(0, level) % BAG_COLORS.length];
/** The full bag's badge: on the bag (its middle's height, out on its back), its height and its width over its height. */
const ALERT = { height: 0.55, out: 0.12, size: 0.3, aspect: 256 / 112 };
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

export class Backpack {
    private readonly group = new THREE.Group();
    private readonly bag = new THREE.Group();
    private readonly pile = new THREE.Group();
    private readonly body: THREE.MeshStandardMaterial;
    private readonly trim: THREE.MeshStandardMaterial;
    private readonly color = new THREE.Color();
    private key = '';
    private bounce = 0;
    private shownFill = 0;
    private time = 0;
    private rebuildIn = 0;
    private topY = BAG.height;
    private readonly chest = new THREE.Vector3();
    private readonly forward = new THREE.Vector3();
    /** The "! FULL" badge on a full bag. */
    private readonly alert: THREE.Sprite;

    /**
     * A red pill with a white edge: a white disc with a red "!", then FULL in the kit's font, over everything. Drawn
     * again a moment later (the font may not have loaded yet the first time).
     */
    private static alertSprite(): THREE.Sprite {
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 112;
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        const draw = () => {
            const g = canvas.getContext('2d')!;
            g.clearRect(0, 0, canvas.width, canvas.height);
            g.beginPath();
            g.roundRect(6, 6, 244, 100, 50);
            g.fillStyle = '#ff4b3a';
            g.fill();
            g.lineWidth = 9;
            g.strokeStyle = '#ffffff';
            g.stroke();
            g.beginPath();
            g.arc(56, 56, 34, 0, Math.PI * 2);
            g.fillStyle = '#ffffff';
            g.fill();
            g.fillStyle = '#ff4b3a';
            g.font = 'bold 56px sans-serif';
            g.textAlign = 'center';
            g.textBaseline = 'middle';
            g.fillText('!', 56, 60);
            CanvasArt.text(g, 'FULL', 162, 58, 54, '#ffffff', 150, '#9e1f14');
            texture.needsUpdate = true;
        };
        draw();
        window.setTimeout(draw, 1500);
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true }));
        sprite.renderOrder = 15;
        return sprite;
    }

    public constructor(threeScene: THREE.Scene, private readonly player: DigPlayer, private readonly terrain: VoxelTerrain) {
        this.body = new THREE.MeshStandardMaterial({ color: bagColor(0), roughness: 0.85 });
        this.trim = new THREE.MeshStandardMaterial({ color: bagColor(0).clone().multiplyScalar(TRIM_SHADE), roughness: 0.85 });
        this.bag.add(buildRucksack(this.body, this.trim));
        this.bag.traverse((child) => (child.frustumCulled = false));
        this.group.add(this.bag);
        this.pile.position.y = BAG.height - PILE.sink;
        this.group.add(this.pile);
        this.alert = Backpack.alertSprite();
        this.alert.visible = false;
        this.group.add(this.alert);
        this.group.scale.setScalar(SIZE);
        threeScene.add(this.group);
    }

    /** What's piled, bottom to top: the bag's blocks, cheapest first, as many of each as there's of it in the bag. */
    private piled(): string[] {
        const held = DIG.materials.filter((material) => (DigProgress.backpack[material.id] ?? 0) > 0).sort((a, b) => a.value - b.value);
        const total = DigProgress.backpackCount;
        if (total <= 0) return [];
        const blocks = Math.max(1, Math.min(total, Math.ceil(Math.min(1, total / DigProgress.capacity) * PILE.layers * PILE.across)));
        const list: string[] = [];
        for (let k = 0; k < blocks; k++) {
            let left = ((k + 0.5) / blocks) * total;
            const material = held.find(({ id }) => (left -= DigProgress.backpack[id]) <= 0) ?? held[held.length - 1];
            list.push(material.id);
        }
        return list;
    }

    private rebuild(list: string[]): void {
        this.pile.clear();
        const step = PILE.block + PILE.gap;
        list.forEach((id, i) => {
            const layer = Math.floor(i / PILE.across);
            const block = this.terrain.blockPiece(DIG.materials.find((material) => material.id === id)!, PILE.block);
            if (!block) return;
            // A little stagger, so it looks piled by hand.
            block.position.set(((i % PILE.across) - (PILE.across - 1) / 2) * step + Math.sin(i * 2.3) * 0.018, layer * step, Math.cos(i * 1.7) * 0.025);
            block.rotation.y = Math.sin(i * 1.3) * 0.16;
            block.traverse((child) => (child.frustumCulled = false));
            this.pile.add(block);
        });
        this.topY = BAG.height + Math.ceil(list.length / PILE.across) * step;
    }

    /** Each frame, once the character's placed itself (and the tractor's put it in its seat): on their back, facing their way. */
    public update(delta: number): void {
        this.time += delta;
        this.rebuildIn -= delta;
        if (this.rebuildIn <= 0) {
            const list = this.piled();
            const key = `${list.join()}|${this.terrain.piecesReady}`;
            if (key !== this.key) {
                // (Growing: it bounces as they land.)
                if (key.length > this.key.length) this.bounce = 1;
                this.key = key;
                this.rebuildIn = REBUILD_SEC;
                this.rebuild(list);
            }
        }
        this.bounce = Math.max(0, this.bounce - delta * 4);
        const squash = 1 + Math.sin(this.bounce * Math.PI) * 0.07;
        this.pile.scale.set(squash, 1 / squash, squash);

        const fill = DigProgress.backpackCount / Math.max(1, DigProgress.capacity);
        this.shownFill += (Math.min(1, fill) - this.shownFill) * Math.min(1, delta * 6);
        this.color.copy(bagColor(DigProgress.backpackLevel));
        if (fill >= 1) this.color.lerp(FLASH, (Math.sin(this.time * 8) * 0.5 + 0.5) * 0.45);
        this.body.color.copy(this.color);
        this.trim.color.copy(this.color).multiplyScalar(TRIM_SHADE);
        this.bag.scale.set(1 + this.shownFill * 0.12, 1, 1 + this.shownFill * 0.25);

        const container = this.player.character?.container;
        this.group.visible = !!container;
        if (!container) return;
        this.forward.set(0, 0, 1).applyQuaternion(container.quaternion).setY(0).normalize();
        this.group.rotation.y = Math.atan2(this.forward.x, this.forward.z);
        const chest = this.player.chestPoint(this.chest);
        if (chest) {
            this.group.position.copy(chest).addScaledVector(this.forward, -(BAG.back + BAG.depth / 2) * SIZE);
            this.group.position.y -= (BAG.down + BAG.height / 2) * SIZE;
        } else {
            this.group.position.copy(container.position).addScaledVector(this.forward, -0.35 * SIZE);
            this.group.position.y += 0.6 * SIZE;
        }
        this.alert.visible = fill >= 1;
        if (!this.alert.visible) return;
        // (A sprite isn't bent: lifted to the ground here.)
        const lift = BendService.ground(this.group.position.x, this.group.position.z) / SIZE;
        this.alert.position.set(0, BAG.height * ALERT.height + lift, -(BAG.depth / 2 + ALERT.out));
        const pulse = ALERT.size * (1 + Math.max(0, Math.sin(this.time * 6)) * 0.12);
        this.alert.scale.set(pulse * ALERT.aspect, pulse, 1);
    }

    /** The pile's top, in the world (things fly in and out here). */
    public top(out = new THREE.Vector3()): THREE.Vector3 {
        if (!this.group.visible) return this.player.pickupPoint(out);
        return out.set(0, this.topY, 0).multiplyScalar(SIZE).add(this.group.position);
    }

    public destroy(): void {
        this.group.removeFromParent();
    }
}
