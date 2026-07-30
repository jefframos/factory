// TowerVfxUtils.ts

import * as THREE from 'three';
import { DEFAULT_FACE_TOWER_CONFIG } from './FaceTowerConfig';
import type { FaceTowerBlock } from './FaceTowerTypes';
import { DEFAULT_TOWER_3D_CONFIG } from './Tower3DConfig';
import SoundManager from 'core/audio/SoundManager';
import Assets from '../Assets';

interface BurstPreset {
    maxParticles: number;
    particlesPerBurst: number;
    lifetime: number;
    speedMin: number;
    speedMax: number;
    gravity: number;
    pointSize: number;
    sizeAtten: number;
    color: THREE.Vector3;
    /**
     * When true, the burst ignores the depth buffer entirely — always draws
     * on top of everything else in the scene (the tower, the island,
     * whatever's in front of it) instead of being occluded/clipped by
     * closer geometry. Off by default (normal depth-tested behavior).
     */
    ignoreDepth?: boolean;
}

/**
 * One fixed-capacity ring-buffer radial particle pool, same shape as the
 * original games/tower WaterSplashSystem — a single THREE.Points draw call
 * no matter how many bursts of THIS preset are live at once, no per-frame
 * allocation. TowerVfxUtils owns one instance per event type (bomb/freeze/
 * shrink/first-touch) rather than sharing one pool with per-particle color,
 * since presets differ enough (lifetime, gravity, count) that a shared
 * buffer would need per-particle attributes for all of them anyway.
 */
class BurstPool {
    private points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> | null = null;
    private positions!: Float32Array;
    private life!: Float32Array;
    private velX!: Float32Array;
    private velY!: Float32Array;
    private velZ!: Float32Array;
    private cursor = 0;

    public constructor(private readonly preset: BurstPreset) { }

    public build(scene: THREE.Scene): void {
        this.destroy();

        const { maxParticles, lifetime, pointSize, sizeAtten, color, ignoreDepth } = this.preset;

        const positions = new Float32Array(maxParticles * 3);
        const life = new Float32Array(maxParticles);
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geo.setAttribute('aLife', new THREE.BufferAttribute(life, 1));

        const mat = new THREE.ShaderMaterial({
            uniforms: {
                uColor: { value: color },
                uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) },
            },
            vertexShader: /* glsl */`
                attribute float aLife;
                uniform float uPixelRatio;
                varying float vLifeT;

                void main() {
                    vLifeT = clamp(aLife / ${lifetime.toFixed(4)}, 0.0, 1.0);

                    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                    gl_Position = projectionMatrix * mvPosition;
                    gl_PointSize = ${pointSize.toFixed(2)} * vLifeT * uPixelRatio * (${sizeAtten.toFixed(1)} / -mvPosition.z);
                }
            `,
            fragmentShader: /* glsl */`
                uniform vec3 uColor;
                varying float vLifeT;

                void main() {
                    vec2 p = gl_PointCoord - 0.5;
                    float alpha = smoothstep(0.5, 0.0, length(p)) * vLifeT;
                    gl_FragColor = vec4(uColor, alpha);
                }
            `,
            transparent: true,
            depthWrite: false,
            depthTest: !ignoreDepth,
            blending: THREE.AdditiveBlending,
        });

        const points = new THREE.Points(geo, mat);
        points.frustumCulled = false;
        // Depth-ignoring bursts also render dead last, so renderOrder alone
        // (not just depthTest) keeps them from being painted over by
        // anything else in the transparent pass.
        points.renderOrder = ignoreDepth ? 999 : 10;
        scene.add(points);

        this.points = points;
        this.positions = positions;
        this.life = life;
        this.velX = new Float32Array(maxParticles);
        this.velY = new Float32Array(maxParticles);
        this.velZ = new Float32Array(maxParticles);
        this.cursor = 0;
    }

    public spawn(x: number, y: number, z: number): void {
        if (!this.points) {
            return;
        }

        const { maxParticles, particlesPerBurst, speedMin, speedMax, lifetime } = this.preset;

        for (let i = 0; i < particlesPerBurst; i++) {
            const slot = this.cursor;
            this.cursor = (this.cursor + 1) % maxParticles;

            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);
            const speed = speedMin + Math.random() * (speedMax - speedMin);

            this.velX[slot] = Math.sin(phi) * Math.cos(theta) * speed;
            this.velY[slot] = Math.cos(phi) * speed;
            this.velZ[slot] = Math.sin(phi) * Math.sin(theta) * speed;

            this.positions[slot * 3] = x;
            this.positions[slot * 3 + 1] = y;
            this.positions[slot * 3 + 2] = z;
            this.life[slot] = lifetime;
        }
    }

    public update(delta: number): void {
        if (!this.points) {
            return;
        }

        const { maxParticles, gravity } = this.preset;

        for (let i = 0; i < maxParticles; i++) {
            if (this.life[i] <= 0) {
                continue;
            }

            this.life[i] = Math.max(0, this.life[i] - delta);

            this.velY[i] -= gravity * delta;
            this.positions[i * 3] += this.velX[i] * delta;
            this.positions[i * 3 + 1] += this.velY[i] * delta;
            this.positions[i * 3 + 2] += this.velZ[i] * delta;
        }

        this.points.geometry.attributes.position.needsUpdate = true;
        this.points.geometry.attributes.aLife.needsUpdate = true;
    }

    public destroy(): void {
        if (!this.points) {
            return;
        }

        this.points.geometry.dispose();
        this.points.material.dispose();
        this.points.removeFromParent();
        this.points = null;
    }
}

// ── Presets — tune per event here ──────────────────────────────────────────

const BOMB_POOL = new BurstPool({
    ignoreDepth: true,
    maxParticles: 240,
    particlesPerBurst: 24,
    lifetime: 0.5,
    speedMin: 2.2,
    speedMax: 6.2,
    gravity: 4.5,
    pointSize: 2,
    sizeAtten: 220,
    color: new THREE.Vector3(1.0, 0.55, 0.15), // fiery orange
});

const FREEZE_POOL = new BurstPool({
    ignoreDepth: true,
    maxParticles: 160,
    particlesPerBurst: 16,
    lifetime: 0.45,
    speedMin: 2.8,
    speedMax: 3.0,
    gravity: 1.5,
    pointSize: 1.5,
    sizeAtten: 220,
    color: new THREE.Vector3(0.55, 0.85, 1.0), // icy blue
});

const SHRINK_POOL = new BurstPool({
    ignoreDepth: true,
    maxParticles: 160,
    particlesPerBurst: 16,
    lifetime: 0.4,
    speedMin: 2.6,
    speedMax: 3.8,
    gravity: 2.5,
    pointSize: 1.5,
    sizeAtten: 220,
    color: new THREE.Vector3(0.75, 0.45, 1.0), // violet
});

const FIRST_TOUCH_POOL = new BurstPool({
    ignoreDepth: true,
    maxParticles: 200,
    particlesPerBurst: 10,
    lifetime: 0.3,
    speedMin: 0.4,
    speedMax: 5.2,
    gravity: 3,
    pointSize: 0.5,
    sizeAtten: 220,
    color: new THREE.Vector3(1.0, 1.0, 1.0), // plain white dust — every normal landing
});

const SCORE_POOL = new BurstPool({
    ignoreDepth: true,
    maxParticles: 160,
    particlesPerBurst: 14,
    lifetime: 0.35,
    speedMin: 1.0,
    speedMax: 2.2,
    gravity: 1.5,
    pointSize: 1.2,
    sizeAtten: 220,
    color: new THREE.Vector3(1.0, 0.85, 0.2), // gold — matches a "points" pop
});

const ALL_POOLS = [BOMB_POOL, FREEZE_POOL, SHRINK_POOL, FIRST_TOUCH_POOL, SCORE_POOL];

/**
 * Static VFX hook surface for the tower's gameplay "juice" — one radial
 * particle burst per event type (see the presets above), called straight
 * from IslandViewScene's FaceTowerGameEvents handlers. Each hook gets the
 * 3D-world contact point (null when one genuinely isn't available),
 * the "action piece" (whatever was just dropped/falling — a normal block
 * for onFirstTouchVfx, the powerup piece itself for the others), and the
 * "hit piece" (whatever it struck) — so any of these can be tuned to react
 * differently per piece (color, size, a piece-specific burst) without
 * touching the call sites in IslandViewScene.
 */
export class TowerVfxUtils {
    /**
     * Converts a FaceTowerBlock's 2D physics position into 3D world space —
     * same conversion TowerBlockSync3D.updateCube()/IslandViewScene's own
     * contactPointToWorld() use, since a block has no 3D transform of its
     * own (TowerBlockSync3D only mirrors 2D physics into 3D meshes every
     * frame, it doesn't store a "real" 3D position on the block itself).
     */
    public static blockToWorld(block: FaceTowerBlock): THREE.Vector3 {
        const cfg = DEFAULT_FACE_TOWER_CONFIG;
        const cfg3d = DEFAULT_TOWER_3D_CONFIG;
        const pos = block.entity.body.position;

        return new THREE.Vector3(
            (pos.x - cfg.floorX) / cfg3d.pixelsPerUnit + cfg3d.towerBaseOffset.x,
            (cfg.floorY - pos.y) / cfg3d.pixelsPerUnit + cfg3d.towerBaseOffset.y,
            cfg3d.towerBaseOffset.z,
        );
    }

    public static build(scene: THREE.Scene): void {
        ALL_POOLS.forEach(pool => pool.build(scene));
    }

    public static update(delta: number): void {
        ALL_POOLS.forEach(pool => pool.update(delta));
    }

    public static destroy(): void {
        ALL_POOLS.forEach(pool => pool.destroy());
    }

    /** A normal (non-powerup) piece's first physical contact with anything. */
    public static onFirstTouchVfx(
        contactPoint: THREE.Vector3 | null,
        actionPiece: FaceTowerBlock,
        hitPiece: FaceTowerBlock | undefined,
    ): void {
        if (!contactPoint) {
            return;
        }

        const worldPos = TowerVfxUtils.blockToWorld(actionPiece);
        FIRST_TOUCH_POOL.spawn(worldPos.x, worldPos.y, worldPos.z);
    }

    /** The freeze (lightning) powerup touching a block. */
    public static onFreezeVfx(
        contactPoint: THREE.Vector3 | null,
        actionPiece: FaceTowerBlock,
        hitPiece: FaceTowerBlock,
    ): void {
        if (!contactPoint) {
            return;
        }

        FREEZE_POOL.spawn(contactPoint.x, contactPoint.y, contactPoint.z);
        SoundManager.instance.tryToPlaySound(Assets.Sounds.Game.Freeze)

    }

    /** The shrink-ray powerup touching a block. */
    public static onShrinkVfx(
        contactPoint: THREE.Vector3 | null,
        actionPiece: FaceTowerBlock,
        hitPiece: FaceTowerBlock,
    ): void {
        if (!contactPoint) {
            return;
        }

        SHRINK_POOL.spawn(contactPoint.x, contactPoint.y, contactPoint.z);
        SoundManager.instance.tryToPlaySound(Assets.Sounds.Game.Shrink)

    }

    /** The bomb/super-bomb powerup destroying a block. */
    public static onBombVfx(
        contactPoint: THREE.Vector3 | null,
        actionPiece: FaceTowerBlock,
        hitPiece: FaceTowerBlock,
    ): void {
        if (!contactPoint) {
            return;
        }

        BOMB_POOL.spawn(contactPoint.x, contactPoint.y, contactPoint.z);
        SoundManager.instance.tryToPlaySound(Assets.Sounds.Game.Bomb)
    }

    /** A piece popping its score during a zone-complete popup — see TowerScorePopupUtils. */
    public static onScorePopVfx(block: FaceTowerBlock): void {
        const worldPos = TowerVfxUtils.blockToWorld(block);
        SCORE_POOL.spawn(worldPos.x, worldPos.y, worldPos.z);
    }
}
