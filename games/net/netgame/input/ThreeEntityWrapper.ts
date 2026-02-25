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

    public get isAlive(): boolean {
        return this.body &&
            (this.body as any).world !== null && // Body is still in the physics world
            this.body.id !== undefined &&
            this.body.parts &&
            this.body.parts.length > 0;
    }

    public sync(): void {
        // Prevent syncing if the body is in the process of being destroyed
        if (!this.body || !this.body.position) return;

        this.mesh.position.set(this.body.position.x, -this.body.position.y, 0);
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