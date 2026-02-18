import { Game } from '@core/Game';
import { GameScene } from '@core/scene/GameScene';
import * as THREE from 'three';
import SetupThree from './SetupThree';

export abstract class ThreeScene extends GameScene {
    // Three.js Core
    public threeScene: THREE.Scene;
    public threeCamera: THREE.PerspectiveCamera;

    constructor(game: Game) {
        super(game);

        // 1. Initialize Global Three Setup if not already done
        if (!SetupThree.renderer) {
            SetupThree.initialize();
        }

        // 2. Setup Scene
        this.threeScene = new THREE.Scene();

        // 3. Setup Camera
        const aspect = window.innerWidth / window.innerHeight;
        this.threeCamera = new THREE.PerspectiveCamera(75, aspect, 0.1, 1000);
        this.threeCamera.position.z = 5;

        // 4. Handle Resizing
        SetupThree.resize(this.threeCamera);
    }

    /**
     * Set the layer order of the 3D scene
     * @param onTop If true, Three.js sits above Pixi. If false, below.
     */
    public setThreeLayer(onTop: boolean) {
        SetupThree.container.style.zIndex = onTop ? "10" : "1";
    }

    public update(delta: number): void {
        // Render the 3D Scene every frame
        SetupThree.renderer.render(this.threeScene, this.threeCamera);
    }

    public destroy(): void {
        // Cleanup Three.js objects to prevent memory leaks
        this.threeScene.clear();
        // Note: We don't destroy the renderer here as it's static and shared
    }
}