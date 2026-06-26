import { ThreeScene } from "@core/scene/ThreeScene";
import * as THREE from "three";
import { PlayerEntity } from "../entities/PlayerEntity";
import { BendService } from "../services/BendService";
import { CollectibleManager } from "../systems/CollectibleManager";
import { LevelManager } from "../systems/LevelManager";
import { SkyBackground } from "../vfx/SkyBackground";
import { AreaManager } from "../world/AreaManager";

const CAM_OFFSET = new THREE.Vector3(0, 6, 10);
const CAM_LERP   = 0.1;

export default class ClogWorld3dScene extends ThreeScene {

    private player!: PlayerEntity;
    private collectibles!: CollectibleManager;
    private levelManager!: LevelManager;
    private areaManager!: AreaManager;
    private sky!: SkyBackground;

    public moveInput: { x: number; z: number } = { x: 0, z: 0 };

    public async build(): Promise<void> {
        // Solid fallback in case the gradient mesh doesn't cover everything.
        this.threeScene.background = new THREE.Color(0x1a6ed4);

        // Camera must be in the scene so camera-attached children (sky gradient)
        // are included in the render traversal.
        this.threeScene.add(this.threeCamera);

        this.sky = new SkyBackground();
        this.sky.build(this.threeCamera);

        this.threeScene.add(new THREE.AmbientLight(0xffffff, 0.6));
        const dir = new THREE.DirectionalLight(0xffffff, 1);
        dir.position.set(5, 10, 7.5);
        this.threeScene.add(dir);

        this.areaManager = new AreaManager(this.threeScene);

        // Pre-populate each new area when the player transitions into it.
        this.areaManager.onTransition = ({ foodValues, halfSize, center }) => {
            const count = 10;
            for (let i = 0; i < count; i++) {
                const x = center.x + (Math.random() - 0.5) * 2 * halfSize;
                const z = center.y + (Math.random() - 0.5) * 2 * halfSize;
                const value = foodValues[Math.floor(Math.random() * foodValues.length)];
                this.collectibles.spawnOne(this.threeScene, new THREE.Vector3(x, 0, z), value);
            }
        };

        this.player = new PlayerEntity(2, this.threeScene);

        this.collectibles = new CollectibleManager();
        const halfSize = this.areaManager.spawnHalfSize;
        this.collectibles.spawn(this.threeScene, 15, halfSize * 2);

        this.levelManager = new LevelManager();

        this.threeCamera.position.copy(this.player.position).add(CAM_OFFSET);
        this.threeCamera.lookAt(this.player.position);
    }

    public update(delta: number): void {
        this.sky.update(delta);

        this.player.setMoveInput(this.moveInput.x, this.moveInput.z);
        this.player.update(delta);
        BendService.updateOrigin(this.player.position);

        this.areaManager.update(this.player);

        const hit = this.collectibles.checkCollision(this.player.eatPosition, this.player.eatRadius);
        if (hit) this.player.collect(hit);

        this.levelManager.update(
            delta,
            this.collectibles,
            this.threeScene,
            this.player.position,
            this.areaManager.foodValues,
            this.areaManager.spawnHalfSize,
            this.areaManager.spawnCenter,
        );

        this.threeCamera.position.lerp(
            this.player.position.clone().add(CAM_OFFSET),
            CAM_LERP,
        );
        this.threeCamera.lookAt(this.player.position);

        super.update(delta);
    }

    /** Dev helper: instantly double the player's value. */
    public debugDoublePlayerValue(): void {
        this.player.debugDoubleValue();
    }

    public destroy(): void {
        this.sky?.destroy();
        this.player?.destroy();
        this.collectibles?.destroy();
        super.destroy();
    }
}
