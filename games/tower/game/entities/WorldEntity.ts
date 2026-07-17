import * as THREE from "three";

export class WorldEntity {
    public transform: THREE.Group;
    public mesh: THREE.Mesh;

    constructor(mesh: THREE.Mesh) {
        this.transform = new THREE.Group();
        this.mesh = mesh;
        this.transform.add(mesh);
    }

    public addToScene(scene: THREE.Scene): void {
        scene.add(this.transform);
    }

    public get position(): THREE.Vector3 {
        return this.transform.position;
    }

    public destroy(): void {
        this.mesh.geometry.dispose();
        (this.mesh.material as THREE.Material).dispose();
        this.transform.removeFromParent();
    }
}
