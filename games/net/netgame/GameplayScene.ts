import { Game } from '@core/Game';
import { ThreeScene } from '@core/scene/ThreeScene';
import * as THREE from 'three';

export default class GameplayScene extends ThreeScene {
    private cube: THREE.Mesh;

    constructor(game: Game) {
        super(game);

        // Set 3D to render behind Pixi
        this.setThreeLayer(false);

        // Add a simple 3D Cube
        const geometry = new THREE.BoxGeometry(1, 1, 1);
        const material = new THREE.MeshPhongMaterial({ color: 0x00ff00 });
        this.cube = new THREE.Mesh(geometry, material);
        this.threeScene.add(this.cube);

        // Add Light
        const light = new THREE.DirectionalLight(0xffffff, 1);
        light.position.set(1, 2, 4);
        this.threeScene.add(light);
    }

    public update(delta: number): void {
        // Rotate cube for visual feedback
        this.cube.rotation.x += 0.01;
        this.cube.rotation.y += 0.01;

        // Always call super.update to actually render the ThreeJS scene!
        super.update(delta);
    }
}