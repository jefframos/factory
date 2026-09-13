// TowerGameOverSiren3D.ts

import type { ThreeScene } from 'core/scene/ThreeScene';
import * as THREE from 'three';
import type { FaceTowerConfig } from './FaceTowerTypes';

/**
 * 3D warning plane pinned to the exact same world-Y as the fixed game-over
 * line (see TowerHeightMarkers3D's own goal bar, which uses the identical
 * worldYTo3D() conversion) — anchored like a sprite at (0.5, 1): centered
 * horizontally, its BOTTOM edge pinned to the line, stretching outward
 * (wide) and upward (tall) from there so it reads as a big emergency
 * backdrop behind the pile rather than a thin bar.
 *
 * Pulses red↔blue / alpha "breathes" like a siren for as long as a piece is
 * actually sitting at/above the line (see
 * FaceTowerGameController.getGameOverWarningSecondsRemaining()) — see
 * update(), the sole driver of both position and color/alpha.
 */
export class TowerGameOverSiren3D {
    /** Multiple of the play column's own width (config.maxBlockX - minBlockX) — deliberately much wider than the column so it reads as a backdrop, not a bar matching the tower's own width. */
    private static readonly WIDTH_MULTIPLIER = 4;
    /** World units, extending upward from the pinned bottom edge. */
    private static readonly HEIGHT = 10;

    /** Radians/sec the red↔blue mix cycles at — slower than the alpha pulse so the color shift itself reads, not just a flicker. */
    private static readonly CYCLE_SPEED = 6;
    /** Radians/sec the alpha "breathes" at — faster than the color cycle, the actual urgent-flash beat. */
    private static readonly PULSE_SPEED = 10;
    private static readonly MIN_OPACITY = 0.15;
    private static readonly MAX_OPACITY = 0.5;

    private static readonly COLOR_A = new THREE.Color(0xff1e1e); // siren red
    private static readonly COLOR_B = new THREE.Color(0x1e6bff); // siren blue

    private readonly mesh: THREE.Mesh;
    private readonly material: THREE.MeshBasicMaterial;
    /** Only advances while actually active — see update(). */
    private phase = 0;

    public constructor(
        private readonly threeSceneWrapper: ThreeScene,
        private readonly config: FaceTowerConfig,
        private readonly pixelsPerUnit: number,
        private readonly baseOffset: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 },
    ) {
        const columnWidth = (config.maxBlockX - config.minBlockX) / pixelsPerUnit;
        const width = columnWidth * TowerGameOverSiren3D.WIDTH_MULTIPLIER;
        const height = TowerGameOverSiren3D.HEIGHT;

        const geometry = new THREE.PlaneGeometry(width, height);
        // PlaneGeometry spans -height/2..height/2 by default (anchor 0.5,
        // 0.5) — shift it up so LOCAL y=0 is the plane's own BOTTOM edge
        // (anchor 0.5, 1), matching where this.mesh.position gets pinned.
        geometry.translate(0, height * 0.5, 0);

        this.material = new THREE.MeshBasicMaterial({
            color: TowerGameOverSiren3D.COLOR_A,
            transparent: true,
            opacity: 0,
            depthWrite: false,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
        });

        this.mesh = new THREE.Mesh(geometry, this.material);
        this.mesh.visible = false;
        // Draw after the opaque pieces/base so the additive glow layers on
        // top instead of fighting z-order with them.
        this.mesh.renderOrder = 10;

        this.threeSceneWrapper.threeScene.add(this.mesh);
    }

    /**
     * `active` mirrors FaceTowerGameController.getGameOverWarningSecondsRemaining()
     * being defined (a settled piece is currently at/above the line).
     * `lineWorldY` is the fixed game-over line's own 2D physics world Y —
     * see FaceTowerGameController.getGameOverLineWorldY(), the exact same
     * source TowerHeightMarkers3D's own goal bar is positioned from.
     */
    public update(active: boolean, lineWorldY: number, delta: number): void {
        this.mesh.visible = active;

        if (!active) {
            this.phase = 0;
            return;
        }

        this.phase += delta;

        this.mesh.position.set(
            this.baseOffset.x,
            this.worldYTo3D(lineWorldY),
            this.baseOffset.z,
        );

        const colorMix = 0.5 + 0.5 * Math.sin(this.phase * TowerGameOverSiren3D.CYCLE_SPEED);
        this.material.color
            .copy(TowerGameOverSiren3D.COLOR_A)
            .lerp(TowerGameOverSiren3D.COLOR_B, colorMix);

        const pulse = 0.5 + 0.5 * Math.sin(this.phase * TowerGameOverSiren3D.PULSE_SPEED);
        this.material.opacity = TowerGameOverSiren3D.MIN_OPACITY +
            (TowerGameOverSiren3D.MAX_OPACITY - TowerGameOverSiren3D.MIN_OPACITY) * pulse;
    }

    /** Same 2D-world-Y → THREE-Y conversion TowerBlockSync3D/TowerHeightMarkers3D already use, so this sits at the exact same physical height as the pieces/line it corresponds to. */
    private worldYTo3D(worldY: number): number {
        return (this.config.floorY - worldY) / this.pixelsPerUnit + this.baseOffset.y;
    }

    public destroy(): void {
        this.threeSceneWrapper.threeScene.remove(this.mesh);
        this.mesh.geometry.dispose();
        this.material.dispose();
    }
}
