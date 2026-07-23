// TowerHeightMarkers3D.ts

import { Game } from 'core/Game';
import type { ThreeScene } from 'core/scene/ThreeScene';
import { WorldSpaceLabel } from 'core/utils/WorldSpaceLabel';
import * as PIXI from 'pixi.js';
import * as THREE from 'three';
import { PieceBoxBuilder } from '../game/builders/PieceBoxBuilder';
import type { FaceTowerConfig } from './FaceTowerTypes';
import type { Tower3DConfig } from './Tower3DConfig';

type MarkerLayout = 'centered' | 'side';

/**
 * 3D-space parity for the 2D TowerHeightGauge — two thin, rounded bars
 * built with the same beveled-extrude look every tower piece uses (see
 * PieceBoxBuilder) instead of a sharp flat plane: gold for the current top
 * (semi-transparent), green for the next zone's target line (fully opaque
 * — it's the goal, it should read clearly, not fade into the background).
 *
 * The goal and progress bars are independently configurable — see
 * Tower3DConfig.goalMarkerLayout/progressMarkerLayout (read once at
 * construction — a bar's geometry is built for whichever mode was active
 * at startup, not re-built if the value changes afterward) and
 * showGoalMarker/showProgressMarker (checked every frame in update(), so
 * unlike layout these CAN be toggled live). 'centered' spans a bar the
 * full play-column width, running through the tower (matching the 2D
 * gauge's own "line through the stack" feel); 'side' docks a short bar
 * just past the tower's own right edge, out of the way of the actual
 * gameplay column.
 *
 * Each carries a WorldSpaceLabel (see core/utils/WorldSpaceLabel) showing
 * the height in meters — real 3D text would need font loading/tooling this
 * repo doesn't otherwise use, so the label is a screen-space Pixi.Text that
 * tracks the bar's projected position instead.
 *
 * Uses the exact same world-Y → 3D-Y conversion TowerBlockSync3D.updateCube()
 * and TowerBaseSync3D.updatePanel() already use, so a bar genuinely sits at
 * the same physical height as the pieces/base it corresponds to.
 */
export class TowerHeightMarkers3D {
    private static readonly BAR_HEIGHT = 0.22; // thin — "not much depth"
    private static readonly BAR_DEPTH = 0.05;
    // A fraction of the bar's own (short) height, so this rounds its ends
    // into a smooth pill shape rather than a sharp-edged plank.
    private static readonly BAR_BEVEL_RADIUS_RATIO = 0.5;
    private static readonly BAR_BEVEL_THICKNESS_RATIO = 0.6;

    private static readonly CURRENT_COLOR = 0xff23ff;
    private static readonly CURRENT_OPACITY = 1;
    private static readonly GOAL_COLOR = 0xff2371;
    private static readonly GOAL_OPACITY = 1;

    private readonly currentBar: THREE.Mesh;
    private readonly goalBar: THREE.Mesh;
    private readonly currentLabel: WorldSpaceLabel;
    private readonly goalLabel: WorldSpaceLabel;

    public constructor(
        private readonly threeSceneWrapper: ThreeScene,
        game: Game,
        pixiRoot: PIXI.Container,
        private readonly config: FaceTowerConfig,
        private readonly pixelsPerUnit: number,
        private readonly visualConfig: Tower3DConfig,
        private readonly baseOffset: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 },
    ) {
        this.currentBar = this.buildDashedBar(
            TowerHeightMarkers3D.CURRENT_COLOR,
            TowerHeightMarkers3D.CURRENT_OPACITY,
            this.visualConfig.progressMarkerLayout,
        );

        this.goalBar = this.buildDashedBar(
            TowerHeightMarkers3D.GOAL_COLOR,
            TowerHeightMarkers3D.GOAL_OPACITY,
            this.visualConfig.goalMarkerLayout,
        );

        this.threeSceneWrapper.threeScene.add(this.currentBar);
        this.threeSceneWrapper.threeScene.add(this.goalBar);

        this.currentLabel = new WorldSpaceLabel(threeSceneWrapper, game, pixiRoot, {
            fill: 0xffffff//TowerHeightMarkers3D.CURRENT_COLOR,
        });


        this.goalLabel = new WorldSpaceLabel(threeSceneWrapper, game, pixiRoot, {
            fill: TowerHeightMarkers3D.GOAL_COLOR,
        });
    }

    private buildDashedBar(
        color: number,
        opacity: number,
        layout: MarkerLayout
    ): THREE.Group {

        const group = new THREE.Group();

        const totalWidth = layout === 'side'
            ? this.visualConfig.heightMarkerSideWidth
            : (this.config.maxBlockX - this.config.minBlockX) / this.pixelsPerUnit;

        const dashLength = 0.35;
        const gap = 0.18;

        const dashWidth = dashLength + gap;

        const dashCount = Math.floor((totalWidth + gap) / dashWidth);

        const startX = -totalWidth * 0.5 + dashLength * 0.5;

        for (let i = 0; i < dashCount; i++) {

            const dash = PieceBoxBuilder.build(
                color,
                dashLength,
                TowerHeightMarkers3D.BAR_HEIGHT,
                {
                    depth: TowerHeightMarkers3D.BAR_DEPTH,
                    bevelRadiusRatio: TowerHeightMarkers3D.BAR_BEVEL_RADIUS_RATIO,
                    bevelThicknessRatio: TowerHeightMarkers3D.BAR_BEVEL_THICKNESS_RATIO,
                    faceScale: { x: 0, y: 0 },
                }
            );

            const material = dash.material as THREE.MeshStandardMaterial;
            material.transparent = opacity < 1;
            material.opacity = opacity;
            material.depthWrite = true//opacity >= 1;

            dash.position.x = startX + i * dashWidth;

            group.add(dash);
        }

        return group;
    }

    private buildBar(color: number, opacity: number, layout: MarkerLayout): THREE.Mesh {
        const width = layout === 'side'
            ? this.visualConfig.heightMarkerSideWidth
            : (this.config.maxBlockX - this.config.minBlockX) / this.pixelsPerUnit;

        const mesh = PieceBoxBuilder.build(color, width, TowerHeightMarkers3D.BAR_HEIGHT, {
            depth: TowerHeightMarkers3D.BAR_DEPTH,
            bevelRadiusRatio: TowerHeightMarkers3D.BAR_BEVEL_RADIUS_RATIO,
            bevelThicknessRatio: TowerHeightMarkers3D.BAR_BEVEL_THICKNESS_RATIO,
            // No face decal — this is a plain bar, not a piece.
            faceScale: { x: 0, y: 0 },
        });

        const material = mesh.material as THREE.MeshStandardMaterial;
        material.transparent = opacity < 1;
        material.opacity = opacity;
        // Fully opaque (the goal bar) writes depth normally, like any solid
        // object; a genuinely translucent one (the current-height bar)
        // skips it to avoid the usual transparent-sorting artifacts.
        material.depthWrite = opacity >= 1;

        return mesh;
    }

    private xFor(layout: MarkerLayout): number {
        return layout === 'side'
            ? (this.config.maxBlockX - this.config.floorX) / this.pixelsPerUnit
            + this.visualConfig.heightMarkerSideMargin + this.baseOffset.x
            : this.baseOffset.x;
    }

    /**
     * `currentWorldY`/`targetWorldY` are 2D physics world Y values (same
     * source IslandViewScene.update() derives from
     * FaceTowerGameController.getCurrentTopWorldY()/getTargetLineWorldY()
     * for the 2D gauge). `currentMeters`/`targetMeters` are their
     * already-computed display values.
     */
    public update(currentWorldY: number, targetWorldY: number, currentMeters: number, targetMeters: number): void {
        this.currentBar.visible = this.visualConfig.showProgressMarker;

        if (this.visualConfig.showProgressMarker) {
            const x = this.xFor(this.visualConfig.progressMarkerLayout);
            const y = this.worldYTo3D(currentWorldY);

            this.currentBar.position.set(x + 0.2, y, this.baseOffset.z);
            this.currentLabel.update(new THREE.Vector3(x, y, this.baseOffset.z), `${Math.max(0, currentMeters).toFixed(1)}m`);

            this.currentBar.visible = false;
        } else {
            this.currentLabel.setVisible(false);
        }

        this.goalBar.visible = this.visualConfig.showGoalMarker;

        if (this.visualConfig.showGoalMarker) {
            const x = this.xFor(this.visualConfig.goalMarkerLayout);
            const y = this.worldYTo3D(targetWorldY);

            this.goalBar.position.set(x, y, this.baseOffset.z);
            this.goalLabel.update(new THREE.Vector3(x, y, this.baseOffset.z), `${targetMeters.toFixed(1)}m`);
        } else {
        }
        this.goalLabel.setVisible(false);
    }

    private worldYTo3D(worldY: number): number {
        return (this.config.floorY - worldY) / this.pixelsPerUnit + this.baseOffset.y;
    }

    public destroy(): void {
        this.threeSceneWrapper.threeScene.remove(this.currentBar);
        this.threeSceneWrapper.threeScene.remove(this.goalBar);

        PieceBoxBuilder.disposeMesh(this.currentBar);
        PieceBoxBuilder.disposeMesh(this.goalBar);

        (this.currentBar.material as THREE.Material).dispose();
        (this.goalBar.material as THREE.Material).dispose();

        this.currentLabel.destroy();
        this.goalLabel.destroy();
    }
}
