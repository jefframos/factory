import * as THREE from "three";
import { BendService, WorldBendService } from "../services/BendService";

export class FloorBuilder {
    /**
     * `segments` is vertices-per-side (uniform grid resolution, matching
     * PlaneGeometry's own convention). `centerBias` reshapes WHERE those
     * vertices land: 1 = perfectly uniform spacing (the hub's own floor,
     * unchanged); > 1 clusters more of them near the center (x=0, z=0) and
     * fewer toward the edges — the runner minigames use this so there's
     * enough vertex density right where the player actually is for
     * RunnerBendService's wave bend to look smooth, without paying for
     * that same density all the way out to the floor's rarely-seen edges.
     *
     * UVs are computed from each vertex's actual WORLD position, not its
     * (non-uniform) grid index, so the grid TEXTURE still tiles as true
     * 1-world-unit squares everywhere regardless of centerBias.
     */
    static build(scene: THREE.Scene, size = 30, cx = 0, cz = 0, bendService: WorldBendService = BendService, segments = 32, centerBias = 1): THREE.Mesh {
        const geo = FloorBuilder.buildGeometry(size, segments, centerBias);
        // DoubleSide: this geometry is hand-built (not THREE.PlaneGeometry), so rather than
        // rely on getting the triangle winding exactly right, this guarantees the floor
        // renders regardless of which way its face normals ended up pointing.
        const mat = new THREE.MeshBasicMaterial({ map: FloorBuilder.makeGridTexture(size), side: THREE.DoubleSide });
        bendService.applyBend(mat);
        const floor = new THREE.Mesh(geo, mat);
        floor.rotation.x = -Math.PI / 2;
        floor.position.set(cx, 0, cz);
        scene.add(floor);
        return floor;
    }

    /**
     * A plain (uniform, no centerBias) rectangular strip — width along X,
     * depth along Z — meant for a sidewalk running alongside a lane rather
     * than the lane's own (square) floor. Same world-position-based UVs as
     * build()'s own square geometry (see that method's own doc), so a
     * caller can assign their own tiled texture and it'll line up cleanly
     * either way.
     */
    static buildRect(scene: THREE.Scene, width: number, depth: number, cx = 0, cz = 0, bendService: WorldBendService = BendService, segmentsX = 8, segmentsZ = 32): THREE.Mesh {
        const geo = FloorBuilder.buildRectGeometry(width, depth, segmentsX, segmentsZ);
        const mat = new THREE.MeshBasicMaterial({ map: FloorBuilder.makeGridTexture(width, depth), side: THREE.DoubleSide });
        bendService.applyBend(mat);
        const strip = new THREE.Mesh(geo, mat);
        strip.rotation.x = -Math.PI / 2;
        strip.position.set(cx, 0, cz);
        scene.add(strip);
        return strip;
    }

    /** Maps a uniformly-spaced parameter t in [-1, 1] to a center-biased coordinate in the same range — centerBias=1 is the identity (uniform); > 1 compresses samples toward 0 and spreads them out near +/-1. */
    private static biasedCoord(t: number, centerBias: number): number {
        return Math.sign(t) * Math.pow(Math.abs(t), centerBias);
    }

    private static buildGeometry(size: number, segments: number, centerBias: number): THREE.BufferGeometry {
        const half = size / 2;
        const vertsPerSide = segments + 1;
        const positions = new Float32Array(vertsPerSide * vertsPerSide * 3);
        const uvs = new Float32Array(vertsPerSide * vertsPerSide * 2);

        // Built directly in local XY (matching THREE.PlaneGeometry's own convention) — the
        // Mesh's own rotation.x = -PI/2 (see build()) is what turns this into the horizontal
        // floor plane, exactly as it already did for the plain PlaneGeometry this replaces.
        for (let iy = 0; iy <= segments; iy++) {
            const ty = (iy / segments) * 2 - 1;
            const localY = FloorBuilder.biasedCoord(ty, centerBias) * half;
            for (let ix = 0; ix <= segments; ix++) {
                const tx = (ix / segments) * 2 - 1;
                const localX = FloorBuilder.biasedCoord(tx, centerBias) * half;

                const i = iy * vertsPerSide + ix;
                positions[i * 3 + 0] = localX;
                positions[i * 3 + 1] = localY;
                positions[i * 3 + 2] = 0;

                uvs[i * 2 + 0] = localX / size + 0.5;
                uvs[i * 2 + 1] = localY / size + 0.5;
            }
        }

        const indices: number[] = [];
        for (let iy = 0; iy < segments; iy++) {
            for (let ix = 0; ix < segments; ix++) {
                const a = ix + vertsPerSide * iy;
                const b = ix + vertsPerSide * (iy + 1);
                const c = (ix + 1) + vertsPerSide * (iy + 1);
                const d = (ix + 1) + vertsPerSide * iy;
                indices.push(a, b, d, b, c, d);
            }
        }

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
        geo.setIndex(indices);
        return geo;
    }

    /** Same idea as buildGeometry(), but width (X) and depth (Z) independently — no centerBias, since a sidewalk strip doesn't need extra density anywhere in particular. */
    private static buildRectGeometry(width: number, depth: number, segmentsX: number, segmentsZ: number): THREE.BufferGeometry {
        const vertsX = segmentsX + 1;
        const vertsZ = segmentsZ + 1;
        const positions = new Float32Array(vertsX * vertsZ * 3);
        const uvs = new Float32Array(vertsX * vertsZ * 2);

        for (let iz = 0; iz <= segmentsZ; iz++) {
            const localY = (iz / segmentsZ - 0.5) * depth;
            for (let ix = 0; ix <= segmentsX; ix++) {
                const localX = (ix / segmentsX - 0.5) * width;

                const i = iz * vertsX + ix;
                positions[i * 3 + 0] = localX;
                positions[i * 3 + 1] = localY;
                positions[i * 3 + 2] = 0;

                uvs[i * 2 + 0] = localX / width + 0.5;
                uvs[i * 2 + 1] = localY / depth + 0.5;
            }
        }

        const indices: number[] = [];
        for (let iz = 0; iz < segmentsZ; iz++) {
            for (let ix = 0; ix < segmentsX; ix++) {
                const a = ix + vertsX * iz;
                const b = ix + vertsX * (iz + 1);
                const c = (ix + 1) + vertsX * (iz + 1);
                const d = (ix + 1) + vertsX * iz;
                indices.push(a, b, d, b, c, d);
            }
        }

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
        geo.setIndex(indices);
        return geo;
    }

    /**
     * Generates a seamless 1-unit grid tile as a canvas texture.
     * Lines are drawn at the exact tile boundary (x=0, y=0) so they line up
     * perfectly across all repeats without gaps or doubled edges.
     * `repeatY` defaults to `repeatX` for the common square case (build()'s
     * own usage) — buildRect() passes both independently.
     */
    static makeGridTexture(repeatX: number, repeatY: number = repeatX): THREE.CanvasTexture {
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
        tex.repeat.set(repeatX, repeatY); // one grid cell per world unit
        tex.anisotropy = 8;
        return tex;
    }
}
