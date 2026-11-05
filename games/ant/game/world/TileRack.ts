// TileRack.ts
//
// Under the anthill: the SLOT_COUNT slots (white plates), and under them the tiles in COLUMNS columns, centred under
// the slots. A tile is two stacked rounded cushions — its colour on top, a darker one under it — with its number (how
// many ants) on top, big and white. Only the front row can be taken: those tiles stand on white plates. The second row
// looks the same, waiting its turn; rows further back sit lower, their numbers faded. Taking a front tile (take())
// slides it onto a free slot's plate and its column moves up; in its slot its number counts down as its ants leave
// (setCount()), and it goes once they're all home (release()). The deck is dealt round-robin into the columns, so the
// front row is always the next four tiles in dealt order. Sizes and spacing follow the reference layout (Layout.ts).

import * as THREE from 'three';
import gsap from 'gsap';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { Tile } from '../data/Board';
import { LAYOUT } from './Layout';

export const COLUMNS = 4;
export const SLOT_COUNT = 5;
/** A tile's footprint, its two cushions' heights, and the plate under the front row's / a slot's tile. */
const TILE = LAYOUT.tile;
const BOTTOM_HEIGHT = 0.62;
const TOP_HEIGHT = 0.62;
const PLATE = { size: LAYOUT.tile + 0.45, height: 0.28 };
/** Rows shown per column; from FADE_FROM back, tiles sit FADE_DROP lower with their numbers FADE_OPACITY. */
const VISIBLE_ROWS = 4;
const FADE_FROM = 2;
const FADE_DROP = 0.35;
const FADE_OPACITY = 0.55;
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

/** A white plate with a grey lip (a slot, or what a front-row tile stands on). */
function plate(geometry: THREE.BufferGeometry, lip: THREE.BufferGeometry, white: THREE.Material, grey: THREE.Material): THREE.Group {
    const group = new THREE.Group();
    const under = new THREE.Mesh(lip, grey);
    under.position.y = PLATE.height / 2 - 0.06;
    const top = new THREE.Mesh(geometry, white);
    top.position.y = PLATE.height / 2;
    group.add(under, top);
    return group;
}

export class TileRack {
    public readonly group = new THREE.Group();
    private readonly columns: RackTile[][] = Array.from({ length: COLUMNS }, () => []);
    private readonly bottomGeometry = new RoundedBoxGeometry(TILE, BOTTOM_HEIGHT, TILE, 3, 0.42);
    private readonly topGeometry = new RoundedBoxGeometry(TILE * 0.98, TOP_HEIGHT, TILE * 0.9, 3, 0.4);
    private readonly plateGeometry = new RoundedBoxGeometry(PLATE.size, PLATE.height, PLATE.size, 3, 0.4);
    private readonly lipGeometry = new RoundedBoxGeometry(PLATE.size + 0.08, PLATE.height, PLATE.size + 0.12, 3, 0.42);
    private readonly labelGeometry = new THREE.PlaneGeometry(TILE * 0.98, TILE * 0.78);
    private readonly white = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 });
    private readonly grey = new THREE.MeshStandardMaterial({ color: 0xc9c2bb, roughness: 0.7 });

    public constructor(private readonly palette: string[], deck: Tile[]) {
        for (let s = 0; s < SLOT_COUNT; s++) {
            const slot = plate(this.plateGeometry, this.lipGeometry, this.white, this.grey);
            slot.position.copy(this.slotPosition(s));
            this.group.add(slot);
        }
        deck.forEach((tile, i) => this.columns[i % COLUMNS].push(this.build(tile, i % COLUMNS)));
        this.layout(false);
    }

    /** A slot's centre on the floor. */
    public slotPosition(slot: number, out = new THREE.Vector3()): THREE.Vector3 {
        return out.set((slot - (SLOT_COUNT - 1) / 2) * LAYOUT.slotGap, 0, LAYOUT.slotsZ);
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
        const to = this.slotPosition(slot);
        gsap.to(tile.group.position, { x: to.x, y: PLATE.height, z: to.z, duration: 0.3, ease: 'power2.out' });
        gsap.fromTo(tile.group.scale, { x: 1.12, y: 1.12, z: 1.12 }, { x: 1, y: 1, z: 1, duration: 0.35, ease: 'back.out(2)' });
        this.layout(true);
        return tile;
    }

    /** A slot's tile shows its ants still to leave. */
    public setCount(tile: RackTile, count: number): void {
        this.drawLabel(tile, count);
    }

    /** A slot's tile is done: it shrinks away. */
    public release(tile: RackTile): void {
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
            const x = (c - (COLUMNS - 1) / 2) * LAYOUT.columnGap;
            const z = LAYOUT.gridZ + row * LAYOUT.rowGap;
            const faded = row >= FADE_FROM;
            const y = row === 0 ? PLATE.height : faded ? -FADE_DROP : 0;
            tile.plate.visible = row === 0;
            (tile.label.material as THREE.MeshBasicMaterial).opacity = faded ? FADE_OPACITY : 1;
            tile.group.visible = row < VISIBLE_ROWS;
            if (animate) gsap.to(tile.group.position, { x, y, z, duration: 0.25, ease: 'power2.out' });
            else tile.group.position.set(x, y, z);
        }));
    }

    private build(tile: Tile, column: number): RackTile {
        const group = new THREE.Group();
        const color = new THREE.Color(this.palette[tile.color]);
        // The plate stays under the tile's spot in the front row (it moves with the group, so it's built in the group,
        // under the cushions).
        const plateGroup = plate(this.plateGeometry, this.lipGeometry, this.white, this.grey);
        plateGroup.position.y = -PLATE.height;
        const body = new THREE.Mesh(this.bottomGeometry, new THREE.MeshStandardMaterial({ color: color.clone().multiplyScalar(0.7), roughness: 0.6 }));
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
