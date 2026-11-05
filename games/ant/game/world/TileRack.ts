// TileRack.ts
//
// Under the picture: the SLOT_COUNT slots, and under them the tiles in COLUMNS columns — each a block in its colour
// with its number (how many ants) on top. Only each column's front tile can be taken: it wears a white outline. Taking
// it (take()) slides it into a slot and the rest of its column moves up; in its slot its number counts down as its
// ants leave (setCount()), and it goes once they're all home (release()). The deck is dealt round-robin into the
// columns, so the front row is always the next few tiles in dealt order.

import * as THREE from 'three';
import gsap from 'gsap';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { Tile } from '../data/Board';

export const COLUMNS = 4;
export const SLOT_COUNT = 5;
/** Tile and slot sizes, and spacing (world units). */
const TILE = { width: 4.3, height: 1.1, depth: 3.7 };
const COLUMN_GAP = 5.4;
const ROW_GAP = 4.4;
const SLOT_GAP = 4.9;
const SLOT = { width: 4.3, depth: 3.7 };
/** Tiles drawn per column (the rest wait unseen). */
const VISIBLE_ROWS = 4;
const FONT = 'Arial Rounded MT Bold, Arial Black, Arial, sans-serif';

export interface RackTile {
    tile: Tile;
    group: THREE.Group;
    body: THREE.Mesh;
    outline: THREE.Mesh;
    canvas: HTMLCanvasElement;
    texture: THREE.CanvasTexture;
    column: number;
}

export class TileRack {
    public readonly group = new THREE.Group();
    private readonly columns: RackTile[][] = Array.from({ length: COLUMNS }, () => []);
    private readonly geometry = new RoundedBoxGeometry(TILE.width, TILE.height, TILE.depth, 3, 0.45);
    private readonly outlineGeometry = new RoundedBoxGeometry(TILE.width + 0.45, TILE.height * 0.6, TILE.depth + 0.45, 3, 0.55);
    private readonly labelGeometry = new THREE.PlaneGeometry(TILE.width * 0.92, TILE.depth * 0.8);

    /** `slotsZ` / `gridZ`: where the slots' row and the tiles' first row sit. */
    public constructor(private readonly palette: string[], deck: Tile[], private readonly slotsZ: number, private readonly gridZ: number) {
        const slotGeometry = new RoundedBoxGeometry(SLOT.width, 0.35, SLOT.depth, 3, 0.4);
        const slotMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 });
        for (let s = 0; s < SLOT_COUNT; s++) {
            const slot = new THREE.Mesh(slotGeometry, slotMaterial);
            slot.position.copy(this.slotPosition(s)).setY(0.175);
            this.group.add(slot);
        }
        deck.forEach((tile, i) => this.columns[i % COLUMNS].push(this.build(tile, i % COLUMNS)));
        this.layout(false);
    }

    /** A slot's centre on the floor. */
    public slotPosition(slot: number, out = new THREE.Vector3()): THREE.Vector3 {
        return out.set((slot - (SLOT_COUNT - 1) / 2) * SLOT_GAP, 0, this.slotsZ);
    }

    /** Where the tiles' area ends (the camera frames down to here). */
    public get bottom(): number {
        return this.gridZ + (VISIBLE_ROWS - 1) * ROW_GAP + TILE.depth / 2;
    }

    public get width(): number {
        return Math.max(SLOT_COUNT * SLOT_GAP, COLUMNS * COLUMN_GAP);
    }

    /** Tiles still in the columns. */
    public get remaining(): number {
        return this.columns.reduce((sum, column) => sum + column.length, 0);
    }

    /** The front tiles' bodies (what a tap can hit), each with its column. */
    public frontBodies(): { body: THREE.Mesh; column: number }[] {
        return this.columns.flatMap((column, c) => (column.length ? [{ body: column[0].body, column: c }] : []));
    }

    /** Takes a column's front tile and slides it into `slot`; the column moves up. */
    public take(column: number, slot: number): RackTile | undefined {
        const tile = this.columns[column].shift();
        if (!tile) return undefined;
        tile.outline.visible = false;
        const to = this.slotPosition(slot);
        gsap.to(tile.group.position, { x: to.x, y: 0.35, z: to.z, duration: 0.3, ease: 'power2.out' });
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

    /** Puts every column's tiles in their rows: the front one outlined, VISIBLE_ROWS shown. */
    private layout(animate: boolean): void {
        this.columns.forEach((column, c) => column.forEach((tile, row) => {
            const x = (c - (COLUMNS - 1) / 2) * COLUMN_GAP;
            const z = this.gridZ + row * ROW_GAP;
            tile.outline.visible = row === 0;
            tile.group.visible = row < VISIBLE_ROWS;
            if (animate) gsap.to(tile.group.position, { x, z, duration: 0.25, ease: 'power2.out' });
            else tile.group.position.set(x, 0, z);
        }));
    }

    private build(tile: Tile, column: number): RackTile {
        const group = new THREE.Group();
        const color = new THREE.Color(this.palette[tile.color]);
        const body = new THREE.Mesh(this.geometry, new THREE.MeshStandardMaterial({ color, roughness: 0.5 }));
        body.position.y = TILE.height / 2;
        const outline = new THREE.Mesh(this.outlineGeometry, new THREE.MeshBasicMaterial({ color: 0xffffff }));
        outline.position.y = TILE.height * 0.3;
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 200;
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        const label = new THREE.Mesh(this.labelGeometry, new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }));
        label.rotation.x = -Math.PI / 2;
        label.position.y = TILE.height + 0.02;
        group.add(outline, body, label);
        this.group.add(group);
        const rackTile: RackTile = { tile, group, body, outline, canvas, texture, column };
        this.drawLabel(rackTile, tile.count);
        return rackTile;
    }

    /** The number on a tile: white with a dark outline in the tile's own colour. */
    private drawLabel(tile: RackTile, count: number): void {
        const g = tile.canvas.getContext('2d')!;
        g.clearRect(0, 0, tile.canvas.width, tile.canvas.height);
        g.font = `900 132px ${FONT}`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.lineJoin = 'round';
        g.lineWidth = 22;
        g.strokeStyle = `#${new THREE.Color(this.palette[tile.tile.color]).multiplyScalar(0.45).getHexString()}`;
        g.strokeText(String(count), 128, 108);
        g.fillStyle = '#ffffff';
        g.fillText(String(count), 128, 108);
        tile.texture.needsUpdate = true;
    }

    private dispose(tile: RackTile): void {
        tile.group.removeFromParent();
        tile.texture.dispose();
        tile.group.traverse((child) => {
            if (child instanceof THREE.Mesh) (child.material as THREE.Material).dispose();
        });
    }

    public destroy(): void {
        gsap.killTweensOf(this.group.children.flatMap((child) => [child.position, child.scale]));
        this.group.removeFromParent();
        this.group.traverse((child) => {
            if (!(child instanceof THREE.Mesh)) return;
            (child.material as THREE.Material).dispose();
            if (child.material instanceof THREE.MeshBasicMaterial) child.material.map?.dispose();
        });
        for (const geometry of [this.geometry, this.outlineGeometry, this.labelGeometry]) geometry.dispose();
    }
}
