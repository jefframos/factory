import * as THREE from 'three';
import { BendService } from '../services/BendService';

// ── Tuning ────────────────────────────────────────────────────────────────────

const MAX_PARTICLES = 240;  // fixed pool size — ring-buffer recycled, never grows/allocates
const LIFETIME = 0.6;  // seconds a droplet stays visible — long enough to see the rise and the fall back down
const PARTICLES_PER_SPAWN = 4;    // droplets kicked up per spawn() call
const SPAWN_SPREAD = 0.9;    // radians of random cone around the backward direction
const SPEED_MIN = 0.2;
const SPEED_MAX = 0.6;
const UP_SPEED_MIN = 3.2;  // launch speed high enough that GRAVITY produces a visible arc instead of a barely-there hop
const UP_SPEED_MAX = 4.6;
const GRAVITY = 15.0;
const SPAWN_AREA_RADIUS = 0.35; // world units — random XZ jitter per droplet so a burst doesn't spawn as one stacked point
const WATER_Y = 0.5;    // roughly the average water surface height — see WaterMaterial's elevation (0.45) + wave amplitude
const POINT_SIZE = 0.6;     // base point size in px at closest camera distance
const SIZE_ATTEN = 220;    // tuned against CAMERA_CONFIG's 10-25 unit follow distance

// ── Shader ────────────────────────────────────────────────────────────────────
// Same family as CloudSystem/StarfieldBackground: a raw ShaderMaterial, so the
// BendService world-curve is inlined here rather than applied via
// BendService.applyBend — that helper patches the `#include <project_vertex>`
// chunk standard materials get, which a fully custom ShaderMaterial has no use for.

const vertexShader = /* glsl */`
    attribute float aLife;
    uniform vec3  uBendOrigin;
    uniform float uBendStrength;
    uniform float uPixelRatio;
    varying float vLifeT;

    void main() {
        vLifeT = clamp(aLife / ${LIFETIME.toFixed(4)}, 0.0, 1.0);

        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        float dx = worldPos.x - uBendOrigin.x;
        float dz = worldPos.z - uBendOrigin.z;
        worldPos.y -= (dx * dx + dz * dz) * uBendStrength;

        vec4 mvPosition = viewMatrix * worldPos;
        gl_Position = projectionMatrix * mvPosition;
        // Shrinks and fades together over the droplet's lifetime; perspective
        // term keeps size roughly consistent as the camera zooms with player value.
        gl_PointSize = ${POINT_SIZE.toFixed(1)} * vLifeT * uPixelRatio * (${SIZE_ATTEN.toFixed(1)} / -mvPosition.z);
    }
`;

const fragmentShader = /* glsl */`
    varying float vLifeT;

    void main() {
        vec2 p = gl_PointCoord - 0.5;
        float alpha = smoothstep(0.5, 0.0, length(p)) * vLifeT;
        gl_FragColor = vec4(1.0, 1.0, 1.0, alpha * 0.85);
    }
`;

/**
 * Shared water-splash particle pool — one THREE.Points draw call for the
 * whole scene no matter how many entities feed it (PlayerEntity's head today,
 * tail cubes later). Static/singleton like BendService, since only one
 * ThreeScene is ever active at a time (see BaseDemoScene.spawnFreshWorld).
 *
 * Fixed-capacity ring buffer: spawn() always succeeds by overwriting the
 * oldest slot once the pool is full instead of growing — no per-frame
 * allocation, no GC pressure; visual density just degrades gracefully under
 * heavy load instead of the pool ever throwing or resizing.
 */
export class WaterSplashSystem {
    private static points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> | null = null;
    private static positions: Float32Array;
    private static life: Float32Array; // seconds remaining; <= 0 = dead/invisible (also the GPU aLife attribute buffer)
    private static velX: Float32Array;
    private static velY: Float32Array;
    private static velZ: Float32Array;
    private static cursor = 0;

    static build(scene: THREE.Scene): void {
        this.destroy();

        const positions = new Float32Array(MAX_PARTICLES * 3);
        const life = new Float32Array(MAX_PARTICLES);
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geo.setAttribute('aLife', new THREE.BufferAttribute(life, 1));

        const mat = new THREE.ShaderMaterial({
            uniforms: {
                uBendOrigin: BendService.uniforms.uBendOrigin,
                uBendStrength: BendService.uniforms.uBendStrength,
                uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) },
            },
            vertexShader,
            fragmentShader,
            transparent: true,
            depthWrite: false,
        });

        const points = new THREE.Points(geo, mat);
        points.frustumCulled = false; // positions span the live world area, not one fixed local bounding box
        scene.add(points);

        this.points = points;
        this.positions = positions;
        this.life = life;
        this.velX = new Float32Array(MAX_PARTICLES);
        this.velY = new Float32Array(MAX_PARTICLES);
        this.velZ = new Float32Array(MAX_PARTICLES);
        this.cursor = 0;
    }

    /**
     * Kicks up a small burst of droplets at (x, z), biased backward along
     * (-dirX, -dirZ) with random spread — call with an entity's travel
     * direction so the wake trails behind it. No-ops if build() hasn't run
     * yet (or already tore down) — safe to call unconditionally.
     */
    static spawn(x: number, z: number, dirX: number, dirZ: number): void {
        if (!this.points) return;

        for (let i = 0; i < PARTICLES_PER_SPAWN; i++) {
            const slot = this.cursor;
            this.cursor = (this.cursor + 1) % MAX_PARTICLES;

            const angle = (Math.random() - 0.5) * SPAWN_SPREAD;
            const cos = Math.cos(angle), sin = Math.sin(angle);
            const bx = -dirX, bz = -dirZ; // backward = opposite of travel direction
            const speed = SPEED_MIN + Math.random() * (SPEED_MAX - SPEED_MIN);

            this.velX[slot] = (bx * cos - bz * sin) * speed;
            this.velZ[slot] = (bx * sin + bz * cos) * speed;
            this.velY[slot] = UP_SPEED_MIN + Math.random() * (UP_SPEED_MAX - UP_SPEED_MIN);

            // Scatter each droplet's start point within a small disc instead of
            // stacking the whole burst on the exact same spot.
            const jitterR = Math.random() * SPAWN_AREA_RADIUS;
            const jitterA = Math.random() * Math.PI * 2;
            this.positions[slot * 3] = x + Math.cos(jitterA) * jitterR;
            this.positions[slot * 3 + 1] = WATER_Y;
            this.positions[slot * 3 + 2] = z + Math.sin(jitterA) * jitterR;
            this.life[slot] = LIFETIME;
        }
    }

    /** Call once per frame regardless of how many entities are emitting into the pool. */
    static update(delta: number): void {
        if (!this.points) return;

        for (let i = 0; i < MAX_PARTICLES; i++) {
            if (this.life[i] <= 0) continue;
            this.life[i] = Math.max(0, this.life[i] - delta);

            this.velY[i] -= GRAVITY * delta;
            this.positions[i * 3] += this.velX[i] * delta;
            this.positions[i * 3 + 1] += this.velY[i] * delta;
            this.positions[i * 3 + 2] += this.velZ[i] * delta;
        }

        this.points.geometry.attributes.position.needsUpdate = true;
        this.points.geometry.attributes.aLife.needsUpdate = true;
    }

    static destroy(): void {
        if (!this.points) return;
        this.points.geometry.dispose();
        this.points.material.dispose();
        this.points.removeFromParent();
        this.points = null;
    }
}
