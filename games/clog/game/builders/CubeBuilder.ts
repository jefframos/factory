import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

const VALUE_COLORS: Record<number, string> = {
    2: "#4aba8a",
    4: "#4488cc",
    8: "#e87850",
    16: "#cc44aa",
    32: "#88cc44",
    64: "#cc8844",
    128: "#4444cc",
    256: "#aa44cc",
    512: "#cc4444",
    1024: "#44cccc",
};

export function colorForValue(value: number): string {
    return VALUE_COLORS[value] ?? "#888888";
}

export class CubeBuilder {

    /** Rounded cube with number on top face (+Y = index 2). */
    static buildNumbered(value: number, size = 1): THREE.Mesh {
        const geo = new RoundedBoxGeometry(size, size, size, 4, size * 0.15);
        const color = colorForValue(value);
        const solid = new THREE.MeshStandardMaterial({ color });
        const top = new THREE.MeshStandardMaterial({ map: CubeBuilder.makeNumberTexture(value, color) });
        // face order: +X, -X, +Y (top), -Y, +Z (front), -Z
        return new THREE.Mesh(geo, [solid, solid, top, solid, solid, solid]);
    }

    /** Rounded cube with face-texture on front (+Z = index 4) and number on top (+Y = index 2). */
    static buildPlayer(value: number, size = 1): THREE.Mesh {
        const geo = new RoundedBoxGeometry(size, size, size, 4, size * 0.15);
        const color = colorForValue(value);
        const solid = new THREE.MeshStandardMaterial({ color });
        const top = new THREE.MeshStandardMaterial({ map: CubeBuilder.makeNumberTexture(value, color) });
        const front = new THREE.MeshStandardMaterial({ map: CubeBuilder.makeFaceTexture(color) });
        // face order: +X, -X, +Y (top), -Y, +Z (front), -Z
        return new THREE.Mesh(geo, [solid, solid, top, solid, front, solid]);
    }

    /** Update number texture (top) and solid color on an existing cube mesh. */
    static updateTextures(mesh: THREE.Mesh, value: number): void {
        const mats = Array.isArray(mesh.material)
            ? (mesh.material as THREE.MeshStandardMaterial[])
            : [mesh.material as THREE.MeshStandardMaterial];
        const color = colorForValue(value);

        mats.forEach((mat, i) => {
            if (i === 2) {
                // Top — swap number texture
                if (mat.map) mat.map.dispose();
                mat.map = CubeBuilder.makeNumberTexture(value, color);
                mat.needsUpdate = true;
            } else if (i === 4 && mat.map) {
                // Front face texture — regenerate with new color
                mat.map.dispose();
                mat.map = CubeBuilder.makeFaceTexture(color);
                mat.needsUpdate = true;
            } else {
                // Solid face — update color only
                mat.color.set(color);
            }
        });
    }

    static makeNumberTexture(value: number, bgColor: string): THREE.CanvasTexture {
        const size = 128;
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext("2d")!;

        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, size, size);

        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 60px Arial";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(value), size / 2, size / 2);

        return new THREE.CanvasTexture(canvas);
    }

    static makeFaceTexture(bgColor: string): THREE.CanvasTexture {
        const size = 128;
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext("2d")!;

        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, size, size);

        // Eyes — white
        ctx.fillStyle = "#ffffff";
        ctx.beginPath(); ctx.arc(40, 45, 14, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(88, 45, 14, 0, Math.PI * 2); ctx.fill();
        // Pupils
        ctx.fillStyle = "#222222";
        ctx.beginPath(); ctx.arc(44, 48, 7, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(92, 48, 7, 0, Math.PI * 2); ctx.fill();
        // Smile
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 5;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.arc(64, 60, 28, 0.2 * Math.PI, 0.8 * Math.PI);
        ctx.stroke();

        return new THREE.CanvasTexture(canvas);
    }

    static disposeMesh(mesh: THREE.Mesh): void {
        mesh.geometry.dispose();
        const mats = Array.isArray(mesh.material)
            ? (mesh.material as THREE.MeshStandardMaterial[])
            : [mesh.material as THREE.MeshStandardMaterial];
        for (const m of mats) {
            if (m.map) m.map.dispose();
            m.dispose();
        }
    }
}
