import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { BendService } from "../services/BendService";
import { formatValue } from "../ClogConstants";
import { TextureBuilder } from "./TextureBuilder";

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
    private static numberTexCache = new Map<number, THREE.CanvasTexture>();
    // Single shared material for the face decal plane — value-independent
    // (transparent overlay, not baked per colour), so unlike the caches above
    // this isn't keyed by value.
    private static faceDecalMat: THREE.MeshStandardMaterial | null = null;
    private static readonly FACE_DECAL_NAME = 'faceDecal';

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

    private static getFaceDecalMaterial(): THREE.MeshStandardMaterial {
        if (!CubeBuilder.faceDecalMat) {
            const mat = new THREE.MeshStandardMaterial({
                map: TextureBuilder.face(),
                transparent: false,
                alphaTest: 0.5,
            });
            BendService.applyBend(mat);
            CubeBuilder.faceDecalMat = mat;
        }
        return CubeBuilder.faceDecalMat;
    }

    /** Thin quad sitting just in front of the cube's +Z face — kept as a
     *  separate child mesh (not baked into the cube's material) so the face
     *  art can be swapped independently of the cube's colour. */
    private static buildFaceDecal(size: number): THREE.Mesh {
        const decalSize = size * 0.85;
        const geo = new THREE.PlaneGeometry(decalSize, decalSize);
        const mesh = new THREE.Mesh(geo, CubeBuilder.getFaceDecalMaterial());
        mesh.name = CubeBuilder.FACE_DECAL_NAME;
        mesh.position.z = size / 2 + size * 0.01;
        return mesh;
    }

    private static getNumberTexture(value: number): THREE.CanvasTexture {
        let tex = CubeBuilder.numberTexCache.get(value);
        if (!tex) {
            tex = CubeBuilder.makeNumberTexture(value, colorForValue(value));
            CubeBuilder.numberTexCache.set(value, tex);
        }
        return tex;
    }

    /** Rounded cube with number on top face (+Y = index 2). */
    static buildNumbered(value: number, size = 1): THREE.Mesh {
        const geo = new RoundedBoxGeometry(size, size, size, 4, size * 0.25);
        const solid = CubeBuilder.getSolidMaterial(value);
        const top = CubeBuilder.getTopMaterial(value);
        // face order: +X, -X, +Y (top), -Y, +Z (front), -Z
        return new THREE.Mesh(geo, [solid, solid, top, solid, solid, solid]);
    }

    /** Rounded cube with a face-decal plane in front of +Z and number on top (+Y = index 2). */
    static buildPlayer(value: number, size = 1): THREE.Mesh {
        const geo = new RoundedBoxGeometry(size, size, size, 4, size * 0.25);
        const solid = CubeBuilder.getSolidMaterial(value);
        const top = CubeBuilder.getTopMaterial(value);
        // face order: +X, -X, +Y (top), -Y, +Z (front), -Z
        const mesh = new THREE.Mesh(geo, [solid, solid, top, solid, solid, solid]);
        mesh.add(CubeBuilder.buildFaceDecal(size));
        return mesh;
    }

    /**
     * Swap an existing cube mesh onto the (cached, shared) materials for its new
     * value. Never mutates a material in place — these are shared across every
     * cube at that value, so mutating one would repaint every other cube too.
     * The face decal (if any) is value-independent, so it's left untouched —
     * only added/removed to match `hasFace`.
     */
    static updateTextures(mesh: THREE.Mesh, value: number, hasFace: boolean): void {
        const solid = CubeBuilder.getSolidMaterial(value);
        const top = CubeBuilder.getTopMaterial(value);
        mesh.material = [solid, solid, top, solid, solid, solid];

        // Geometry is always built at size=1 and scaled via mesh.scale afterwards
        // (see buildPlayer/buildNumbered callers), so the decal can assume size=1 too.
        const existingDecal = mesh.getObjectByName(CubeBuilder.FACE_DECAL_NAME);
        if (hasFace && !existingDecal) {
            mesh.add(CubeBuilder.buildFaceDecal(1));
        } else if (!hasFace && existingDecal) {
            mesh.remove(existingDecal);
            (existingDecal as THREE.Mesh).geometry.dispose();
        }
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

    /** Materials/textures are value-keyed and shared across every cube for the
     *  app's lifetime — only the per-mesh geometry (and the face decal's own
     *  geometry, if present) is owned by this instance. */
    static disposeMesh(mesh: THREE.Mesh): void {
        const decal = mesh.getObjectByName(CubeBuilder.FACE_DECAL_NAME) as THREE.Mesh | undefined;
        decal?.geometry.dispose();
        mesh.geometry.dispose();
    }
}
