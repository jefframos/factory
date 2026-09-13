// TowerBaseSync3D.ts

import type { BasePhysicsEntity } from 'core/phyisics/entities/BaseEntity';
import * as THREE from 'three';
import { PieceBoxBuilder } from '../game/builders/PieceBoxBuilder';
import { TextureBuilder } from '../game/builders/TextureBuilder';
import { getFlapPolygon } from './FlapShape';
import type { FaceTowerConfig } from './FaceTowerTypes';
import { resolvePieceImagePath } from './PieceStorage';
import { getStaticPiece, getStaticPieceById } from './StaticPieceStorage';
import type { Tower3DConfig } from './Tower3DConfig';

function hexStringToNumber(hex: string): number {
    return parseInt(hex.replace('#', ''), 16);
}

/**
 * Mirrors every 2D base platform (the original floor, plus one per
 * completed zone — see FaceTowerBlockController.addBase()) as a matching
 * panel in the 3D scene, using the same pixelsPerUnit/baseOffset conversion
 * as TowerBlockSync3D — built via PieceBoxBuilder (same beveled-extrude +
 * face-decal look every tower piece uses) instead of a plain
 * RoundedBoxGeometry, so a panel's shape/color/face art is data-driven.
 *
 * The very FIRST panel ever placed for a run uses the 'base' static piece
 * (see StaticPieceStorage); every one after that uses the 'milestone' piece
 * instead. Falls back to a plain colored rect if a role has no piece
 * configured, so an empty static-pieces-config.json doesn't break anything.
 *
 * A trapdoor genuinely removes the old base before the new one is placed
 * (see FaceTowerBlockController.removeBase/TowerTrapdoorController) — this
 * diffs `bases` against its own seen ids every sync() (same pattern
 * TowerBlockSync3D already uses for blocks) to add/remove panels to match,
 * instead of the old "bases are never removed, only ever add" assumption.
 */
export class TowerBaseSync3D {
    private readonly panels = new Map<BasePhysicsEntity, THREE.Mesh>();
    /** True once a panel has ever been created for this run — see createPanel()'s isStartingFloor pick. Can't just check `panels.size === 0` any more since a trapdoor genuinely empties `panels` for a beat between the old base's removal and the new one being synced in. */
    private hasPlacedInitialPanel = false;

    public constructor(
        private readonly scene: THREE.Scene,
        private readonly config: FaceTowerConfig,
        private readonly pixelsPerUnit: number,
        private readonly visualConfig: Tower3DConfig,
        private readonly baseOffset: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 },
        /** Mirrors FaceTowerBlockController.getBasePieceId() — an island's basePieceId override, when it resolved to a real STATIC_PIECES entry for this specific base. See createPanel(). */
        private readonly resolvePieceId?: (base: BasePhysicsEntity) => string | undefined,
        /** Mirrors FaceTowerBlockController.getFlapSide() — which flap (left/right) `base` is, so the 3D mesh picks the same FlapShape.getFlapPolygon() variant the 2D view already draws. See createPanel(). */
        private readonly resolveFlapSide?: (base: BasePhysicsEntity) => 'left' | 'right' | undefined,
    ) { }

    public sync(bases: readonly BasePhysicsEntity[]): void {
        const seen = new Set<BasePhysicsEntity>();

        // Resolved ONCE per sync() call, not per panel — a floor's two
        // flaps (see FaceTowerBlockController.addBase()) are always
        // discovered together, in the same sync() pass, the first time
        // they're seen. Resolving "is this the starting floor" per-panel
        // instead would let the first flap correctly see isStartingFloor
        // true and immediately flip hasPlacedInitialPanel, leaving its
        // sibling flap (created a few lines later in the very same pass)
        // wrongly resolving as a 'milestone' panel instead of matching its
        // own floor's 'base' role.
        const isStartingFloor = !this.hasPlacedInitialPanel;

        for (const base of bases) {
            seen.add(base);

            const panel = this.panels.get(base) ?? this.createPanel(base, isStartingFloor);
            this.updatePanel(panel, base);
        }

        if (bases.length > 0) {
            this.hasPlacedInitialPanel = true;
        }

        for (const [base, panel] of this.panels) {
            if (!seen.has(base)) {
                this.removePanel(base, panel);
            }
        }
    }

    private createPanel(base: BasePhysicsEntity, isStartingFloor: boolean): THREE.Mesh {
        const overrideId = this.resolvePieceId?.(base);
        const piece = (overrideId ? getStaticPieceById(overrideId) : undefined) ?? getStaticPiece(isStartingFloor ? 'base' : 'milestone');

        // Each base entity is now one HALF-width flap (see
        // FaceTowerBlockController.addBase()) rather than one full-width
        // panel — the polygon-split note there applies here too, so this
        // never draws `piece.polygon` for a flap's mesh, same as the 2D
        // view (StaticPieceView2D via buildStaticPieceView, called from
        // FaceTowerBlockController.createFlap()) — a fixed pinball-flipper
        // outline (see FlapShape.getFlapPolygon()) is drawn instead, same as
        // that 2D view.
        const flapSide = this.resolveFlapSide?.(base);
        const width = (this.config.floorWidth / 2) / this.pixelsPerUnit;
        // Purely cosmetic — independent from config.floorHeight (the real
        // physics slab thickness, still what wall/dead-zone placement is
        // derived from) and from visualConfig.platformDepth (still shared
        // by the side poles' own mesh). See Tower3DConfig's own doc.
        const height = this.visualConfig.trapdoorMeshHeight;
        const depth = this.visualConfig.trapdoorMeshDepth;

        // StaticPieceDefinition.faceOffset is authored in 2D design px —
        // converted through pixelsPerUnit here, same as width/height above.
        const faceOffsetPx = piece?.faceOffset ?? { x: 0, y: 0 };
        const faceOffset = { x: faceOffsetPx.x / this.pixelsPerUnit, y: faceOffsetPx.y / this.pixelsPerUnit };

        const panel = PieceBoxBuilder.build(
            piece ? hexStringToNumber(piece.color) : this.visualConfig.baseColor,
            width, height,
            {
                // Ignores `piece.polygon` entirely, same as the 2D view —
                // every flap always draws the fixed flipper outline instead
                // (undefined `flapSide` — shouldn't happen in practice —
                // falls back to PieceBoxBuilder's own plain-rect default).
                polygon: flapSide ? getFlapPolygon(flapSide) : undefined,
                depth,
                faceOffset,
                faceScale: piece?.faceScale,
                centerOverride: { x: 0.5, y: 0.5 },
            },
        );

        // Duller, less reflective than a piece — no metal, and a much
        // wider/dimmer clearcoat sheen than a piece gets — but not fully
        // matte, or it reads as flat under the key/rim lights.
        const material = panel.material as THREE.MeshPhysicalMaterial;
        material.roughness = 0.6;
        material.metalness = 0;
        material.clearcoat = 0.2;
        material.clearcoatRoughness = 0.6;
        // Shared texture — its `repeat` is a fixed constant (see
        // TextureBuilder.woodGrain()'s own doc), not per-panel, so no clone
        // is needed here.
        material.map = TextureBuilder.woodGrain();
        material.needsUpdate = true;

        this.scene.add(panel);
        this.panels.set(base, panel);

        if (piece?.texture) {
            // TextureBuilder.load caches by path, so repeated milestone
            // panels sharing the same piece resolve this near-instantly
            // after the first load.
            TextureBuilder.load(resolvePieceImagePath(piece.texture))
                .then(texture => PieceBoxBuilder.setFaceTexture(panel, texture))
                .catch(() => { /* keep the default shared face if art is missing */ });
        }

        return panel;
    }

    private updatePanel(panel: THREE.Mesh, base: BasePhysicsEntity): void {
        const body = base.body;

        panel.position.set(
            (body.position.x - this.config.floorX) / this.pixelsPerUnit +
            this.baseOffset.x,

            (this.config.floorY - body.position.y) / this.pixelsPerUnit +
            this.baseOffset.y,

            this.baseOffset.z,
        );

        // Mirrors the flap's 2D physics tilt (idle rest angle, and the
        // trapdoor's swing-open animation — see
        // FaceTowerBlockController.setFlapAngle()) onto the 3D mesh, same
        // sign/axis convention TowerBlockSync3D.updateCube() already uses
        // to map a Matter 2D body.angle onto a THREE rotation about Z.
        panel.rotation.z = -body.angle;

        // The mesh and the physics collider are both centered on this same
        // body position, but visualConfig.trapdoorMeshHeight is tunable
        // independently from config.floorHeight (the real collider
        // thickness — see Tower3DConfig's own doc) — so unless they happen
        // to match exactly, the mesh's TOP surface (where pieces visually
        // land) drifts away from where the collider's top surface actually
        // is. translateY (not a flat world-space Y add) shifts the mesh
        // along its OWN already-rotated local axis, so the top stays
        // correctly aligned with the collider even while the flap is
        // tilted/mid-swing, not just when it's sitting flat.
        const colliderHeight3D = this.config.floorHeight / this.pixelsPerUnit;
        const heightOffset = (colliderHeight3D - this.visualConfig.trapdoorMeshHeight) / 2;
        panel.translateY(heightOffset);
    }

    private removePanel(base: BasePhysicsEntity, panel: THREE.Mesh): void {
        this.scene.remove(panel);
        PieceBoxBuilder.disposeMesh(panel);
        // material.map is TextureBuilder's shared grain texture (see
        // createPanel()) — do NOT dispose it here, other panels/poles still
        // reference the same instance.
        (panel.material as THREE.Material).dispose();
        this.panels.delete(base);
    }

    public clear(): void {
        for (const [base, panel] of this.panels) {
            this.removePanel(base, panel);
        }

        this.panels.clear();
        this.hasPlacedInitialPanel = false;
    }

    public destroy(): void {
        this.clear();
    }
}
