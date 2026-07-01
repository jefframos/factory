import * as THREE from 'three';

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


    static roundAllEdges(
        cells: [number, number][],
        cellSize: number,
        height: number,
        depthBelow: number,
        originX: number,
        originZ: number,
        radius: number,
        segments = 4,
    ): THREE.BufferGeometry {
        const totalH = height + depthBelow;
        const r = Math.min(radius, cellSize * 0.45, totalH * 0.45);

        const cellSet = new Set(cells.map(([c, r]) => `${c},${r}`));
        const edges: Array<[[number, number], [number, number]]> = [];

        const has = (c: number, r: number) => cellSet.has(`${c},${r}`);

        for (const [col, row] of cells) {
            const x0 = originX + col * cellSize;
            const x1 = originX + (col + 1) * cellSize;
            const z0 = originZ + row * cellSize;
            const z1 = originZ + (row + 1) * cellSize;

            if (!has(col, row - 1)) edges.push([[x0, z0], [x1, z0]]);
            if (!has(col + 1, row)) edges.push([[x1, z0], [x1, z1]]);
            if (!has(col, row + 1)) edges.push([[x1, z1], [x0, z1]]);
            if (!has(col - 1, row)) edges.push([[x0, z1], [x0, z0]]);
        }

        const key = (p: [number, number]) => `${p[0]},${p[1]}`;
        const edgeMap = new Map<string, [number, number]>();

        for (const [a, b] of edges) {
            edgeMap.set(key(a), b);
        }

        const start = edges[0][0];
        const points: [number, number][] = [start];

        let current = start;

        while (true) {
            const next = edgeMap.get(key(current));
            if (!next) break;

            if (key(next) === key(start)) break;

            points.push(next);
            current = next;
        }

        const shape = new THREE.Shape();

        for (let i = 0; i < points.length; i++) {
            const prev = points[(i - 1 + points.length) % points.length];
            const curr = points[i];
            const next = points[(i + 1) % points.length];

            const v1x = curr[0] - prev[0];
            const v1z = curr[1] - prev[1];
            const v2x = next[0] - curr[0];
            const v2z = next[1] - curr[1];

            const len1 = Math.hypot(v1x, v1z);
            const len2 = Math.hypot(v2x, v2z);

            const p1: [number, number] = [
                curr[0] - (v1x / len1) * r,
                curr[1] - (v1z / len1) * r,
            ];

            const p2: [number, number] = [
                curr[0] + (v2x / len2) * r,
                curr[1] + (v2z / len2) * r,
            ];

            if (i === 0) {
                shape.moveTo(p1[0], p1[1]);
            } else {
                shape.lineTo(p1[0], p1[1]);
            }

            shape.quadraticCurveTo(curr[0], curr[1], p2[0], p2[1]);
        }

        shape.closePath();

        const geo = new THREE.ExtrudeGeometry(shape, {
            depth: totalH,
            bevelEnabled: true,
            bevelSize: r,
            bevelThickness: r,
            bevelSegments: segments,
            curveSegments: segments,
            steps: 1,
        });

        geo.rotateX(Math.PI / 2);
        geo.translate(0, height, 0);

        geo.computeVertexNormals();

        return geo;
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

    /**
     * Remaps UV coordinates on geometry produced by roundAllEdges to match the island
     * texture atlas: U∈[0.5,1] = grass (top faces), U∈[0,0.5] = sand (side/bottom).
     * ExtrudeGeometry generates world-space UVs that don't respect the atlas split,
     * so this must be called after roundAllEdges when texture:'island' is used.
     */
    static applyIslandAtlasUVs(
        geo: THREE.BufferGeometry,
        height: number,
        depthBelow: number,
    ): void {
        geo.computeVertexNormals();
        const pos    = geo.attributes.position.array as Float32Array;
        const nor    = geo.attributes.normal.array as Float32Array;
        const count  = pos.length / 3;
        const totalH = height + depthBelow;

        // Bounding box of top-face vertices — used to map the grass texture
        // across the whole cluster without any tile-boundary seams.
        let minX = Infinity, maxX = -Infinity;
        let minZ = Infinity, maxZ = -Infinity;
        for (let i = 0; i < count; i++) {
            if (nor[i * 3 + 1] > 0.5) {
                minX = Math.min(minX, pos[i * 3 + 0]);
                maxX = Math.max(maxX, pos[i * 3 + 0]);
                minZ = Math.min(minZ, pos[i * 3 + 2]);
                maxZ = Math.max(maxZ, pos[i * 3 + 2]);
            }
        }
        const spanX = maxX - minX || 1;
        const spanZ = maxZ - minZ || 1;

        const uvs  = new Float32Array(count * 2);
        const TILE = 2; // world units per sand texture repeat on side faces

        for (let i = 0; i < count; i++) {
            const px = pos[i * 3 + 0];
            const py = pos[i * 3 + 1];
            const pz = pos[i * 3 + 2];
            const nx = nor[i * 3 + 0];
            const ny = nor[i * 3 + 1];
            const nz = nor[i * 3 + 2];

            if (ny > 0.5) {
                // Top face → grass [U 0.5–1.0], one mapping across the whole cluster.
                uvs[i * 2 + 0] = 0.5 + ((px - minX) / spanX) * 0.5;
                uvs[i * 2 + 1] = (pz - minZ) / spanZ;
            } else {
                // Sides → sand [U 0.0–0.5], V from height, tiled along the face.
                const along = Math.abs(nz) > Math.abs(nx) ? px : pz;
                uvs[i * 2 + 0] = (((along / TILE) % 1) + 1) % 1 * 0.5;
                uvs[i * 2 + 1] = totalH > 0 ? (py + depthBelow) / totalH : 0.5;
            }
        }
        geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
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

        // ── Quad helper ───────────────────────────────────────────────────────
        // Texture atlas: left half [U 0–0.5] = sand (sides), right half [U 0.5–1] = grass (top).
        // UV params: (uA,vA), (uB,vB), (uC,vC), (uD,vD) — one per vertex in order A B C D.
        // On side faces: v=1 → yTop (where grass cap starts), v=0 → yBot (deep side).
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

        // ── Bevel column helper ───────────────────────────────────────────────
        // Emits a quarter-cylinder strip from yBot to yTop.
        // (cx, cz) = arc centre; a0→a1 = angle range in radians.
        // Per-vertex normals give smooth shading across the curve.
        const bevel = (cx: number, cz: number, a0: number, a1: number) => {
            const pts: [number, number, number, number][] = [];
            for (let s = 0; s <= segments; s++) {
                const a = a0 + (a1 - a0) * (s / segments);
                const ca = Math.cos(a), sa = Math.sin(a);
                pts.push([cx + ca * r, cz + sa * r, ca, sa]);
            }
            for (let s = 0; s < segments; s++) {
                const [bx0, bz0, bnx0, bnz0] = pts[s];
                const [bx1, bz1, bnx1, bnz1] = pts[s + 1];
                const i = pos.length / 3;
                // CCW winding verified for each quadrant in implementation notes
                pos.push(bx0, yTop, bz0, bx1, yTop, bz1, bx1, yBot, bz1, bx0, yBot, bz0);
                nor.push(bnx0, 0, bnz0, bnx1, 0, bnz1, bnx1, 0, bnz1, bnx0, 0, bnz0);
                uv.push(0, 1, 0.25, 1, 0.25, 0, 0, 0); // bevel uses sand region
                idx.push(i, i + 1, i + 2, i, i + 2, i + 3);
            }
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

            // Top face (+Y) — grass atlas region [U 0.5–1.0]
            quad(x0, yTop, z0, x0, yTop, z1, x1, yTop, z1, x1, yTop, z0, 0, 1, 0,
                 0.5, 0,  0.5, 1,  1.0, 1,  1.0, 0);

            // Bottom face (-Y) — sand region (not typically visible)
            quad(x0, yBot, z0, x1, yBot, z0, x1, yBot, z1, x0, yBot, z1, 0, -1, 0,
                 0, 0,  0.5, 0,  0.5, 1,  0, 1);

            // North side (-Z): skip if north neighbour is in the cluster
            if (!has(col, row - 1)) {
                const uR = ((cs - rnw - rne) / cs) * 0.5;
                quad(x0 + rnw, yTop, z0, x1 - rne, yTop, z0, x1 - rne, yBot, z0, x0 + rnw, yBot, z0, 0, 0, -1,
                     0, 1,  uR, 1,  uR, 0,  0, 0);
            }

            // South side (+Z): skip if south neighbour is in the cluster
            if (!has(col, row + 1)) {
                const uR = ((cs - rsw - rse) / cs) * 0.5;
                quad(x1 - rse, yTop, z1, x0 + rsw, yTop, z1, x0 + rsw, yBot, z1, x1 - rse, yBot, z1, 0, 0, 1,
                     uR, 1,  0, 1,  0, 0,  uR, 0);
            }

            // West side (-X): skip if west neighbour is in the cluster
            if (!has(col - 1, row)) {
                const uR = ((cs - rsw - rnw) / cs) * 0.5;
                quad(x0, yTop, z1 - rsw, x0, yTop, z0 + rnw, x0, yBot, z0 + rnw, x0, yBot, z1 - rsw, -1, 0, 0,
                     uR, 1,  0, 1,  0, 0,  uR, 0);
            }

            // East side (+X): skip if east neighbour is in the cluster
            if (!has(col + 1, row)) {
                const uR = ((cs - rne - rse) / cs) * 0.5;
                quad(x1, yTop, z0 + rne, x1, yTop, z1 - rse, x1, yBot, z1 - rse, x1, yBot, z0 + rne, 1, 0, 0,
                     0, 1,  uR, 1,  uR, 0,  0, 0);
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
