// TileRack.ts
//
// Under the anthill: the SLOT_COUNT slots (white plates; addSlot() — the extra-slot power-up — adds one, and they all
// slide to stay centred), and under them the tiles in the level's columns (3 to 5), centred under the slots. A tile is two stacked rounded cushions — its colour on top, a darker one under it — with its number (how
// many ants) on top, big and white. Only the front row can be taken: those tiles stand tall on white plates. The rows
// behind squat lower (ROW_HEIGHT), from the third back lower still, and every tile that can't be taken has its number
// faded. Taking a front tile (take()) hops it in an arc onto a free slot's plate and its column moves up; in its slot its number counts down as its ants leave
// (setCount()), and it goes once they're all home (release()). The deck is dealt round-robin into the columns, so the
// front row is always the next tiles in the deck's order. Sizes and spacing follow the reference layout (Layout.ts).

import * as THREE from 'three';
import gsap from 'gsap';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { Tile } from '../data/Board';
import { LAYOUT } from './Layout';

export const SLOT_COUNT = 5;
/** A tile's footprint, its two cushions' heights, and the plate under the front row's / a slot's tile. */
const TILE = LAYOUT.tile;
const BOTTOM_HEIGHT = 1.05;
const TOP_HEIGHT = 0.95;
/** The plate: the tile's own rounded square a little bigger (its rim shows round the tile like a white stroke), with
 *  a soft lip under it. */
const PLATE = { size: LAYOUT.tile + 0.3, corner: 0.42 + 0.15, height: 0.28, lip: 0.06, color: 0xfffaf3, lipColor: 0xd9cdbf };
/** Rows shown per column; from FADE_FROM back, tiles sit FADE_DROP lower. Every tile that can't be taken (all but the
 *  front row) has its number at FADE_OPACITY. */
const VISIBLE_ROWS = 4;
const FADE_FROM = 2;
const FADE_DROP = 0.35;
const FADE_OPACITY = 0.45;
/** Taking a tile: it hops this high on its way to the slot, in this long. */
const HOP = { height: 2.2, seconds: 0.38 };
/** How tall a tile stands by row (1 = full): the front row (the ones that can be taken) stands tall — two cushions on
 *  a plate — the rest lie flat, just their top cushion's thickness; the second row a little sunk. */
const ROW_HEIGHT = [1.3, 0.32, 0.32];
const SECOND_ROW_DROP = 0.15;
const FONT = 'Arial Rounded MT Bold, Arial Black, Arial, sans-serif';

export interface RackTile {
    tile: Tile;
    group: THREE.Group;
    body: THREE.Mesh;
    label: THREE.Mesh;
    plate: THREE.Group;
    canvas: HTMLCanvasElement;
    texture: THREE.CanvasTexture;
    column: number;
}

/** A white plate with a grey lip (a slot, or what a front-row tile stands on), from y = 0 up to PLATE.height. */
function plate(geometry: THREE.BufferGeometry, lip: THREE.BufferGeometry, white: THREE.Material, grey: THREE.Material): THREE.Group {
    const group = new THREE.Group();
    // The lip a little lower, so it shows as a soft rim under the white.
    const under = new THREE.Mesh(lip, grey);
    under.position.y = -PLATE.lip;
    const top = new THREE.Mesh(geometry, white);
    group.add(under, top);
    return group;
}

/** A flat rounded square, `size` across with `corner` rounding (as seen from above), `height` thick, lying on y = 0. */
function slab(size: number, corner: number, height: number): THREE.BufferGeometry {
    const h = size / 2;
    const shape = new THREE.Shape()
        .moveTo(-h + corner, -h).lineTo(h - corner, -h).quadraticCurveTo(h, -h, h, -h + corner)
        .lineTo(h, h - corner).quadraticCurveTo(h, h, h - corner, h)
        .lineTo(-h + corner, h).quadraticCurveTo(-h, h, -h, h - corner)
        .lineTo(-h, -h + corner).quadraticCurveTo(-h, -h, -h + corner, -h);
    const bevel = Math.min(0.06, height / 3);
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: height - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 8 });
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(0, bevel, 0);
    return geometry;
}

export class TileRack {
    public readonly group = new THREE.Group();
    private readonly columns: RackTile[][];
    /** The slots' plates, and which tile sits in which slot. */
    private readonly slotPlates: THREE.Group[] = [];
    private readonly slotted = new Map<RackTile, number>();
    private readonly bottomGeometry = new RoundedBoxGeometry(TILE, BOTTOM_HEIGHT, TILE, 3, 0.42);
    private readonly topGeometry = new RoundedBoxGeometry(TILE * 0.98, TOP_HEIGHT, TILE * 0.9, 3, 0.4);
    private readonly plateGeometry = slab(PLATE.size, PLATE.corner, PLATE.height);
    private readonly lipGeometry = slab(PLATE.size + PLATE.lip * 2, PLATE.corner + PLATE.lip, PLATE.height);
    private readonly labelGeometry = new THREE.PlaneGeometry(TILE * 0.98, TILE * 0.78);
    // Warm off-white plates (not pure white: easy on the eyes).
    // Nearly white (not pure white: easy on the eyes), its lip a soft warm grey.
    private readonly white = new THREE.MeshStandardMaterial({ color: PLATE.color, roughness: 0.45 });
    private readonly grey = new THREE.MeshStandardMaterial({ color: PLATE.lipColor, roughness: 0.7 });

    public constructor(private readonly palette: string[], deck: Tile[], private readonly columnCount: number) {
        this.columns = Array.from({ length: columnCount }, () => []);
        for (let s = 0; s < SLOT_COUNT; s++) this.addPlate();
        this.slotPlates.forEach((p, s) => p.position.copy(this.slotPosition(s)));
        deck.forEach((tile, i) => this.columns[i % columnCount].push(this.build(tile, i % columnCount)));
        this.layout(false);
    }

    public get slotCount(): number {
        return this.slotPlates.length;
    }

    /** A slot's centre on the floor (the slots centred under the anthill). */
    public slotPosition(slot: number, out = new THREE.Vector3()): THREE.Vector3 {
        return out.set((slot - (this.slotCount - 1) / 2) * LAYOUT.slotGap, 0, LAYOUT.slotsZ);
    }

    /** The extra slot: a new plate pops in at the end and every slot (and the tile on it) slides over to stay centred. */
    public addSlot(): number {
        const plateGroup = this.addPlate();
        plateGroup.position.copy(this.slotPosition(this.slotCount - 1));
        gsap.fromTo(plateGroup.scale, { x: 0.01, y: 0.01, z: 0.01 }, { x: 1, y: 1, z: 1, duration: 0.4, ease: 'back.out(2.5)' });
        this.slotPlates.forEach((p, s) => gsap.to(p.position, { x: this.slotPosition(s).x, duration: 0.3, ease: 'power2.out' }));
        this.slotted.forEach((s, tile) => gsap.to(tile.group.position, { x: this.slotPosition(s).x, duration: 0.3, ease: 'power2.out' }));
        return this.slotCount - 1;
    }

    private addPlate(): THREE.Group {
        const slot = plate(this.plateGeometry, this.lipGeometry, this.white, this.grey);
        slot.position.copy(this.slotPosition(this.slotPlates.length));
        this.slotPlates.push(slot);
        this.group.add(slot);
        return slot;
    }

    /** The front tiles' bodies (what a tap can hit), each with its column. */
    public frontBodies(): { body: THREE.Mesh; column: number }[] {
        return this.columns.flatMap((column, c) => (column.length ? [{ body: column[0].body, column: c }] : []));
    }

    /** Takes a column's front tile and slides it onto `slot`'s plate; the column moves up. */
    public take(column: number, slot: number): RackTile | undefined {
        const tile = this.columns[column].shift();
        if (!tile) return undefined;
        tile.plate.visible = false;
        this.slotted.set(tile, slot);
        const to = this.slotPosition(slot);
        // A little hop onto the slot: across and along steadily, up and back down.
        const from = tile.group.position.y;
        gsap.to(tile.group.position, { x: to.x, z: to.z, duration: HOP.seconds, ease: 'power1.inOut' });
        gsap.timeline()
            .to(tile.group.position, { y: Math.max(from, PLATE.height) + HOP.height, duration: HOP.seconds / 2, ease: 'power2.out' })
            .to(tile.group.position, { y: PLATE.height, duration: HOP.seconds / 2, ease: 'power2.in' });
        const tall = ROW_HEIGHT[0];
        gsap.fromTo(tile.group.scale, { x: 1.12, y: tall * 1.12, z: 1.12 }, { x: 1, y: tall, z: 1, duration: 0.35, ease: 'back.out(2)' });
        this.layout(true);
        return tile;
    }

    /** A slot's tile shows its ants still to leave. */
    public setCount(tile: RackTile, count: number): void {
        this.drawLabel(tile, count);
    }

    /** A slot's tile is done: it shrinks away. */
    public release(tile: RackTile): void {
        this.slotted.delete(tile);
        gsap.to(tile.group.scale, {
            x: 0.01, y: 0.01, z: 0.01, duration: 0.25, ease: 'back.in(2)',
            onComplete: () => this.dispose(tile),
        });
    }

    /** A tile no one can take (no free slot): it shakes. */
    public shake(column: number): void {
        const tile = this.columns[column][0];
        if (!tile) return;
        const x = tile.group.position.x;
        gsap.fromTo(tile.group.position, { x: x - 0.3 }, { x, duration: 0.3, ease: 'elastic.out(3, 0.3)' });
    }

    /** Puts every column's tiles in their rows: the front one on its plate, the far rows lower and faded. */
    private layout(animate: boolean): void {
        this.columns.forEach((column, c) => column.forEach((tile, row) => {
            const x = (c - (this.columnCount - 1) / 2) * LAYOUT.columnGap;
            const z = LAYOUT.gridZ + row * LAYOUT.rowGap;
            const faded = row >= FADE_FROM;
            const y = row === 0 ? PLATE.height : faded ? -FADE_DROP : -SECOND_ROW_DROP;
            const tall = ROW_HEIGHT[Math.min(row, ROW_HEIGHT.length - 1)];
            tile.plate.visible = row === 0;
            (tile.label.material as THREE.MeshBasicMaterial).opacity = row === 0 ? 1 : FADE_OPACITY;
            tile.group.visible = row < VISIBLE_ROWS;
            if (animate) {
                gsap.to(tile.group.position, { x, y, z, duration: 0.25, ease: 'power2.out' });
                // Stepping up to the front, it grows to full height with a little bounce.
                gsap.to(tile.group.scale, { y: tall, duration: 0.35, ease: row === 0 ? 'back.out(2.5)' : 'power2.out' });
            } else {
                tile.group.position.set(x, y, z);
                tile.group.scale.y = tall;
            }
        }));
    }

    private build(tile: Tile, column: number): RackTile {
        const group = new THREE.Group();
        const color = new THREE.Color(this.palette[tile.color]);
        // The plate stays under the tile's spot in the front row (it moves with the group, so it's built in the group,
        // under the cushions).
        const plateGroup = plate(this.plateGeometry, this.lipGeometry, this.white, this.grey);
        plateGroup.position.y = -PLATE.height;
        const body = new THREE.Mesh(this.bottomGeometry, new THREE.MeshStandardMaterial({ color: color.clone().multiplyScalar(0.8), roughness: 0.6 }));
        body.position.y = BOTTOM_HEIGHT / 2;
        const top = new THREE.Mesh(this.topGeometry, new THREE.MeshPhysicalMaterial({ color, roughness: 0.45, clearcoat: 0.4, clearcoatRoughness: 0.3 }));
        top.position.y = BOTTOM_HEIGHT + TOP_HEIGHT / 2 - 0.14;
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 200;
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        const label = new THREE.Mesh(this.labelGeometry, new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }));
        label.rotation.x = -Math.PI / 2;
        label.position.y = BOTTOM_HEIGHT + TOP_HEIGHT - 0.12;
        group.add(plateGroup, body, top, label);
        this.group.add(group);
        const rackTile: RackTile = { tile, group, body, label, plate: plateGroup, canvas, texture, column };
        this.drawLabel(rackTile, tile.count);
        return rackTile;
    }

    /** The number on a tile: big and white, outlined in a dark shade of the tile's own colour. */
    private drawLabel(tile: RackTile, count: number): void {
        const g = tile.canvas.getContext('2d')!;
        g.clearRect(0, 0, tile.canvas.width, tile.canvas.height);
        g.font = `900 138px ${FONT}`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.lineJoin = 'round';
        g.lineWidth = 24;
        g.strokeStyle = `#${new THREE.Color(this.palette[tile.tile.color]).multiplyScalar(0.3).getHexString()}`;
        g.strokeText(String(count), 128, 106);
        g.fillStyle = '#ffffff';
        g.fillText(String(count), 128, 106);
        tile.texture.needsUpdate = true;
    }

    private dispose(tile: RackTile): void {
        tile.group.removeFromParent();
        tile.texture.dispose();
        (tile.label.material as THREE.Material).dispose();
        (tile.body.material as THREE.Material).dispose();
    }

    public destroy(): void {
        this.group.traverse((child) => gsap.killTweensOf([child.position, child.scale]));
        this.group.removeFromParent();
        this.group.traverse((child) => {
            if (!(child instanceof THREE.Mesh) || child.material === this.white || child.material === this.grey) return;
            const material = child.material as THREE.MeshBasicMaterial;
            material.map?.dispose();
            material.dispose();
        });
        for (const geometry of [this.bottomGeometry, this.topGeometry, this.plateGeometry, this.lipGeometry, this.labelGeometry]) geometry.dispose();
        this.white.dispose();
        this.grey.dispose();
    }
}
