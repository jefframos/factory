import { ThreeScene } from '@core/scene/ThreeScene';
import * as THREE from 'three';
import { PlayerEntity } from '../entities/PlayerEntity';
import { BendService } from '../services/BendService';
import { CollectibleManager } from '../systems/CollectibleManager';
import { LevelManager } from '../systems/LevelManager';
import { LinearAreaManager } from '../world/LinearAreaManager';
import { CAMERA_CONFIG, FOOD_CONFIG } from '../world/LinearConfig';
import FourCornersGradientBuilder from '../vfx/FourCornersGradientBuilder';

const CAM_SMOOTH = 2.2; // exponential approach speed toward depth-driven target

export default class LinearWorld3dScene extends ThreeScene {

    private player!: PlayerEntity;
    private collectibles!: CollectibleManager;
    private levelManager!: LevelManager;
    private linearManager!: LinearAreaManager;
    private gradient = new FourCornersGradientBuilder();

    // Smoothed camera offset — approaches target derived from player depth each frame
    private camY = CAMERA_CONFIG.baseY;
    private camZ = CAMERA_CONFIG.baseZ;

    /** Zoom multiplier applied on top of the depth-driven target. 1 = default, >1 = further out. */
    public cameraZoom = 1.0;

    public moveInput: { x: number; z: number } = { x: 0, z: 0 };

    // ── Exposed for Pixi HUD / minimap ────────────────────────────────────────

    get playerValue(): number      { return this.player?.value ?? 0; }
    get playerScore(): number      { return this.player?.score ?? 0; }
    get currentRoomIndex(): number { return this.linearManager?.currentRoomIndex ?? 0; }
    get nextGateValue(): number    { return this.linearManager?.nextGateValue ?? 0; }

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    public async build(): Promise<void> {
        this.threeScene.background = new THREE.Color(0x4ab8f0);
        this.threeScene.add(this.threeCamera);

        this.gradient.build({
            camera: this.threeCamera,
            mode: 'four-way',
            distance: 30,
            fourWay: {
                topColor:    0x1a72d4,
                leftColor:   0x42aaee,
                bottomColor: 0x90d8f8,
                rightColor:  0x42aaee,
                radius: 1.5,
                speed: 0.03,
            },
        });

        this.threeScene.add(new THREE.AmbientLight(0xffffff, 0.5));
        const dir = new THREE.DirectionalLight(0xaaccff, 0.9);
        dir.position.set(5, 10, 7.5);
        this.threeScene.add(dir);

        this.linearManager  = new LinearAreaManager(this.threeScene);
        this.collectibles   = new CollectibleManager();
        this.levelManager   = new LevelManager();

        this.linearManager.onTransition = ({ prevMinZ, prevMaxZ }) => {
            // Clear only the food that belonged to the room we just left.
            // The next area's food was already placed when it was pre-built — keep it.
            this.collectibles.clearInZRange(prevMinZ, prevMaxZ);

            // Seed the brand-new far area (room N+2) that was just built.
            // Use initialCount so the new room starts sparse and tops up via LevelManager.
            this.spawnFood(
                this.linearManager.nextConfig.foodValues,
                FOOD_CONFIG.initialCount,
                this.linearManager.nextSpawnHalfSize,
                this.linearManager.nextSpawnCenter,
            );
        };

        // Seed food in room 0 and the pre-built room 1 — small initial counts only.
        this.spawnFood(
            this.linearManager.currentConfig.foodValues,
            FOOD_CONFIG.initialCount,
            this.linearManager.spawnHalfSize,
            this.linearManager.spawnCenter,
        );
        this.spawnFood(
            this.linearManager.nextConfig.foodValues,
            FOOD_CONFIG.initialCount,
            this.linearManager.nextSpawnHalfSize,
            this.linearManager.nextSpawnCenter,
        );

        this.player = new PlayerEntity(2, this.threeScene);
        this.linearManager.registerPlayer(this.player);
        this.threeCamera.position.copy(this.player.position)
            .add(new THREE.Vector3(0, this.camY, this.camZ));
        this.threeCamera.lookAt(this.player.position);
    }

    public update(delta: number): void {
        const cfg = this.linearManager.currentConfig;

        // ── Depth-driven camera ───────────────────────────────────────────────
        // depth increases continuously as the player moves forward (deeper Z).
        const depth     = Math.abs(this.player.position.z);
        const targetY   = Math.min(CAMERA_CONFIG.baseY + depth * CAMERA_CONFIG.yPerDepth, CAMERA_CONFIG.maxY) * this.cameraZoom;
        const targetZ   = Math.min(CAMERA_CONFIG.baseZ + depth * CAMERA_CONFIG.zPerDepth, CAMERA_CONFIG.maxZ) * this.cameraZoom;
        const t         = 1 - Math.exp(-CAM_SMOOTH * delta);
        this.camY      += (targetY - this.camY) * t;
        this.camZ      += (targetZ - this.camZ) * t;

        // ── Speed scale — bigger rooms run slightly slower ─────────────────
        const scaledDelta = delta * cfg.speedScale;

        this.gradient.update(scaledDelta);

        this.player.setMoveInput(this.moveInput.x, this.moveInput.z);
        this.player.update(scaledDelta);
        BendService.updateOrigin(this.player.position);

        this.linearManager.update(this.player);
        this.collectibles.update(scaledDelta);

        const hit = this.collectibles.checkCollision(this.player.eatPosition, this.player.eatRadius);
        if (hit) this.player.collect(hit);

        this.levelManager.update(
            scaledDelta,
            this.collectibles,
            this.threeScene,
            this.player.position,
            this.linearManager.effectiveFoodValues,
            this.linearManager.spawnHalfSize,
            this.linearManager.spawnCenter,
            this.linearManager.computedFoodCount,
        );

        this.threeCamera.position.lerp(
            this.player.position.clone().add(new THREE.Vector3(0, this.camY, this.camZ)),
            CAMERA_CONFIG.lerp,
        );
        this.threeCamera.lookAt(this.player.position);

        super.update(delta);
    }

    public debugDoublePlayerValue(): void {
        this.player.debugDoubleValue();
    }

    public destroy(): void {
        this.gradient.destroy();
        this.player?.destroy();
        this.collectibles?.destroy();
        this.linearManager?.destroy();
        super.destroy();
    }

    // ── Private ───────────────────────────────────────────────────────────────

    private spawnFood(
        values: number[],
        count: number,
        halfSize: number,
        center: THREE.Vector2,
        withPop = false,
    ): void {
        for (let i = 0; i < count; i++) {
            const x     = center.x + (Math.random() - 0.5) * 2 * halfSize;
            const z     = center.y + (Math.random() - 0.5) * 2 * halfSize;
            const value = values[Math.floor(Math.random() * values.length)];
            this.collectibles.spawnOne(this.threeScene, new THREE.Vector3(x, 0, z), value, withPop);
        }
    }
}
