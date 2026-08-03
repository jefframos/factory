import * as THREE from "three";
import { BendService } from "../services/BendService";

/**
 * Cheap blob shadow: a flat transparent disc rendered just above the floor.
 * All instances share one radial-gradient texture.
 * depthWrite=false so it never occludes cubes sitting on top of it.
 */
export class BlobShadow {
    private mesh: THREE.Mesh;
    private static sharedTex: THREE.CanvasTexture | null = null;

    constructor(scene: THREE.Scene) {
        const geo = new THREE.CircleGeometry(1, 20);
        const mat = new THREE.MeshBasicMaterial({
            map: BlobShadow.getTexture(),
            transparent: true,
            depthWrite: false,
        });
        BendService.applyBend(mat);
        this.mesh = new THREE.Mesh(geo, mat);
        this.mesh.rotation.x = -Math.PI / 2;
        this.mesh.renderOrder = 1; // after floor, before cubes
        scene.add(this.mesh);
    }

    /** Call every frame with the entity's XZ position and its visual size. */
    update(x: number, z: number, size: number): void {
        this.mesh.position.set(x, 0.015, z);
        this.mesh.scale.setScalar(size * 0.7);
    }

    destroy(): void {
        this.mesh.geometry.dispose();
        (this.mesh.material as THREE.Material).dispose();
        this.mesh.removeFromParent();
    }

    private static getTexture(): THREE.CanvasTexture {
        if (!BlobShadow.sharedTex) {
            const px = 128;
            const canvas = document.createElement("canvas");
            canvas.width = canvas.height = px;
            const ctx = canvas.getContext("2d")!;
            const grad = ctx.createRadialGradient(px / 2, px / 2, 0, px / 2, px / 2, px / 2);
            grad.addColorStop(0,    "rgba(0,0,0,0.55)");
            grad.addColorStop(0.45, "rgba(0,0,0,0.25)");
            grad.addColorStop(1,    "rgba(0,0,0,0)");
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, px, px);
            BlobShadow.sharedTex = new THREE.CanvasTexture(canvas);
        }
        return BlobShadow.sharedTex;
    }
}
