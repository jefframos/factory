// TowerBlockSync3D.ts

import * as THREE from 'three';
import { PieceBoxBuilder } from '../game/builders/PieceBoxBuilder';
import { TextureBuilder } from '../game/builders/TextureBuilder';
import type { FaceTowerBlock, FaceTowerConfig } from './FaceTowerTypes';
import { resolvePieceImagePath } from './PieceStorage';

function hexStringToNumber(hex: string): number {
    return parseInt(hex.replace('#', ''), 16);
}

/**
 * Mirrors every live 2D physics block as a matching box in the 3D scene —
 * built via PieceBoxBuilder.build() (beveled box + face decal) instead of a
 * plain BoxGeometry, colored, textured, and SIZED from the block's own piece
 * (see PieceManager) — piece.scale.x/y independently multiply box
 * width/height, so a wider or taller piece matches the 2D side.
 * `pixelsPerUnit` design pixels become 1 THREE unit — at the default 80,
 * an 80x80 2D block becomes a 1x1x1 cube (before scale is applied).
 *
 * Position mapping: 2D X and height-climbed-above-the-original-floor map
 * onto 3D X and Y (up) — the 2D game has no depth axis, so Z is fixed at 0.
 * Purely visual; the 2D Matter.js world stays the source of truth.
 */
export class TowerBlockSync3D {
    private readonly cubes = new Map<number, THREE.Mesh>();

    public constructor(
        private readonly scene: THREE.Scene,
        private readonly config: FaceTowerConfig,
        private readonly pixelsPerUnit: number,
        private readonly baseOffset: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 },
    ) { }

    public sync(blocks: readonly FaceTowerBlock[]): void {
        const seen = new Set<number>();

        for (const block of blocks) {
            seen.add(block.id);

            const cube = this.cubes.get(block.id) ?? this.createCube(block);
            this.updateCube(cube, block);
        }

        for (const [id, cube] of this.cubes) {
            if (!seen.has(id)) {
                this.removeCube(id, cube);
            }
        }
    }

    private createCube(block: FaceTowerBlock): THREE.Mesh {
        const width = this.config.blockWidth * block.piece.scale.x / this.pixelsPerUnit;
        const height = this.config.blockHeight * block.piece.scale.y / this.pixelsPerUnit;
        const color = hexStringToNumber(block.piece.color);
        const cube = PieceBoxBuilder.build(color, width, height, {
            polygon: block.piece.polygon,
            depth: Math.min(width, height) * this.config.pieceDepthRatio,
            bevelRadiusRatio: this.config.pieceBevelRadiusRatio,
            bevelThicknessRatio: this.config.pieceBevelThicknessRatio,
        });

        this.scene.add(cube);
        this.cubes.set(block.id, cube);

        if (block.piece.texture) {
            // TextureBuilder.load caches by path, so repeated blocks of the
            // same piece resolve this near-instantly after the first load.
            TextureBuilder.load(resolvePieceImagePath(block.piece.texture))
                .then(texture => PieceBoxBuilder.setFaceTexture(cube, texture))
                .catch(() => { /* keep the default shared face if art is missing */ });
        }

        return cube;
    }

    private updateCube(cube: THREE.Mesh, block: FaceTowerBlock): void {
        const body = block.entity.body;

        cube.position.set(
            (body.position.x - this.config.floorX) / this.pixelsPerUnit +
            this.baseOffset.x,

            (this.config.floorY - body.position.y) / this.pixelsPerUnit +
            this.baseOffset.y,

            this.baseOffset.z,
        );

        // 2D rotation is around the screen-facing axis; the closest 3D
        // analogue for a side-on toppling block is rotation about Z.
        cube.rotation.z = -body.angle;
    }

    private removeCube(id: number, cube: THREE.Mesh): void {
        this.scene.remove(cube);

        // PieceBoxBuilder.build() is never cached (see its docstring) — its
        // body material is a one-off we own too.
        PieceBoxBuilder.disposeMesh(cube);
        (cube.material as THREE.Material).dispose();

        this.cubes.delete(id);
    }

    public clear(): void {
        for (const [id, cube] of this.cubes) {
            this.removeCube(id, cube);
        }
    }

    public destroy(): void {
        this.clear();
    }
}
