import * as THREE from 'three';
import { ISLAND_TEXTURE_CONFIG } from '../world/MeshConfig';

/**
 * Builds a voxel-style BufferGeometry for a connected cluster of grid cells.
 *
 * Key properties:
 *  - Only outer faces are emitted; shared faces between adjacent cells are skipped.
 *  - roundEdges() adds a quarter-cylinder bevel at every convex outer vertical edge,
 *    so the blob as a whole gets rounded corners — not each individual cell.
 *
 * Coordinate convention:
 *  - originX / originZ  = world position of col=0 / row=0 corner of the grid.
 *  - height             = mesh extent above y=0.
 *  - depthBelow         = mesh extent below y=0 (pass 0 for a flat-top box).
 *
 * Usage:
 *   // Flat voxel mesh
 *   const geo = ClusterMeshBuilder.buildGeometry(island, cellSize, height, depthBelow, originX, originZ);
 *
 *   // Voxel mesh + rounded outer edges
 *   const geo = ClusterMeshBuilder.roundEdges(island, cellSize, height, depthBelow, originX, originZ, 0.2, 3);
 *
 *   const mesh = new THREE.Mesh(geo, material);
 *   // Geometry is in world space — no mesh.position offset needed.
 */
export class ClusterMeshBuilder {

    /**
     * Voxel face mesh with no rounding.
     * Use this when you want the exact blob silhouette but sharp edges.
     */
    static buildGeometry(
        cells: [number, number][],
        cellSize: number,
        height: number,
        depthBelow: number,
        originX: number,
        originZ: number,
    ): THREE.BufferGeometry {
        return ClusterMeshBuilder._build(cells, cellSize, height, depthBelow, originX, originZ, 0, 2);
    }


    /**
     * Voxel face mesh with quarter-cylinder bevels at all convex outer vertical edges.
     * Adjacent cells share a flat face (no rounding on the interior).
     * Only the outer corners of the whole blob are curved.
     *
     * @param radius    Bevel size in world units. Clamped to < cellSize/2 automatically.
     * @param segments  Polygon count per 90° arc. 2 = angular, 3–4 = smooth.
     */
    static roundEdges(
        cells: [number, number][],
        cellSize: number,
        height: number,
        depthBelow: number,
        originX: number,
        originZ: number,
        radius: number,
        segments = 3,
    ): THREE.BufferGeometry {
        const totalH = height + depthBelow;
        const maxR = Math.min(cellSize / 2, totalH / 2) - 0.01;
        const r = Math.min(radius, Math.max(0, maxR));
        return ClusterMeshBuilder._build(cells, cellSize, height, depthBelow, originX, originZ, r, segments);
    }

    // ── Internal ──────────────────────────────────────────────────────────────

    private static _build(
        cells: [number, number][],
        cs: number,
        height: number,
        depthBelow: number,
        originX: number,
        originZ: number,
        radius: number,
        segments: number,
    ): THREE.BufferGeometry {
        const cellSet = new Set(cells.map(([c, r]) => `${c},${r}`));
        const has = (c: number, r: number) => cellSet.has(`${c},${r}`);

        const pos: number[] = [];
        const nor: number[] = [];
        const uv: number[] = [];
        const idx: number[] = [];

        const yTop = height;
        const yBot = -depthBelow;
        const r = radius;

        // World units the sand texture covers before it just stretches to fill
        // whatever's left — see sideFace()/bevel() below.
        const TILE = ISLAND_TEXTURE_CONFIG.tileSize;

        // ── Quad / triangle helpers ────────────────────────────────────────────
        const quad = (
            ax: number, ay: number, az: number,
            bx: number, by: number, bz: number,
            cx: number, cy: number, cz: number,
            dx: number, dy: number, dz: number,
            nx: number, ny: number, nz: number,
            uA: number, vA: number,
            uB: number, vB: number,
            uC: number, vC: number,
            uD: number, vD: number,
        ) => {
            const i = pos.length / 3;
            pos.push(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz);
            nor.push(nx, ny, nz, nx, ny, nz, nx, ny, nz, nx, ny, nz);
            uv.push(uA, vA, uB, vB, uC, vC, uD, vD);
            idx.push(i, i + 1, i + 2, i, i + 2, i + 3);
        };

        const tri = (
            ax: number, ay: number, az: number,
            bx: number, by: number, bz: number,
            cx: number, cy: number, cz: number,
            nx: number, ny: number, nz: number,
            uA: number, vA: number,
            uB: number, vB: number,
            uC: number, vC: number,
        ) => {
            const i = pos.length / 3;
            pos.push(ax, ay, az, bx, by, bz, cx, cy, cz);
            nor.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
            uv.push(uA, vA, uB, vB, uC, vC);
            idx.push(i, i + 1, i + 2);
        };

        // ── Side face helper ───────────────────────────────────────────────────
        // Texture atlas (see ISLAND_TEXTURE_CONFIG in MeshConfig.ts): left column
        // [U 0–0.5] = sand — collar (V 0.5–1) over tile (V 0–0.5). The top TILE
        // world units render the collar at 1:1 scale (it borders the visible grass
        // edge); everything below — usually underground — squashes/stretches the
        // tile art to fill whatever height remains, since it's rarely seen.
        // (ax,az)/(bx,bz) = the face's two vertical edges; u0/u1 = their U coord.
        const sideFace = (
            ax: number, az: number,
            bx: number, bz: number,
            nx: number, ny: number, nz: number,
            u0: number, u1: number,
        ) => {
            const totalH = yTop - yBot;
            const collarH = Math.min(TILE, totalH);
            const yMid = yTop - collarH;
            const vMid = 1 - (collarH / TILE) * 0.5;

            quad(ax, yTop, az, bx, yTop, bz, bx, yMid, bz, ax, yMid, az, nx, ny, nz,
                 u0, 1, u1, 1, u1, vMid, u0, vMid);

            if (yMid > yBot) {
                quad(ax, yMid, az, bx, yMid, bz, bx, yBot, bz, ax, yBot, az, nx, ny, nz,
                     u0, 0.5, u1, 0.5, u1, 0, u0, 0);
            }
        };

        // ── Bevel column helper ───────────────────────────────────────────────
        // Emits a quarter-cylinder strip from yBot to yTop, split into the same
        // collar/tile bands as sideFace() so a rounded corner matches the flat
        // faces it joins instead of showing one unified stretch.
        // (cx, cz) = arc centre; a0→a1 = angle range in radians.
        // Per-vertex normals give smooth shading across the curve.
        const bevel = (cx: number, cz: number, a0: number, a1: number) => {
            const pts: [number, number, number, number][] = [];
            for (let s = 0; s <= segments; s++) {
                const a = a0 + (a1 - a0) * (s / segments);
                const ca = Math.cos(a), sa = Math.sin(a);
                pts.push([cx + ca * r, cz + sa * r, ca, sa]);
            }

            const totalH = yTop - yBot;
            const collarH = Math.min(TILE, totalH);
            const yMid = yTop - collarH;
            const vMid = 1 - (collarH / TILE) * 0.5;

            for (let s = 0; s < segments; s++) {
                const [bx0, bz0, bnx0, bnz0] = pts[s];
                const [bx1, bz1, bnx1, bnz1] = pts[s + 1];
                const i = pos.length / 3;
                // CCW winding verified for each quadrant in implementation notes
                pos.push(bx0, yTop, bz0, bx1, yTop, bz1, bx1, yMid, bz1, bx0, yMid, bz0);
                nor.push(bnx0, 0, bnz0, bnx1, 0, bnz1, bnx1, 0, bnz1, bnx0, 0, bnz0);
                uv.push(0, 1, 0.25, 1, 0.25, vMid, 0, vMid); // bevel uses sand region
                idx.push(i, i + 1, i + 2, i, i + 2, i + 3);

                if (yMid > yBot) {
                    const j = pos.length / 3;
                    pos.push(bx0, yMid, bz0, bx1, yMid, bz1, bx1, yBot, bz1, bx0, yBot, bz0);
                    nor.push(bnx0, 0, bnz0, bnx1, 0, bnz1, bnx1, 0, bnz1, bnx0, 0, bnz0);
                    uv.push(0, 0.5, 0.25, 0.5, 0.25, 0, 0, 0);
                    idx.push(j, j + 1, j + 2, j, j + 2, j + 3);
                }
            }
        };

        // Arc points for chamfering a convex corner of the TOP face — the same
        // quarter-circle as the bevel column below it, so the top face's outline
        // never overhangs past the rounded corner. Returned in a0→a1 angle order;
        // callers reverse this to match the top-face perimeter's winding direction.
        const arcPts = (cx: number, cz: number, a0: number, a1: number): [number, number][] => {
            const out: [number, number][] = [];
            for (let s = 0; s <= segments; s++) {
                const a = a0 + (a1 - a0) * (s / segments);
                out.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]);
            }
            return out;
        };

        // ── Per-cell face emission ────────────────────────────────────────────

        for (const [col, row] of cells) {
            const x0 = originX + col * cs;
            const x1 = originX + (col + 1) * cs;
            const z0 = originZ + row * cs;
            const z1 = originZ + (row + 1) * cs;

            // A corner is "convex" when both neighbouring cells along its two edges
            // are absent — meaning the mesh has an outward 90° turn there.
            const cvxNW = r > 0 && !has(col - 1, row) && !has(col, row - 1);
            const cvxNE = r > 0 && !has(col + 1, row) && !has(col, row - 1);
            const cvxSW = r > 0 && !has(col - 1, row) && !has(col, row + 1);
            const cvxSE = r > 0 && !has(col + 1, row) && !has(col, row + 1);

            // Shortening amount per corner: push the flat face back by r so the
            // bevel column fills in the gap without overlapping the flat face.
            const rnw = cvxNW ? r : 0;
            const rne = cvxNE ? r : 0;
            const rsw = cvxSW ? r : 0;
            const rse = cvxSE ? r : 0;

            // Top face (+Y) — grass quadrant [U 0.5–1, V 0.5–1]. Convex corners are
            // chamfered with the same arc as the bevel column beneath them (instead
            // of the plain NW/SW/SE/NW square), then fan-triangulated; with no
            // rounding this reduces to the exact same two triangles as a flat quad.
            // Bottom faces are never visible (mesh sits on/above the floor) so
            // they're not emitted.
            const perim: [number, number][] = [];
            if (cvxNW) perim.push(...arcPts(x0 + r, z0 + r, Math.PI, Math.PI * 1.5).reverse());
            else perim.push([x0, z0]);
            if (cvxSW) perim.push(...arcPts(x0 + r, z1 - r, Math.PI * 0.5, Math.PI).reverse());
            else perim.push([x0, z1]);
            if (cvxSE) perim.push(...arcPts(x1 - r, z1 - r, 0, Math.PI * 0.5).reverse());
            else perim.push([x1, z1]);
            if (cvxNE) perim.push(...arcPts(x1 - r, z0 + r, Math.PI * 1.5, Math.PI * 2).reverse());
            else perim.push([x1, z0]);

            const topUv = (px: number, pz: number): [number, number] => [
                0.5 + ((px - x0) / cs) * 0.5,
                0.5 + ((pz - z0) / cs) * 0.5,
            ];

            for (let i = 1; i < perim.length - 1; i++) {
                const [p0x, p0z] = perim[0];
                const [pix, piz] = perim[i];
                const [pjx, pjz] = perim[i + 1];
                const [u0v, v0v] = topUv(p0x, p0z);
                const [uiv, viv] = topUv(pix, piz);
                const [ujv, vjv] = topUv(pjx, pjz);
                tri(p0x, yTop, p0z, pix, yTop, piz, pjx, yTop, pjz, 0, 1, 0,
                    u0v, v0v, uiv, viv, ujv, vjv);
            }

            // North side (-Z): skip if north neighbour is in the cluster
            if (!has(col, row - 1)) {
                const uR = ((cs - rnw - rne) / cs) * 0.5;
                sideFace(x0 + rnw, z0, x1 - rne, z0, 0, 0, -1, 0, uR);
            }

            // South side (+Z): skip if south neighbour is in the cluster
            if (!has(col, row + 1)) {
                const uR = ((cs - rsw - rse) / cs) * 0.5;
                sideFace(x1 - rse, z1, x0 + rsw, z1, 0, 0, 1, uR, 0);
            }

            // West side (-X): skip if west neighbour is in the cluster
            if (!has(col - 1, row)) {
                const uR = ((cs - rsw - rnw) / cs) * 0.5;
                sideFace(x0, z1 - rsw, x0, z0 + rnw, -1, 0, 0, uR, 0);
            }

            // East side (+X): skip if east neighbour is in the cluster
            if (!has(col + 1, row)) {
                const uR = ((cs - rne - rse) / cs) * 0.5;
                sideFace(x1, z0 + rne, x1, z1 - rse, 1, 0, 0, 0, uR);
            }

            // Bevel columns at convex outer vertical edges (no-op when r === 0)
            // Angle ranges place each arc in the correct outward-facing quadrant.
            if (cvxNW) bevel(x0 + r, z0 + r, Math.PI, Math.PI * 1.5);  // W→N arc
            if (cvxNE) bevel(x1 - r, z0 + r, Math.PI * 1.5, Math.PI * 2.0);  // N→E arc
            if (cvxSW) bevel(x0 + r, z1 - r, Math.PI * 0.5, Math.PI * 1.0);  // S→W arc
            if (cvxSE) bevel(x1 - r, z1 - r, 0, Math.PI * 0.5);  // E→S arc
        }

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
        geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        geo.setIndex(idx);
        return geo;
    }
}
