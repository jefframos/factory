import { ThreeScene } from "@core/scene/ThreeScene";
import * as THREE from "three";
import { FloorBuilder } from "../builders/FloorBuilder";
import { PlayerEntity } from "../entities/PlayerEntity";
import { CollectibleManager } from "../systems/CollectibleManager";
import { LevelManager } from "../systems/LevelManager";

const CAM_OFFSET = new THREE.Vector3(0, 6, 10);
const CAM_LERP = 0.1;

export default class ClogWorld3dScene extends ThreeScene {

    private player: PlayerEntity;
    private collectibles: CollectibleManager;
    private levelManager: LevelManager;

    /** Set each frame by BaseDemoScene via AnalogInput. */
    public moveInput: { x: number; z: number } = { x: 0, z: 0 };

    public async build(): Promise<void> {
        // Lights
        this.threeScene.add(new THREE.AmbientLight(0xffffff, 0.6));
        const dir = new THREE.DirectionalLight(0xffffff, 1);
        dir.position.set(5, 10, 7.5);
        this.threeScene.add(dir);

        // Floor + grid
        FloorBuilder.build(this.threeScene, 30);

        // Player starts at value 2
        this.player = new PlayerEntity(2, this.threeScene);

        // Scatter 15 collectible "2" cubes across a 24×24 area
        this.collectibles = new CollectibleManager();
        this.collectibles.spawn(this.threeScene, 15, 24);

        this.levelManager = new LevelManager();

        this.levelManager = new LevelManager();

        // Initial camera
        this.threeCamera.position.copy(this.player.position).add(CAM_OFFSET);
        this.threeCamera.lookAt(this.player.position);
    }

    public update(delta: number): void {
        this.player.setMoveInput(this.moveInput.x, this.moveInput.z);
        this.player.update(delta);

        // Collect when a cube enters the eat circle in front of the player
        const hit = this.collectibles.checkCollision(this.player.eatPosition, this.player.eatRadius);
        if (hit) this.player.collect(hit);

        // Spawn food to keep the world populated
        this.levelManager.update(delta, this.collectibles, this.threeScene, this.player.position);

        // Smooth camera follow
        this.threeCamera.position.lerp(
            this.player.position.clone().add(CAM_OFFSET),
            CAM_LERP
        );
        this.threeCamera.lookAt(this.player.position);

        super.update(delta);
    }

    public destroy(): void {
        this.player?.destroy();
        this.collectibles?.destroy();
        super.destroy();
    }
}
