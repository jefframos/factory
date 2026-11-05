// PictureView.ts
//
// The picture on the board: one rounded block per pixel (a single InstancedMesh, each block in its palette colour) on
// a raised tray, its top-left corner at the origin, `cell` world units per pixel. A pixel taken by an ant is hidden
// (hide()); where it stood (cellCenter()) is where the ant walks to.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { LevelData } from '../data/Levels';

/** A block's footprint (share of the cell) and height (share of the cell). */
const BLOCK = 0.9;
const BLOCK_HEIGHT = 0.55;
/** The tray's rim around the picture (world units) and its colours. */
const RIM = 0.9;
const TRAY = 0xfbe9d7;
const TRAY_EDGE = 0xd9b79a;

export class PictureView {
    public readonly group = new THREE.Group();
    private readonly blocks: THREE.InstancedMesh;
    private readonly matrix = new THREE.Matrix4();
    public readonly width: number;
    public readonly depth: number;

    public constructor(private readonly level: LevelData, pixels: Int8Array, public readonly cell: number) {
        this.width = level.width * cell;
        this.depth = level.height * cell;
        const tray = new THREE.Mesh(
            new RoundedBoxGeometry(this.width + RIM * 2, 0.5, this.depth + RIM * 2, 4, 0.45),
            new THREE.MeshStandardMaterial({ color: TRAY, roughness: 0.9 }),
        );
        tray.position.set(this.width / 2, -0.25, this.depth / 2);
        const edge = new THREE.Mesh(
            new RoundedBoxGeometry(this.width + RIM * 2 + 0.3, 0.4, this.depth + RIM * 2 + 0.3, 4, 0.5),
            new THREE.MeshStandardMaterial({ color: TRAY_EDGE, roughness: 0.9 }),
        );
        edge.position.set(this.width / 2, -0.35, this.depth / 2);
        this.group.add(edge, tray);

        const geometry = new RoundedBoxGeometry(cell * BLOCK, cell * BLOCK_HEIGHT, cell * BLOCK, 2, cell * 0.12);
        this.blocks = new THREE.InstancedMesh(geometry, new THREE.MeshStandardMaterial({ roughness: 0.55 }), pixels.length);
        const color = new THREE.Color();
        for (let i = 0; i < pixels.length; i++) {
            const at = this.cellCenter(i);
            this.matrix.makeTranslation(at.x, cell * BLOCK_HEIGHT / 2, at.z);
            this.blocks.setMatrixAt(i, this.matrix);
            this.blocks.setColorAt(i, color.set(level.palette[pixels[i]] ?? '#ffffff'));
        }
        this.blocks.instanceMatrix.needsUpdate = true;
        if (this.blocks.instanceColor) this.blocks.instanceColor.needsUpdate = true;
        this.group.add(this.blocks);
    }

    /** Where a pixel's block stands (on the floor, its centre). */
    public cellCenter(i: number, out = new THREE.Vector3()): THREE.Vector3 {
        const x = i % this.level.width;
        const y = Math.floor(i / this.level.width);
        return out.set((x + 0.5) * this.cell, 0, (y + 0.5) * this.cell).add(this.group.position);
    }

    /** The pixel under a world point, or -1 (off the picture). */
    public cellAt(x: number, z: number): number {
        const ix = Math.floor((x - this.group.position.x) / this.cell);
        const iz = Math.floor((z - this.group.position.z) / this.cell);
        if (ix < 0 || iz < 0 || ix >= this.level.width || iz >= this.level.height) return -1;
        return ix + iz * this.level.width;
    }

    /** The height of a block's top (where ants walk over the picture). */
    public get blockTop(): number {
        return this.cell * BLOCK_HEIGHT;
    }

    /** A taken pixel's block goes. */
    public hide(i: number): void {
        this.matrix.makeScale(0, 0, 0);
        this.blocks.setMatrixAt(i, this.matrix);
        this.blocks.instanceMatrix.needsUpdate = true;
    }

    public destroy(): void {
        this.group.removeFromParent();
        this.group.traverse((child) => {
            if (!(child instanceof THREE.Mesh)) return;
            child.geometry.dispose();
            (child.material as THREE.Material).dispose();
        });
    }
}
