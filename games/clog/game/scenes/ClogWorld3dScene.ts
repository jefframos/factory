import { ThreeScene } from "@core/scene/ThreeScene";
import * as THREE from "three";
import { PlayerEntity } from "../entities/PlayerEntity";
import { BendService } from "../services/BendService";
import { CollectibleManager } from "../systems/CollectibleManager";
import { LevelManager } from "../systems/LevelManager";
import { AreaManager } from "../world/AreaManager";

const CAM_OFFSET = new THREE.Vector3(0, 6, 10);
const CAM_LERP   = 0.1;

export default class ClogWorld3dScene extends ThreeScene {

    private player!: PlayerEntity;
    private collectibles!: CollectibleManager;
    private levelManager!: LevelManager;
    private areaManager!: AreaManager;

    /** Set each frame by BaseDemoScene via AnalogInput. */
    public moveInput: { x: number; z: number } = { x: 0, z: 0 };

    public async build(): Promise<void> {
        this.threeScene.add(new THREE.AmbientLight(0xffffff, 0.6));
        const dir = new THREE.DirectionalLight(0xffffff, 1);
        dir.position.set(5, 10, 7.5);
        this.threeScene.add(dir);

        // Area builds floor + walls + gates
        this.areaManager = new AreaManager(this.threeScene);

        this.player = new PlayerEntity(2, this.threeScene);

        this.collectibles = new CollectibleManager();
        const halfSize = this.areaManager.spawnHalfSize;
        this.collectibles.spawn(this.threeScene, 15, halfSize * 2);

        this.levelManager = new LevelManager();

        this.threeCamera.position.copy(this.player.position).add(CAM_OFFSET);
        this.threeCamera.lookAt(this.player.position);
    }

    public update(delta: number): void {
        this.player.setMoveInput(this.moveInput.x, this.moveInput.z);
        this.player.update(delta);
        BendService.updateOrigin(this.player.position);

        // Gate and wall collision (modifies player position)
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
        this.player?.destroy();
        this.collectibles?.destroy();
        super.destroy();
    }
}
