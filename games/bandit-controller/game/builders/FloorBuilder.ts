import * as THREE from "three";
import { BendService, WorldBendService } from "core/services/BendService";

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
     * A genuine raised box (width × height × depth) — meant for a sidewalk
     * running alongside a lane, sitting visibly above street level rather
     * than flush with it (a flat plane at the SAME height as the lane read
     * as indistinguishable from it — a box with real vertical sides doesn't).
     * `cy` is the box's own CENTER height, so pass `height / 2` to sit its
     * base at y=0 and its top at y=height. Uses a flat color rather than a
     * texture, so it's clearly visible as its own shape even before anyone
     * assigns a real material — solid (`opacity` 1) by default; pass a
     * lower `opacity` for a translucent placeholder instead. Subdivided
     * along depth (`depthSegments`) for the same reason build()'s own
     * floor needs segments: RunnerBendService's bend is a per-vertex
     * displacement, so a coarse box would only warp at its 8 corners over
     * a long strip. Same box+bend pattern already used for obstacles —
     * see ObstacleBuilder.ts.
     */
    static buildBox(scene: THREE.Scene, width: number, height: number, depth: number, cx: number, cy: number, cz: number, bendService: WorldBendService = BendService, depthSegments = 32, color = 0x88ccff, opacity = 1): THREE.Mesh {
        const geo = new THREE.BoxGeometry(width, height, depth, 2, 2, depthSegments);
        const mat = new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, side: THREE.DoubleSide });
        bendService.applyBend(mat);
        const box = new THREE.Mesh(geo, mat);
        box.position.set(cx, cy, cz);
        scene.add(box);
        return box;
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
