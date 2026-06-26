import * as THREE from "three";

export class FloorBuilder {
    static build(scene: THREE.Scene, size = 30): void {
        // Solid floor
        const geo = new THREE.PlaneGeometry(size, size);
        const mat = new THREE.MeshStandardMaterial({ color: 0x222233 });
        const floor = new THREE.Mesh(geo, mat);
        floor.rotation.x = -Math.PI / 2;
        scene.add(floor);

        // Grid overlay for visible movement
        const grid = new THREE.GridHelper(size, size, 0x4444ff, 0x4444ff);
        grid.position.y = 0.01;
        scene.add(grid);
    }
}
