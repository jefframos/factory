import * as THREE from "three";
import { BendService } from "../services/BendService";

export class FloorBuilder {
    static build(scene: THREE.Scene, size = 30, cx = 0, cz = 0): THREE.Mesh {
        // More segments so the radial bend looks smooth (1×1 only bends the 4 corners)
        const geo = new THREE.PlaneGeometry(size, size, 32, 32);
        const mat = new THREE.MeshBasicMaterial({ map: FloorBuilder.makeGridTexture(size) });
        BendService.applyBend(mat);
        const floor = new THREE.Mesh(geo, mat);
        floor.rotation.x = -Math.PI / 2;
        floor.position.set(cx, 0, cz);
        scene.add(floor);
        return floor;
    }

    /**
     * Generates a seamless 1-unit grid tile as a canvas texture.
     * Lines are drawn at the exact tile boundary (x=0, y=0) so they line up
     * perfectly across all repeats without gaps or doubled edges.
     */
    static makeGridTexture(worldSize: number): THREE.CanvasTexture {
        const px = 256;
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = px;
        const ctx = canvas.getContext("2d")!;

        ctx.fillStyle = "#141830";
        ctx.fillRect(0, 0, px, px);

        ctx.strokeStyle = "#5566ff";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(0, 0); ctx.lineTo(0, px); // left/right boundary
        ctx.moveTo(0, 0); ctx.lineTo(px, 0); // top/bottom boundary
        ctx.stroke();

        const tex = new THREE.CanvasTexture(canvas);
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(worldSize, worldSize); // one grid cell per world unit
        tex.anisotropy = 8;
        return tex;
    }
}
