import * as THREE from 'three';
import { BendService } from '../services/BendService';
import { ClusterMeshBuilder } from '../builders/ClusterMeshBuilder';

// ── Tuning ────────────────────────────────────────────────────────────────────

const CLOUD_CELL_SIZE = 8;   // world units per cell — matches island tile scale
const CLOUD_THICK = 4.0;  // cloud block height (drives bevel radius: clamped to THICK/2)
const CLOUD_HEIGHT = 8;    // Y world position (with BendService, visible at 78+ units)
const CLOUD_COLS = 20;   // cells each way → 20×20 = 400 cells per rebuild
const CLOUD_RADIUS = 2.0;  // rounded-edge radius (effectively min(2, CLOUD_THICK/2) ≈ 1.99)
const CLOUD_SEGMENTS = 3;    // bevel arc segments
const NOISE_SCALE = 0.12; // spatial frequency — smaller = larger cloud masses
const FILL_THRESH = 0.55; // ~45% of cells become cloud
const DRIFT_SPEED = 1.5;  // world units/sec the cloud layer scrolls in +X
const FADE_NEAR = 65.0; // invisible below this XZ distance from player
const FADE_FAR = 85.0; // fully opaque beyond this distance
const CLOUD_SEED = 7391;

// ── Noise ─────────────────────────────────────────────────────────────────────

function valueNoise(x: number, y: number, seed: number): number {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);
    const h = (gx: number, gy: number): number => {
        let n = Math.imul(seed * 1013 ^ gx * 1619 ^ gy * 31337, 0x45d9f3b);
        n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
        return (n >>> 0) / 0xFFFFFFFF;
    };
    const a = h(ix, iy), b = h(ix + 1, iy), c = h(ix, iy + 1), d = h(ix + 1, iy + 1);
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

// ── Shader ────────────────────────────────────────────────────────────────────
//
// Normal-based shading: top face = white, sides = light-grey, bottom = mid-grey.
// BendService world-curve makes distant clouds arc into the top of the viewport.
// Near-fade keeps clouds invisible close to the player (they're above the camera).
//
// Note: no instanceMatrix needed here — this is a single Mesh, not InstancedMesh.

const vertexShader = /* glsl */`
    varying float vXZDist;

    uniform vec3  uBendOrigin;
    uniform float uBendStrength;

    void main() {
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        float dx = worldPos.x - uBendOrigin.x;
        float dz = worldPos.z - uBendOrigin.z;
        worldPos.y -= (dx * dx + dz * dz) * uBendStrength;

        vXZDist = length(vec2(dx, dz));

        gl_Position = projectionMatrix * viewMatrix * worldPos;
    }
`;

const fragmentShader = /* glsl */`
    uniform float uFadeNear;
    uniform float uFadeFar;
    uniform float uOpacity;
    varying float vXZDist;

    void main() {
        float fade = smoothstep(uFadeNear, uFadeFar, vXZDist);
        gl_FragColor = vec4(1.0, 1.0, 1.0, uOpacity * fade);
    }
`;

// ── CloudSystem ───────────────────────────────────────────────────────────────

export class CloudSystem {
    private mesh!: THREE.Mesh;
    private drift = 0;
    private lastBuildPX = Infinity;  // force build on first update
    private lastBuildPZ = Infinity;

    build(scene: THREE.Scene): void {
        const mat = new THREE.ShaderMaterial({
            uniforms: {
                uBendOrigin: BendService.uniforms.uBendOrigin,
                uBendStrength: BendService.uniforms.uBendStrength,
                uFadeNear: { value: FADE_NEAR },
                uFadeFar: { value: FADE_FAR },
                uOpacity: { value: 0.90 },
            },
            vertexShader,
            fragmentShader,
            transparent: true,
        });

        // Empty geometry replaced on first update()
        this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
        this.mesh.frustumCulled = false;
        scene.add(this.mesh);
    }

    /**
     * Call once per frame.
     *
     * The cloud layer lives in a "cloud frame" that drifts over time.
     * `mesh.position.x = drift` moves the geometry into world space so the
     * BendService can correctly compute each vertex's XZ distance from the player.
     *
     * Geometry is rebuilt (via ClusterMeshBuilder) when the player moves more than
     * one cell width in cloud-frame space — roughly every few seconds at walking speed.
     */
    update(delta: number, playerX: number, playerZ: number): void {
        this.drift += delta * DRIFT_SPEED;

        // Cloud-frame player position strips out the scroll offset
        const cloudPX = playerX - this.drift;
        const cloudPZ = playerZ;

        // Mesh translation applies the drift so geometry xz → world xz
        this.mesh.position.set(this.drift, CLOUD_HEIGHT, 0);

        const needRebuild =
            Math.abs(cloudPX - this.lastBuildPX) >= CLOUD_CELL_SIZE ||
            Math.abs(cloudPZ - this.lastBuildPZ) >= CLOUD_CELL_SIZE;

        if (!needRebuild) return;

        const baseCX = Math.round(cloudPX / CLOUD_CELL_SIZE);
        const baseCZ = Math.round(cloudPZ / CLOUD_CELL_SIZE);

        const cells: [number, number][] = [];
        const half = Math.floor(CLOUD_COLS / 2);
        for (let dc = -half; dc < half; dc++) {
            for (let dr = -half; dr < half; dr++) {
                const cx = baseCX + dc;
                const cz = baseCZ + dr;
                if (valueNoise(cx * NOISE_SCALE, cz * NOISE_SCALE, CLOUD_SEED) >= FILL_THRESH) {
                    cells.push([cx, cz]);
                }
            }
        }

        const oldGeo = this.mesh.geometry;
        if (cells.length > 0) {
            // originX/Z = 0 — geometry is in cloud-frame; mesh.position provides the drift
            this.mesh.geometry = ClusterMeshBuilder.roundEdges(
                cells,
                CLOUD_CELL_SIZE,
                CLOUD_THICK,
                0,             // depthBelow: flat cloud slab, no underground portion
                0,             // originX
                0,             // originZ
                CLOUD_RADIUS,
                CLOUD_SEGMENTS,
            );
        }
        oldGeo.dispose();

        this.lastBuildPX = baseCX * CLOUD_CELL_SIZE;
        this.lastBuildPZ = baseCZ * CLOUD_CELL_SIZE;
    }

    destroy(scene: THREE.Scene): void {
        scene.remove(this.mesh);
        this.mesh.geometry.dispose();
        (this.mesh.material as THREE.Material).dispose();
    }
}
