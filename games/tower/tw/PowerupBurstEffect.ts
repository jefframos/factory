import * as THREE from 'three';

// ── Tuning ────────────────────────────────────────────────────────────────────

const MAX_PARTICLES = 240;  // fixed pool size — ring-buffer recycled, never grows/allocates
const LIFETIME = 0.5;  // seconds a spark stays visible
const PARTICLES_PER_BURST = 24;
const SPEED_MIN = 1.2;
const SPEED_MAX = 3.2;
const GRAVITY = 4.5;   // lighter than WaterSplashSystem's — these are sparks, not droplets, so they hang a beat longer
const POINT_SIZE = 0.28;
const SIZE_ATTEN = 220;   // tuned against the same 10-25 unit follow distance WaterSplashSystem's own comment references

// Fiery orange-to-yellow — no per-particle color variation (single static
// burst use case, unlike a tintable general-purpose system), just a flat
// uniform. Change here if a differently-colored burst is ever needed.
const BURST_COLOR = new THREE.Vector3(1.0, 0.55, 0.15);

// ── Shader ────────────────────────────────────────────────────────────────────
// Same family as WaterSplashSystem — a raw ShaderMaterial shrinking/fading
// each point by its own remaining life fraction, uploaded as a per-vertex
// attribute rather than tracked per-material (one draw call for every burst
// live at once, not one draw call per burst).

const vertexShader = /* glsl */`
    attribute float aLife;
    uniform float uPixelRatio;
    varying float vLifeT;

    void main() {
        vLifeT = clamp(aLife / ${LIFETIME.toFixed(4)}, 0.0, 1.0);

        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = ${POINT_SIZE.toFixed(2)} * vLifeT * uPixelRatio * (${SIZE_ATTEN.toFixed(1)} / -mvPosition.z);
    }
`;

const fragmentShader = /* glsl */`
    uniform vec3 uColor;
    varying float vLifeT;

    void main() {
        vec2 p = gl_PointCoord - 0.5;
        float alpha = smoothstep(0.5, 0.0, length(p)) * vLifeT;
        gl_FragColor = vec4(uColor, alpha);
    }
`;

/**
 * Shared explosion-spark particle pool for the bomb/super-bomb powerups —
 * same fixed-capacity ring-buffer shape as games/tower/game/vfx/WaterSplashSystem,
 * just radial (outward in every direction from the contact point) instead of
 * biased backward along a travel direction, since a bomb burst has no
 * "direction of travel" to speak of.
 *
 * Static/singleton, one THREE.Points draw call for the whole scene no matter
 * how many bombs go off — see WaterSplashSystem's own doc for why (no
 * per-frame allocation, degrades gracefully instead of throwing under load).
 */
export class PowerupBurstEffect {
    private static points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> | null = null;
    private static positions: Float32Array;
    private static life: Float32Array;
    private static velX: Float32Array;
    private static velY: Float32Array;
    private static velZ: Float32Array;
    private static cursor = 0;

    public static build(scene: THREE.Scene): void {
        this.destroy();

        const positions = new Float32Array(MAX_PARTICLES * 3);
        const life = new Float32Array(MAX_PARTICLES);
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geo.setAttribute('aLife', new THREE.BufferAttribute(life, 1));

        const mat = new THREE.ShaderMaterial({
            uniforms: {
                uColor: { value: BURST_COLOR },
                uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) },
            },
            vertexShader,
            fragmentShader,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        });

        const points = new THREE.Points(geo, mat);
        points.frustumCulled = false;
        points.renderOrder = 10; // draws after normal opaque pieces — reads as a bright flash on top, not hidden behind them
        scene.add(points);

        this.points = points;
        this.positions = positions;
        this.life = life;
        this.velX = new Float32Array(MAX_PARTICLES);
        this.velY = new Float32Array(MAX_PARTICLES);
        this.velZ = new Float32Array(MAX_PARTICLES);
        this.cursor = 0;
    }

    /** Bursts PARTICLES_PER_BURST sparks outward from world-space (x, y, z). No-ops if build() hasn't run yet — safe to call unconditionally. */
    public static spawn(x: number, y: number, z: number): void {
        if (!this.points) {
            return;
        }

        for (let i = 0; i < PARTICLES_PER_BURST; i++) {
            const slot = this.cursor;
            this.cursor = (this.cursor + 1) % MAX_PARTICLES;

            // Uniform-on-sphere direction (not just a flat disc), so the
            // burst reads as a genuine 3D explosion from every angle.
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);
            const speed = SPEED_MIN + Math.random() * (SPEED_MAX - SPEED_MIN);

            this.velX[slot] = Math.sin(phi) * Math.cos(theta) * speed;
            this.velY[slot] = Math.cos(phi) * speed;
            this.velZ[slot] = Math.sin(phi) * Math.sin(theta) * speed;

            this.positions[slot * 3] = x;
            this.positions[slot * 3 + 1] = y;
            this.positions[slot * 3 + 2] = z;
            this.life[slot] = LIFETIME;
        }
    }

    /** Call once per frame regardless of whether any burst is currently live. */
    public static update(delta: number): void {
        if (!this.points) {
            return;
        }

        for (let i = 0; i < MAX_PARTICLES; i++) {
            if (this.life[i] <= 0) {
                continue;
            }

            this.life[i] = Math.max(0, this.life[i] - delta);

            this.velY[i] -= GRAVITY * delta;
            this.positions[i * 3] += this.velX[i] * delta;
            this.positions[i * 3 + 1] += this.velY[i] * delta;
            this.positions[i * 3 + 2] += this.velZ[i] * delta;
        }

        this.points.geometry.attributes.position.needsUpdate = true;
        this.points.geometry.attributes.aLife.needsUpdate = true;
    }

    public static destroy(): void {
        if (!this.points) {
            return;
        }

        this.points.geometry.dispose();
        this.points.material.dispose();
        this.points.removeFromParent();
        this.points = null;
    }
}
