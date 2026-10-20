// NavDebugOverlay.ts
//
// ?botnav — draws the playtest bot's own walkability map on the ground, so a place where it
// disagrees with the real world (a doorway it thinks is a wall, a fence gap it doesn't know about)
// is visible at a glance:
//   red tint     — cells the bot's WorldNavGrid treats as blocked (walls, solids grown by the
//                  player's radius, unwalkable/locked tiles);
//   yellow line  — the route the bot is following right now, ending at its goal.
//
// One plane over the whole grid with a DataTexture (one texel per nav cell), refreshed whenever
// the grid object is rebuilt; bent with the world (BendService) so it lines up away from the
// player too. Debug only — nothing is created without the URL flag.

import * as THREE from 'three';
import type StoreNavGrid from '../store/nav/StoreNavGrid';
import { BendService } from '../services/BendService';

const HEIGHT = 0.06;
const BLOCKED_RGBA = [255, 40, 40, 110];
/** Plane subdivisions per side — enough for the bend shader to curve it with the ground. */
const SEGMENTS = 160;

export default class NavDebugOverlay {
    private mesh?: THREE.Mesh;
    private texture?: THREE.DataTexture;
    private shownGrid?: StoreNavGrid;
    private readonly line: THREE.Line;
    private readonly linePositions = new Float32Array(3 * 256);

    public constructor(private readonly scene: THREE.Scene) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(this.linePositions, 3));
        geometry.setDrawRange(0, 0);
        const material = new THREE.LineBasicMaterial({ color: 0xffd400, depthTest: false });
        this.line = new THREE.Line(geometry, material);
        this.line.frustumCulled = false;
        this.line.renderOrder = 999;
        scene.add(this.line);
    }

    /** Every frame: rebuild the texture if the grid changed; redraw the route. */
    public update(grid: StoreNavGrid | undefined, path: readonly THREE.Vector3[], from: THREE.Vector3): void {
        if (grid && grid !== this.shownGrid) {
            this.showGrid(grid);
        }
        const points = [from, ...path].slice(0, this.linePositions.length / 3);
        points.forEach((point, i) => this.linePositions.set([point.x, HEIGHT + 0.05, point.z], i * 3));
        const geometry = this.line.geometry as THREE.BufferGeometry;
        (geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
        geometry.setDrawRange(0, path.length > 0 ? points.length : 0);
    }

    private showGrid(grid: StoreNavGrid): void {
        this.shownGrid = grid;
        const data = new Uint8Array(grid.cols * grid.rows * 4);
        for (let i = 0; i < grid.cellCount; i++) {
            if (grid.isCellBlocked(i)) {
                data.set(BLOCKED_RGBA, i * 4);
            }
        }
        this.texture?.dispose();
        this.texture = new THREE.DataTexture(data, grid.cols, grid.rows, THREE.RGBAFormat);
        this.texture.magFilter = THREE.NearestFilter;
        this.texture.minFilter = THREE.NearestFilter;
        this.texture.needsUpdate = true;

        const width = grid.cols * grid.cellSize;
        const depth = grid.rows * grid.cellSize;
        if (!this.mesh) {
            const material = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false });
            BendService.applyBend(material);
            this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, SEGMENTS, SEGMENTS), material);
            // Plane lies in XZ; texture row 0 (minZ) at the plane's -Z edge.
            this.mesh.rotation.x = -Math.PI / 2;
            this.mesh.frustumCulled = false;
            this.mesh.renderOrder = 998;
            this.scene.add(this.mesh);
        }
        const material = this.mesh.material as THREE.MeshBasicMaterial;
        material.map = this.texture;
        material.needsUpdate = true;
        // After the -90° X rotation the plane's v=1 edge faces -Z — flipping V (flipV()) puts
        // texture row 0 (the grid's minZ row) at minZ.
        this.mesh.scale.set(width, depth, 1);
        this.mesh.position.set(grid.minX + width / 2, HEIGHT, grid.minZ + depth / 2);
        flipV(this.mesh.geometry as THREE.BufferGeometry);
    }

    public destroy(): void {
        this.mesh && this.scene.remove(this.mesh);
        this.scene.remove(this.line);
        this.texture?.dispose();
    }
}

/** Mirrors the plane's V coordinates once (see showGrid()). */
function flipV(geometry: THREE.BufferGeometry): void {
    if (geometry.userData.vFlipped) {
        return;
    }
    const uv = geometry.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) {
        uv.setY(i, 1 - uv.getY(i));
    }
    uv.needsUpdate = true;
    geometry.userData.vFlipped = true;
}
