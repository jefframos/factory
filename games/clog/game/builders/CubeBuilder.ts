import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { BendService } from "../services/BendService";
import { formatValue } from "../ClogConstants";

// One color per doubling of value, in order starting at value=2.
// Add entries freely — colorForValue() cycles through these instead of defaulting to grey.
export const VALUE_PALETTE: string[] = [
    '#4aba8a',  //  2  — mint green
    '#4488cc',  //  4  — sky blue
    '#e87850',  //  8  — tangerine
    '#cc44aa',  // 16  — magenta
    '#88cc44',  // 32  — lime
    '#cc8844',  // 64  — amber
    '#4444cc',  // 128  — cobalt
    '#aa44cc',  // 256  — purple
    '#cc4444',  // 512  — crimson
    '#44cccc',  // 1024  — teal
    '#ffd700',  // 2048  — gold
    '#ff6b6b',  // 4096  — coral
    '#69f0ae',  // 8192  — spring green
    '#ba68c8',  // 16384  — lavender
    '#ff7043',  // 32768  — deep orange
    '#00acc1',  // 65536  — aqua blue
];

export function colorForValue(value: number): string {
    const idx = Math.max(0, Math.round(Math.log2(Math.max(1, value))) - 1);
    return VALUE_PALETTE[idx % VALUE_PALETTE.length];
}

export class CubeBuilder {
    // ── Shared per-value materials/textures ─────────────────────────────────
    // Every cube's appearance is fully determined by its value (color + number
    // glyph are both derived from it), so — same as BoundlessChunk's tile
    // materials — build each value's material/texture once and reuse the exact
    // same object forever instead of creating "new" ones per cube instance.
    // That's what lets the renderer skip re-doing GPU pipeline setup every time
    // a food cube spawns or a merge doubles a value.
    private static solidMatCache = new Map<number, THREE.MeshStandardMaterial>();
    private static topMatCache = new Map<number, THREE.MeshStandardMaterial>();
    private static frontMatCache = new Map<number, THREE.MeshStandardMaterial>();
    private static numberTexCache = new Map<number, THREE.CanvasTexture>();
    private static faceTexCache = new Map<number, THREE.CanvasTexture>();

    private static getSolidMaterial(value: number): THREE.MeshStandardMaterial {
        let mat = CubeBuilder.solidMatCache.get(value);
        if (!mat) {
            mat = new THREE.MeshStandardMaterial({ color: colorForValue(value) });
            BendService.applyBend(mat);
            CubeBuilder.solidMatCache.set(value, mat);
        }
        return mat;
    }

    private static getTopMaterial(value: number): THREE.MeshStandardMaterial {
        let mat = CubeBuilder.topMatCache.get(value);
        if (!mat) {
            mat = new THREE.MeshStandardMaterial({ map: CubeBuilder.getNumberTexture(value) });
            BendService.applyBend(mat);
            CubeBuilder.topMatCache.set(value, mat);
        }
        return mat;
    }

    private static getFrontMaterial(value: number): THREE.MeshStandardMaterial {
        let mat = CubeBuilder.frontMatCache.get(value);
        if (!mat) {
            mat = new THREE.MeshStandardMaterial({ map: CubeBuilder.getFaceTexture(value) });
            BendService.applyBend(mat);
            CubeBuilder.frontMatCache.set(value, mat);
        }
        return mat;
    }

    private static getNumberTexture(value: number): THREE.CanvasTexture {
        let tex = CubeBuilder.numberTexCache.get(value);
        if (!tex) {
            tex = CubeBuilder.makeNumberTexture(value, colorForValue(value));
            CubeBuilder.numberTexCache.set(value, tex);
        }
        return tex;
    }

    private static getFaceTexture(value: number): THREE.CanvasTexture {
        let tex = CubeBuilder.faceTexCache.get(value);
        if (!tex) {
            tex = CubeBuilder.makeFaceTexture(colorForValue(value));
            CubeBuilder.faceTexCache.set(value, tex);
        }
        return tex;
    }

    /** Rounded cube with number on top face (+Y = index 2). */
    static buildNumbered(value: number, size = 1): THREE.Mesh {
        const geo = new RoundedBoxGeometry(size, size, size, 4, size * 0.15);
        const solid = CubeBuilder.getSolidMaterial(value);
        const top = CubeBuilder.getTopMaterial(value);
        // face order: +X, -X, +Y (top), -Y, +Z (front), -Z
        return new THREE.Mesh(geo, [solid, solid, top, solid, solid, solid]);
    }

    /** Rounded cube with face-texture on front (+Z = index 4) and number on top (+Y = index 2). */
    static buildPlayer(value: number, size = 1): THREE.Mesh {
        const geo = new RoundedBoxGeometry(size, size, size, 4, size * 0.15);
        const solid = CubeBuilder.getSolidMaterial(value);
        const top = CubeBuilder.getTopMaterial(value);
        const front = CubeBuilder.getFrontMaterial(value);
        // face order: +X, -X, +Y (top), -Y, +Z (front), -Z
        return new THREE.Mesh(geo, [solid, solid, top, solid, front, solid]);
    }

    /**
     * Swap an existing cube mesh onto the (cached, shared) materials for its new
     * value. Never mutates a material in place — these are shared across every
     * cube at that value, so mutating one would repaint every other cube too.
     */
    static updateTextures(mesh: THREE.Mesh, value: number, hasFace: boolean): void {
        const solid = CubeBuilder.getSolidMaterial(value);
        const top = CubeBuilder.getTopMaterial(value);
        mesh.material = hasFace
            ? [solid, solid, top, solid, CubeBuilder.getFrontMaterial(value), solid]
            : [solid, solid, top, solid, solid, solid];
    }

    static makeNumberTexture(value: number, bgColor: string): THREE.CanvasTexture {
        const size = 128;
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext("2d")!;

        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, size, size);

        const text = formatValue(value);
        const fontSize = text.length <= 2 ? 70 : text.length <= 3 ? 55 : text.length <= 4 ? 42 : 30;
        ctx.font = `bold ${fontSize}px Arial`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.strokeStyle = "rgba(0,0,0,0.65)";
        ctx.lineWidth = 10;
        ctx.lineJoin = "round";
        ctx.strokeText(text, size / 2, size / 2);
        ctx.fillStyle = "#ffffff";
        ctx.fillText(text, size / 2, size / 2);

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

    /** Materials/textures are value-keyed and shared across every cube for the
     *  app's lifetime — only the per-mesh geometry is owned by this instance. */
    static disposeMesh(mesh: THREE.Mesh): void {
        mesh.geometry.dispose();
    }
}
