// TowerBlockSync3D.ts

import * as THREE from 'three';
import { PieceBoxBuilder } from '../game/builders/PieceBoxBuilder';
import { PreviewStripSprite } from '../game/builders/PreviewStripSprite';
import { TextureBuilder } from '../game/builders/TextureBuilder';
import type { FaceTowerBlock, FaceTowerConfig } from './FaceTowerTypes';
import { getPolygonCentroid, getPolygonHorizontalBounds, resolvePieceImagePath } from './PieceStorage';

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

    /**
     * The "landing preview" glow — ONE standalone sprite, not a child of
     * any block's own mesh. Shown/repositioned for whichever block is
     * currently held (see sync()) and hidden once nothing's held — mirrors
     * FaceTowerBlockController's 2D `previewStrip` field.
     */
    private readonly previewStrip: PreviewStripSprite;

    public constructor(
        private readonly scene: THREE.Scene,
        private readonly config: FaceTowerConfig,
        private readonly pixelsPerUnit: number,
        private readonly baseOffset: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 },
    ) {
        this.previewStrip = new PreviewStripSprite(scene);
    }

    public sync(blocks: readonly FaceTowerBlock[], heldBlock?: FaceTowerBlock): void {
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

        this.updatePreviewStrip(heldBlock);
    }

    /**
     * Positions the shared preview strip at the held block's own base —
     * same unit-square centroid math PieceBoxBuilder uses to center a
     * piece's mesh, converted through this same pixelsPerUnit/baseOffset
     * mapping updateCube() uses for the cube itself.
     *
     * Sized/centered off the polygon's own LEFT/RIGHT extremes (see
     * getPolygonHorizontalBounds), not the area centroid — `cube.position`
     * sits at the centroid (that's what PieceBoxBuilder centers the mesh
     * on), which is correct for collision, but for an asymmetric outline
     * that point isn't the visual middle of the shape. Anchoring/sizing the
     * strip off the centroid made it visibly off-center and the wrong
     * width for anything that wasn't a plain rect; the bbox center and
     * (right - left) span fix both.
     *
     * Independent nudges stack on top of that corrected anchor:
     * PieceDefinition.previewOffset (authored in 2D design px, converted
     * through pixelsPerUnit here — same px value tunes both renderers,
     * unless the piece sets `preview3DOffset`, which is already in world
     * units and gets used as-is instead — 2D always keeps using
     * `previewOffset` regardless) and previewGlobalOffset3D (already in
     * world units, applied to every piece alike).
     *
     * Margin (previewMargin3D + PieceDefinition.margin/margin3D) is NOT a Y
     * gap — it insets the strip's WIDTH symmetrically, same as a CSS
     * margin: a margin of 1 removes half a world-unit from the LEFT edge
     * and half from the RIGHT, so the strip stays centered but reads
     * narrower than the piece's own visual span. margin3D (world units)
     * wins outright when set; otherwise margin (px) is converted through
     * pixelsPerUnit — 0 if neither is set.
     */
    private updatePreviewStrip(heldBlock?: FaceTowerBlock): void {
        const cube = heldBlock && this.cubes.get(heldBlock.id);

        if (!heldBlock || !cube || this.config.previewStripHeight <= 0) {
            this.previewStrip.hide();
            return;
        }

        const piece = heldBlock.piece;
        const width = this.config.blockWidth * piece.scale.x / this.pixelsPerUnit;
        const height = this.config.blockHeight * piece.scale.y / this.pixelsPerUnit;
        const stripHeight = this.config.previewStripHeight / this.pixelsPerUnit;

        const centroid = getPolygonCentroid(piece.polygon);
        const bounds = getPolygonHorizontalBounds(piece.polygon);

        const pieceMargin3D = piece.margin3D ?? (piece.margin ?? 0) / this.pixelsPerUnit;
        const totalMargin3D = this.config.previewMargin3D + pieceMargin3D;
        const visualWidth = Math.max(0, (bounds.right - bounds.left) * width - totalMargin3D);
        const centerShiftX = (bounds.center - centroid.x) * width;

        const baseLocalY = (centroid.y - 1) * height;

        // preview3DOffset (already world units) wins outright when a piece
        // sets it — otherwise fall back to converting the shared px
        // previewOffset through pixelsPerUnit, same as width/height/
        // stripHeight above.
        const offsetPx = piece.previewOffset ?? { x: 0, y: 0 };
        const offset = piece.preview3DOffset ?? { x: offsetPx.x / this.pixelsPerUnit, y: offsetPx.y / this.pixelsPerUnit };
        const globalOffset = this.config.previewGlobalOffset3D;

        this.previewStrip.show(
            cube.position.x + centerShiftX + offset.x + globalOffset.x,
            cube.position.y + baseLocalY - offset.y + globalOffset.y,
            cube.position.z,
            visualWidth,
            stripHeight,
            hexStringToNumber(piece.color),
        );
    }

    private createCube(block: FaceTowerBlock): THREE.Mesh {
        const width = this.config.blockWidth * block.piece.scale.x / this.pixelsPerUnit;
        const height = this.config.blockHeight * block.piece.scale.y / this.pixelsPerUnit;
        const color = hexStringToNumber(block.piece.color);

        // Depth is a fixed absolute thickness shared by every piece — like a
        // real block set, a bigger footprint doesn't mean a thicker piece —
        // so it's derived from the UNSCALED base block size, not this
        // piece's own (width, height), which already carry its scale.x/y.
        const baseSize = Math.min(this.config.blockWidth, this.config.blockHeight) / this.pixelsPerUnit;

        // PieceDefinition.faceOffset is authored in 2D design px (same units
        // as everything else in FaceTowerConfig) so one value tunes both
        // renderers — converted through pixelsPerUnit here, same as
        // width/height above, instead of expecting a separate world-unit
        // value per piece.
        const faceOffsetPx = block.piece.faceOffset ?? { x: 0, y: 0 };
        const faceOffset = { x: faceOffsetPx.x / this.pixelsPerUnit, y: faceOffsetPx.y / this.pixelsPerUnit };

        const cube = PieceBoxBuilder.build(color, width, height, {
            polygon: block.piece.polygon,
            depth: baseSize * this.config.pieceDepthRatio,
            bevelRadiusRatio: this.config.pieceBevelRadiusRatio,
            bevelThicknessRatio: this.config.pieceBevelThicknessRatio,
            faceOffset,
            faceScale: block.piece.faceScale,
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
        this.previewStrip.destroy();
    }
}
