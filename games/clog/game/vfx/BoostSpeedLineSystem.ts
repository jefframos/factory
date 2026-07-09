import * as THREE from 'three';
import { BendService } from '../services/BendService';

// ── Tuning ────────────────────────────────────────────────────────────────────

const MAX_PARTICLES = 90;   // fixed pool size — ring-buffer recycled, never grows/allocates
const LIFETIME = 0.35; // seconds a streak stays visible — short so streaks constantly refresh while boosting
const PARTICLES_PER_SPAWN = 3;    // streaks kicked out per spawn() call

// All spatial tuning below is expressed as a ratio of the boosting entity's
// current cube size (ClogConstants.sizeForValue) rather than fixed world
// units, so streaks stay proportioned to the player instead of dwarfing a
// fresh spawn or looking tiny on a huge one — spawn() takes that size and
// scales every ratio by it.
const RING_MIN_FACTOR = 0.25;  // lateral offset from the travel line, so streaks pass the player's sides rather than sit on top of it
const RING_MAX_FACTOR = 0.55;
const FORWARD_JITTER_FACTOR = 0.15;
const LINE_LENGTH_MIN_FACTOR = 0.4;  // how far the streak stretches back from its spawn point
const LINE_LENGTH_MAX_FACTOR = 0.7;
const HEIGHT_MIN_FACTOR = 0.1;  // vertical range streaks spawn within, roughly spanning the cube's own height
const HEIGHT_MAX_FACTOR = 0.6;

// ── Shader ────────────────────────────────────────────────────────────────────
// Same family as WaterSplashSystem: a raw ShaderMaterial so BendService's
// world-curve is inlined rather than applied via BendService.applyBend (that
// helper targets standard materials' `#include <project_vertex>` chunk).
//
// Each streak is one line segment (2 vertices, drawn as THREE.LineSegments).
// aEdge is 1.0 on the vertex nearest the player and 0.0 on the far vertex —
// the GPU interpolates it across the fragment for a free head-to-tail taper,
// no extra per-frame work needed beyond the aLife fade.

const vertexShader = /* glsl */`
    attribute float aLife;
    attribute float aEdge;
    uniform vec3  uBendOrigin;
    uniform float uBendStrength;
    varying float vAlpha;

    void main() {
        float lifeT = clamp(aLife / ${LIFETIME.toFixed(4)}, 0.0, 1.0);
        vAlpha = lifeT * aEdge;

        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        float dx = worldPos.x - uBendOrigin.x;
        float dz = worldPos.z - uBendOrigin.z;
        worldPos.y -= (dx * dx + dz * dz) * uBendStrength;

        gl_Position = projectionMatrix * viewMatrix * worldPos;
    }
`;

const fragmentShader = /* glsl */`
    varying float vAlpha;

    void main() {
        gl_FragColor = vec4(1.0, 1.0, 1.0, vAlpha * 0.9);
    }
`;

/**
 * Shared boost speed-line pool — one THREE.LineSegments draw call for the
 * whole scene, mirroring WaterSplashSystem's static/fixed-pool pattern.
 * Streaks are stamped in world space at spawn time and never move; they just
 * fade out over LIFETIME while the boosting entity rushes past them, which
 * reads as motion without any per-frame position integration.
 */
export class BoostSpeedLineSystem {
    private static lines: THREE.LineSegments<THREE.BufferGeometry, THREE.ShaderMaterial> | null = null;
    private static positions: Float32Array; // 2 vertices per particle
    private static life: Float32Array;      // seconds remaining per particle; <= 0 = dead/invisible
    private static lifeAttr: Float32Array;  // GPU aLife buffer — life[] duplicated across each particle's 2 vertices
    private static cursor = 0;

    static build(scene: THREE.Scene): void {
        this.destroy();

        const positions = new Float32Array(MAX_PARTICLES * 2 * 3);
        const lifeAttr = new Float32Array(MAX_PARTICLES * 2);
        const edge = new Float32Array(MAX_PARTICLES * 2);
        for (let i = 0; i < MAX_PARTICLES; i++) {
            edge[i * 2] = 1;     // vertex nearest the player
            edge[i * 2 + 1] = 0; // far vertex — tapers to transparent
        }

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geo.setAttribute('aLife', new THREE.BufferAttribute(lifeAttr, 1));
        geo.setAttribute('aEdge', new THREE.BufferAttribute(edge, 1));

        const mat = new THREE.ShaderMaterial({
            uniforms: {
                uBendOrigin: BendService.uniforms.uBendOrigin,
                uBendStrength: BendService.uniforms.uBendStrength,
            },
            vertexShader,
            fragmentShader,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        });

        const lines = new THREE.LineSegments(geo, mat);
        lines.frustumCulled = false; // positions span the live world area, not one fixed local bounding box
        scene.add(lines);

        this.lines = lines;
        this.positions = positions;
        this.life = new Float32Array(MAX_PARTICLES);
        this.lifeAttr = lifeAttr;
        this.cursor = 0;
    }

    /**
     * Stamps a small burst of streaks around (x, z), stretched backward
     * along (-dirX, -dirZ) with lateral spread — call with the boosting
     * entity's travel direction so streaks trail past its sides. `size`
     * should be ClogConstants.sizeForValue(entity.value) — every spatial
     * dimension scales off it so streaks fit the entity that spawned them.
     * No-ops if build() hasn't run yet (or already tore down) — safe to
     * call unconditionally.
     */
    static spawn(x: number, z: number, dirX: number, dirZ: number, size: number): void {
        if (!this.lines) return;

        const perpX = -dirZ;
        const perpZ = dirX;

        for (let i = 0; i < PARTICLES_PER_SPAWN; i++) {
            const slot = this.cursor;
            this.cursor = (this.cursor + 1) % MAX_PARTICLES;

            const side = Math.random() < 0.5 ? -1 : 1;
            const lateral = side * (RING_MIN_FACTOR + Math.random() * (RING_MAX_FACTOR - RING_MIN_FACTOR)) * size;
            const fwd = (Math.random() - 0.5) * 2 * FORWARD_JITTER_FACTOR * size;
            const length = (LINE_LENGTH_MIN_FACTOR + Math.random() * (LINE_LENGTH_MAX_FACTOR - LINE_LENGTH_MIN_FACTOR)) * size;
            const height = (HEIGHT_MIN_FACTOR + Math.random() * (HEIGHT_MAX_FACTOR - HEIGHT_MIN_FACTOR)) * size;

            const headX = x + perpX * lateral + dirX * fwd;
            const headZ = z + perpZ * lateral + dirZ * fwd;
            const tailX = headX - dirX * length;
            const tailZ = headZ - dirZ * length;

            const base = slot * 2 * 3;
            this.positions[base] = headX;
            this.positions[base + 1] = height;
            this.positions[base + 2] = headZ;
            this.positions[base + 3] = tailX;
            this.positions[base + 4] = height;
            this.positions[base + 5] = tailZ;

            this.life[slot] = LIFETIME;
            this.lifeAttr[slot * 2] = LIFETIME;
            this.lifeAttr[slot * 2 + 1] = LIFETIME;
        }

        this.lines.geometry.attributes.position.needsUpdate = true;
    }

    /** Call once per frame regardless of how many entities are emitting into the pool. */
    static update(delta: number): void {
        if (!this.lines) return;

        for (let i = 0; i < MAX_PARTICLES; i++) {
            if (this.life[i] <= 0) continue;
            this.life[i] = Math.max(0, this.life[i] - delta);
            this.lifeAttr[i * 2] = this.life[i];
            this.lifeAttr[i * 2 + 1] = this.life[i];
        }

        this.lines.geometry.attributes.aLife.needsUpdate = true;
    }

    static destroy(): void {
        if (!this.lines) return;
        this.lines.geometry.dispose();
        this.lines.material.dispose();
        this.lines.removeFromParent();
        this.lines = null;
    }
}
