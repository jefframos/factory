// PictureView.ts
//
// The picture on the board: one jelly cube per pixel (a single InstancedMesh of glossy, well-rounded blocks, each in its
// palette colour; the scene's environment map gives them their shine) on a raised tray — a wooden border round a cream
// board, with a cream rim round the picture where the ants walk — the picture's top-left corner at the origin, `cell`
// world units per pixel, its blocks standing on the board (TRAY_TOP). A pixel an ant pulls out squashes and stretches before it goes, and its
// neighbours wobble (pop(), update()); where it stood (cellCenter()) is where the ant walks to.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { LevelData } from '../data/Levels';
import { LAYOUT } from './Layout';

/** A block's footprint, height and corner rounding (shares of the cell). */
const BLOCK = 0.9;
const BLOCK_HEIGHT = 0.78;
const ROUNDING = 0.24;
/** A pulled pixel squashes and stretches for POP_SEC (the ant's pick-up), then goes; its neighbours wobble for WOBBLE_SEC. */
const POP_SEC = 0.12;
const WOBBLE_SEC = 0.45;
/** The board's top: where the picture's blocks (and the ants on the rim) stand. */
export const TRAY_TOP = 0.3;
/** The board (cream) and its wooden border (and how much wider it is). */
const BOARD = 0xfff8ee;
const BORDER = 0xe9c49c;
const BORDER_WIDTH = 0.85;

export class PictureView {
    public readonly group = new THREE.Group();
    private readonly blocks: THREE.InstancedMesh;
    private readonly matrix = new THREE.Matrix4();
    private readonly at = new THREE.Vector3();
    private readonly squash = new THREE.Vector3();
    private readonly quaternion = new THREE.Quaternion();
    /** Blocks being pulled out (they go when done) and wobbling, with the time since they started. */
    private readonly popping = new Map<number, number>();
    private readonly wobbling = new Map<number, number>();
    /** Blocks already taken (never wobbled back into view). */
    private readonly gone = new Set<number>();
    public readonly width: number;
    public readonly depth: number;

    public constructor(private readonly level: LevelData, pixels: Int8Array, public readonly cell: number) {
        this.width = level.width * cell;
        this.depth = level.height * cell;
        const rim = LAYOUT.rim;
        const board = new THREE.Mesh(
            new RoundedBoxGeometry(this.width + rim * 2, 0.2, this.depth + rim * 2, 4, 0.5),
            new THREE.MeshStandardMaterial({ color: BOARD, roughness: 0.9 }),
        );
        board.position.set(this.width / 2, -0.1, this.depth / 2);
        const border = new THREE.Mesh(
            new RoundedBoxGeometry(this.width + (rim + BORDER_WIDTH) * 2, TRAY_TOP + 0.3, this.depth + (rim + BORDER_WIDTH) * 2, 4, 1.1),
            new THREE.MeshStandardMaterial({ color: BORDER, roughness: 0.85 }),
        );
        border.position.set(this.width / 2, -(TRAY_TOP + 0.3) / 2 + 0.14, this.depth / 2);
        this.group.add(border, board);

        const geometry = new RoundedBoxGeometry(cell * BLOCK, cell * BLOCK_HEIGHT, cell * BLOCK, 3, cell * ROUNDING);
        // Jelly: a glossy clearcoat over a soft, slightly sheeny body.
        const jelly = new THREE.MeshPhysicalMaterial({ roughness: 0.4, clearcoat: 0.8, clearcoatRoughness: 0.12 });
        this.blocks = new THREE.InstancedMesh(geometry, jelly, pixels.length);
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

    /** Where a pixel's block stands (on the board, its centre). */
    public cellCenter(i: number, out = new THREE.Vector3()): THREE.Vector3 {
        const x = i % this.level.width;
        const y = Math.floor(i / this.level.width);
        return out.set((x + 0.5) * this.cell, 0, (y + 0.5) * this.cell).add(this.group.position);
    }

    /** Whether a world point is on the tray (the picture or its rim): ants walk at the board's height there. */
    public onTray(x: number, z: number): boolean {
        const rim = LAYOUT.rim + BORDER_WIDTH;
        const px = x - this.group.position.x;
        const pz = z - this.group.position.z;
        return px >= -rim && px <= this.width + rim && pz >= -rim && pz <= this.depth + rim;
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

    /** A pixel is pulled out: it squashes and stretches, then goes; the blocks around it wobble. */
    public pop(i: number): void {
        this.popping.set(i, 0);
        const x = i % this.level.width;
        for (const n of [x > 0 ? i - 1 : -1, x < this.level.width - 1 ? i + 1 : -1, i - this.level.width, i + this.level.width]) {
            if (n >= 0 && n < this.level.width * this.level.height && !this.popping.has(n) && !this.gone.has(n)) this.wobbling.set(n, 0);
        }
    }

    /** Runs the pops and wobbles. */
    public update(delta: number): void {
        for (const [i, t] of this.popping) {
            const time = t + delta;
            if (time >= POP_SEC) {
                this.popping.delete(i);
                this.wobbling.delete(i);
                this.gone.add(i);
                this.place(i, 0, 0);
                continue;
            }
            this.popping.set(i, time);
            // Stretched up and pinched in as it's pulled.
            const k = Math.sin((time / POP_SEC) * Math.PI);
            this.place(i, 1 - 0.3 * k, 1 + 0.45 * k);
        }
        for (const [i, t] of this.wobbling) {
            const time = t + delta;
            if (time >= WOBBLE_SEC) {
                this.wobbling.delete(i);
                this.place(i, 1, 1);
                continue;
            }
            this.wobbling.set(i, time);
            // A damped jiggle: squat and wide, then tall and thin, settling.
            const k = Math.sin(time * 34) * (1 - time / WOBBLE_SEC) * 0.16;
            this.place(i, 1 + k, 1 - k);
        }
        if (this.popping.size || this.wobbling.size) this.blocks.instanceMatrix.needsUpdate = true;
    }

    /** A block at its spot, `wide` across and `tall` (1 = as built; 0 hides it), its base on the tray. */
    private place(i: number, wide: number, tall: number): void {
        const at = this.cellCenter(i, this.at).sub(this.group.position);
        at.y = (this.cell * BLOCK_HEIGHT * tall) / 2;
        // (The group stands at TRAY_TOP: the blocks' bases are on the board.)
        this.matrix.compose(at, this.quaternion, this.squash.set(wide, tall, wide));
        this.blocks.setMatrixAt(i, this.matrix);
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
