import { Body } from 'matter-js';
import * as THREE from 'three';

export class ThreeEntityWrapper {
    public mesh: THREE.Object3D;
    private body: Body;

    constructor(body: Body, mesh: THREE.Object3D) {
        this.body = body;
        this.mesh = mesh;
        this.sync();
    }

    public sync(): void {
        // Map 2D (x, y) to 3D (x, -y, 0)
        // Matter.js Y grows down, Three.js Y grows up
        this.mesh.position.set(this.body.position.x, -this.body.position.y, 0);

        // Match the Z-rotation
        // We negate the angle because of the Y-axis flip
        this.mesh.rotation.z = -this.body.angle;
    }

    public dispose(): void {
        if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
        // Clean up geometry and materials to prevent leaks
        this.mesh.traverse((child) => {
            if ((child as THREE.Mesh).isMesh) {
                (child as THREE.Mesh).geometry.dispose();
                const mat = (child as THREE.Mesh).material;
                if (Array.isArray(mat)) mat.forEach(m => m.dispose());
                else mat.dispose();
            }
        });
    }
}