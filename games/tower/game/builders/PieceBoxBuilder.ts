import * as THREE from 'three';
import { getPolygonCentroid } from '../../tw/PieceStorage';
import { BendService } from '../services/BendService';
import { TextureBuilder } from './TextureBuilder';

/** Unit-square-space point (0..1, top-left origin) — see PieceDefinition.polygon. */
export interface UnitPoint {
    x: number;
    y: number;
}

export interface PieceBoxOptions {
    /** Depth (Z thickness) — defaults to the shorter of width/height so a wide or tall piece reads as a flat plate rather than stretching along the camera axis. */
    depth?: number;
    faceTexture?: THREE.Texture;
    /** Outline override, same unit-square points as PieceDefinition.polygon — drawn instead of the default beveled rect when present. */
    polygon?: UnitPoint[];
    /** Corner-fillet radius as a fraction of the shorter of width/height — see FaceTowerConfig.pieceBevelRadiusRatio. Defaults to 0.15. */
    bevelRadiusRatio?: number;
    /** How far the bevel extrudes outward, as a fraction of min(depth, bevel radius) — see FaceTowerConfig.pieceBevelThicknessRatio. Defaults to 0.5. */
    bevelThicknessRatio?: number;
}

/** Default outline for a plain rect piece — the box path is just this polygon run through the same extrude/fillet code as a custom `polygon`. */
const RECT_POLYGON: UnitPoint[] = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
];

/**
 * Builds the 3D visual for a tower piece (see PieceStorage) — a flat colored
 * extruded outline (a rect by default, or any `polygon` override) with a
 * face-decal plane in front, same overall look as CubeBuilder's cubes.
 * Both shapes go through the same filleted-extrude path (mirrors
 * games/net/netgame/services/GeometryFactory3D.createPolygon()) instead of
 * RoundedBoxGeometry, which requires its radius to be less than half of
 * EVERY dimension including depth — that produces NaN geometry once a
 * piece's width/height stop being roughly equal (see PieceStorage's
 * per-axis `scale`).
 */
export class PieceBoxBuilder {
    private static readonly FACE_DECAL_NAME = 'faceDecal';

    private static faceDecalMat?: THREE.MeshStandardMaterial;

    /**
     * Incremented once per build() call and folded into that piece's face
     * decal Z — two decal planes that would otherwise land at the EXACT same
     * world Z (e.g. two pieces sharing the same depth/bevel, so their fronts
     * compute to an identical frontZ) still get distinct, monotonically
     * increasing Z values instead of truly coinciding, which is what causes
     * z-fighting (flickering as the renderer can't consistently decide which
     * coplanar triangle is "in front").
     */
    private static nextZOrder = 0;

    /**
     * Never cached: call disposeMesh() yourself, and dispose the returned
     * mesh's (single, non-array) body material once you're done with it —
     * same contract as CubeBuilder.buildDebugCube.
     */
    static build(
        color: THREE.ColorRepresentation,
        width: number,
        height: number,
        options: PieceBoxOptions = {},
    ): THREE.Mesh {
        const depth = options.depth ?? Math.min(width, height);
        const { geometry, frontZ } = PieceBoxBuilder.buildOutlineGeometry(
            options.polygon ?? RECT_POLYGON,
            width, height, depth,
            options.bevelRadiusRatio ?? 0.15,
            options.bevelThicknessRatio ?? 0.5,
        );

        const mat = new THREE.MeshStandardMaterial({ color });
        BendService.applyBend(mat);

        const mesh = new THREE.Mesh(geometry, mat);
        const zOrderEpsilon = PieceBoxBuilder.nextZOrder++ * 0.00001;

        mesh.add(PieceBoxBuilder.buildFaceDecal(frontZ, width, height, options.faceTexture, zOrderEpsilon));

        return mesh;
    }

    /**
     * Converts unit-square points (0..1, top-left origin, matching
     * BlockBodyTextureCache's 2D polygon — a plain rect by default) to a
     * centered THREE.Shape — filleting each corner via quadraticCurveTo,
     * same fillet math as GeometryFactory3D.createPolygon() — then extrudes
     * it to `depth`. `radius` is a fraction of the shorter axis and
     * additionally clamped per-corner to half its adjacent edge lengths, so
     * it can never overshoot a short edge into self-intersection.
     *
     * Returns `frontZ`, the actual outermost Z of the extruded front face —
     * NOT simply depth/2, since a beveled extrude bulges outward past
     * `depth` by `bevelThickness` on each end. The face decal must sit at or
     * past `frontZ` or the bevel's bulge clips through it.
     *
     * Centered on the polygon's own area centroid (see
     * PieceStorage.getPolygonCentroid), NOT the unit-square midpoint — this
     * mesh's local origin (0,0,0) is what TowerBlockSync3D maps to the 2D
     * physics body's position, and Matter.js always treats a polygon body's
     * position as its vertex centroid (see FaceTowerBlockController's
     * PolygonEntity path). For the default rect those are the same point,
     * but for an asymmetric `polygon` they aren't — centering on the
     * midpoint instead would visibly drift the mesh away from where the
     * piece actually collides.
     *
     * The extrude bevel is skipped entirely (bevel forced to 0, so
     * frontZ = depth/2 exactly) for CONCAVE outlines — an arch's notch or a
     * ramp's scooped curve (see PieceStorage) — because THREE's
     * ExtrudeGeometry bevel offsets each vertex along its local outward
     * normal, and at a concave/reflex corner that offset points INWARD,
     * which can self-intersect or get silently clamped. The visible result
     * was concave pieces reading as a different actual depth than convex
     * ones (rect, triangle, dome, cylinder) even with identical
     * depth/bevel inputs. Skipping the bevel for concave shapes keeps
     * `frontZ` — and so the true rendered thickness — consistent across
     * every piece; convex shapes keep the full beveled look unchanged.
     */
    private static buildOutlineGeometry(
        polygon: UnitPoint[], width: number, height: number, depth: number,
        bevelRadiusRatio: number, bevelThicknessRatio: number,
    ): { geometry: THREE.BufferGeometry; frontZ: number } {
        const centroid = getPolygonCentroid(polygon);
        const vertices = polygon.map(p => ({
            x: (p.x - centroid.x) * width,
            y: (centroid.y - p.y) * height,
        }));

        const len = vertices.length;
        const radius = Math.min(width, height) * bevelRadiusRatio;
        const shape = new THREE.Shape();

        for (let i = 0; i < len; i++) {
            const p1 = vertices[i];
            const p2 = vertices[(i + 1) % len];
            const p3 = vertices[(i + 2) % len];

            const v1x = p1.x - p2.x, v1y = p1.y - p2.y;
            const v2x = p3.x - p2.x, v2y = p3.y - p2.y;
            const d1 = Math.hypot(v1x, v1y), d2 = Math.hypot(v2x, v2y);
            const r = Math.min(radius, d1 / 2, d2 / 2);

            const startX = p2.x + (v1x / d1) * r, startY = p2.y + (v1y / d1) * r;
            const endX = p2.x + (v2x / d2) * r, endY = p2.y + (v2y / d2) * r;

            if (i === 0) shape.moveTo(startX, startY);
            else shape.lineTo(startX, startY);
            shape.quadraticCurveTo(p2.x, p2.y, endX, endY);
        }

        shape.closePath();

        const isConvex = PieceBoxBuilder.isConvexPolygon(vertices);
        const bevel = isConvex ? Math.min(depth, radius) * bevelThicknessRatio : 0;

        const geo = new THREE.ExtrudeGeometry(shape, {
            depth,
            steps: 1,
            curveSegments: 16,
            bevelEnabled: bevel > 0,
            bevelThickness: bevel,
            bevelSize: bevel,
            bevelSegments: 3,
        });

        geo.translate(0, 0, -depth / 2);
        geo.computeVertexNormals();

        return { geometry: geo, frontZ: depth / 2 + bevel };
    }

    /** True if every corner turns the same way (no reflex/concave vertex) — checked on the pre-fillet vertices, since the fillet only rounds corners without changing the overall turning direction. */
    private static isConvexPolygon(vertices: { x: number; y: number }[]): boolean {
        const len = vertices.length;
        let sign = 0;

        for (let i = 0; i < len; i++) {
            const p1 = vertices[i];
            const p2 = vertices[(i + 1) % len];
            const p3 = vertices[(i + 2) % len];

            const cross = (p2.x - p1.x) * (p3.y - p2.y) - (p2.y - p1.y) * (p3.x - p2.x);
            if (Math.abs(cross) < 1e-9) {
                continue;
            }

            const crossSign = Math.sign(cross);
            if (sign === 0) {
                sign = crossSign;
            } else if (crossSign !== sign) {
                return false;
            }
        }

        return true;
    }

    /** Shared default face material (bots) — swapped for a one-off via `faceTexture` (the local player's equipped skin). */
    private static getFaceDecalMaterial(): THREE.MeshStandardMaterial {
        if (!PieceBoxBuilder.faceDecalMat) {
            const mat = new THREE.MeshStandardMaterial({
                map: TextureBuilder.face(),
                transparent: false,
                alphaTest: 0.5,
            });
            BendService.applyBend(mat);
            PieceBoxBuilder.faceDecalMat = mat;
        }
        return PieceBoxBuilder.faceDecalMat;
    }

    private static makeFaceDecalMaterial(texture: THREE.Texture): THREE.MeshStandardMaterial {
        const mat = new THREE.MeshStandardMaterial({ map: texture, transparent: false, alphaTest: 0.5 });
        BendService.applyBend(mat);
        return mat;
    }

    /**
     * Thin quad sitting just past the mesh's actual outermost +Z point —
     * kept square (sized off the shorter axis, same as
     * FaceTowerBlockController.styleBlockView's 2D face) so the art never
     * stretches on a non-square piece. `frontZ` must be the geometry's real
     * front (see buildOutlineGeometry) rather than depth/2, or the bevel's
     * outward bulge clips through the decal. `zOrderEpsilon` (see
     * PieceBoxBuilder.nextZOrder) nudges otherwise-identical Z values apart
     * so two pieces with the same depth/bevel don't z-fight.
     */
    private static buildFaceDecal(frontZ: number, width: number, height: number, faceTexture: THREE.Texture | undefined, zOrderEpsilon: number): THREE.Mesh {
        const decalSize = Math.min(width, height) * 0.85;
        const geo = new THREE.PlaneGeometry(decalSize, decalSize);
        const mat = faceTexture
            ? PieceBoxBuilder.makeFaceDecalMaterial(faceTexture)
            : PieceBoxBuilder.getFaceDecalMaterial();

        const mesh = new THREE.Mesh(geo, mat);
        mesh.name = PieceBoxBuilder.FACE_DECAL_NAME;
        mesh.position.z = frontZ + Math.min(width, height) * 0.01 + zOrderEpsilon;

        return mesh;
    }

    /** Swaps the face decal's texture on an already-built mesh — used once an async-loaded skin/piece texture finishes loading. Disposes the previous material first unless it's the shared default. */
    static setFaceTexture(mesh: THREE.Mesh, texture: THREE.Texture): void {
        const decal = mesh.getObjectByName(PieceBoxBuilder.FACE_DECAL_NAME) as THREE.Mesh | undefined;
        if (!decal) return;

        const prevMat = decal.material as THREE.MeshStandardMaterial;
        decal.material = PieceBoxBuilder.makeFaceDecalMaterial(texture);
        if (prevMat !== PieceBoxBuilder.faceDecalMat) prevMat.dispose();
    }

    /** Materials/geometry here are never shared across meshes (unlike CubeBuilder's value-keyed caches), so both the box and its face decal need disposing — the one exception is the shared default face material. */
    static disposeMesh(mesh: THREE.Mesh): void {
        const decal = mesh.getObjectByName(PieceBoxBuilder.FACE_DECAL_NAME) as THREE.Mesh | undefined;
        if (decal) {
            decal.geometry.dispose();
            const decalMat = decal.material as THREE.MeshStandardMaterial;
            if (decalMat !== PieceBoxBuilder.faceDecalMat) decalMat.dispose();
        }

        mesh.geometry.dispose();
    }
}
