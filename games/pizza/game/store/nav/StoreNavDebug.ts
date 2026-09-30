// StoreNavDebug.ts
//
// Floor overlay for one store's navigation, shown only while PHYSICS_DEBUG
// is on (the pizza web editor's "Debug Colliders" toggle — see
// physics/PhysicsConstants.ts): blocked nav cells in red, every queue spot
// in green (spot 0 brighter), and each client's remaining path as a yellow
// line. Store.ts creates it in awake() and parents it under the store's own
// root, so it hides with the store under fog of war.

import * as THREE from 'three';
import StoreNavGrid from './StoreNavGrid';
import StoreLine from '../StoreLine';

const OVERLAY_Y = 0.04;
const BLOCKED_COLOR = 0xff3030;
const SPOT_COLOR = 0x30d070;
const FRONT_SPOT_COLOR = 0x80ffb0;
const PATH_COLOR = 0xffd740;
const SPOT_SIZE = 0.35;
/** Most path segments drawn at once (all clients together). */
const MAX_PATH_SEGMENTS = 256;

interface PathOwner {
    readonly position: THREE.Vector3;
    getPath(): readonly THREE.Vector3[];
}

export default class StoreNavDebug {
    public readonly object = new THREE.Group();
    private blocked?: THREE.InstancedMesh;
    private spots?: THREE.InstancedMesh;
    private readonly pathPositions = new Float32Array(MAX_PATH_SEGMENTS * 2 * 3);
    private readonly pathGeometry = new THREE.BufferGeometry();
    private readonly paths: THREE.LineSegments;
    private builtFor?: StoreNavGrid;

    public constructor() {
        this.object.name = 'storeNavDebug';
        this.pathGeometry.setAttribute('position', new THREE.BufferAttribute(this.pathPositions, 3).setUsage(THREE.DynamicDrawUsage));
        this.paths = new THREE.LineSegments(this.pathGeometry, new THREE.LineBasicMaterial({ color: PATH_COLOR, depthTest: false }));
        this.paths.frustumCulled = false;
        this.paths.renderOrder = 10;
        this.object.add(this.paths);
    }

    /** Redraws cells and spots — call whenever the grid or the queue layout changed. */
    public rebuild(grid: StoreNavGrid, lines: readonly StoreLine<unknown>[]): void {
        this.builtFor = grid;
        this.disposeMesh(this.blocked);
        this.disposeMesh(this.spots);

        const blockedCells: number[] = [];
        for (let i = 0; i < grid.cellCount; i++) {
            if (grid.isCellBlocked(i)) {
                blockedCells.push(i);
            }
        }
        this.blocked = this.makeQuads(grid.cellSize * 0.9, BLOCKED_COLOR, 0.35, blockedCells.length);
        const matrix = new THREE.Matrix4();
        const center = new THREE.Vector3();
        blockedCells.forEach((cell, index) => {
            grid.cellCenter(cell, center);
            this.blocked!.setMatrixAt(index, matrix.makeTranslation(center.x, OVERLAY_Y, center.z));
        });
        this.blocked.instanceMatrix.needsUpdate = true;
        this.object.add(this.blocked);

        const spots = lines.flatMap(line => (line.getSpots().length > 0 ? line.getSpots() : [line.firstSpot]).map((spot, index) => ({ spot, front: index === 0 })));
        this.spots = this.makeQuads(SPOT_SIZE, SPOT_COLOR, 0.9, spots.length);
        const color = new THREE.Color();
        spots.forEach(({ spot, front }, index) => {
            this.spots!.setMatrixAt(index, matrix.makeTranslation(spot.x, OVERLAY_Y + 0.01, spot.z));
            this.spots!.setColorAt(index, color.set(front ? FRONT_SPOT_COLOR : SPOT_COLOR));
        });
        this.spots.instanceMatrix.needsUpdate = true;
        if (this.spots.instanceColor) {
            this.spots.instanceColor.needsUpdate = true;
        }
        this.object.add(this.spots);
    }

    /** Per frame: rebuilds if the grid was swapped, then redraws client paths. */
    public update(grid: StoreNavGrid | undefined, lines: readonly StoreLine<unknown>[], owners: readonly PathOwner[]): void {
        if (grid && grid !== this.builtFor) {
            this.rebuild(grid, lines);
        }
        let segment = 0;
        for (const owner of owners) {
            let from = owner.position;
            for (const point of owner.getPath()) {
                if (segment >= MAX_PATH_SEGMENTS) {
                    break;
                }
                this.pathPositions.set([from.x, OVERLAY_Y + 0.02, from.z, point.x, OVERLAY_Y + 0.02, point.z], segment * 6);
                segment++;
                from = point;
            }
        }
        this.pathGeometry.setDrawRange(0, segment * 2);
        (this.pathGeometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    }

    public destroy(): void {
        this.disposeMesh(this.blocked);
        this.disposeMesh(this.spots);
        this.pathGeometry.dispose();
        (this.paths.material as THREE.Material).dispose();
        this.object.removeFromParent();
    }

    private makeQuads(size: number, color: number, opacity: number, count: number): THREE.InstancedMesh {
        const geometry = new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2);
        const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
        const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, count));
        mesh.count = count;
        mesh.frustumCulled = false;
        return mesh;
    }

    private disposeMesh(mesh: THREE.InstancedMesh | undefined): void {
        if (!mesh) {
            return;
        }
        mesh.removeFromParent();
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
    }
}
