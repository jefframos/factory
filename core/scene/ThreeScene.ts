import { Game } from 'core/Game';
import { GameScene } from 'core/scene/GameScene';
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
     * param onTop If true, Three.js sits above Pixi. If false, below.
     */
    public setThreeLayer(onTop: boolean) {
        SetupThree.container.style.zIndex = onTop ? "10" : "1";
    }

    /**
     * Projects a 3D world point to raw CSS-pixel screen coordinates — the
     * same pixel space both the THREE canvas and the Pixi canvas are sized
     * to (window.innerWidth/innerHeight; see SetupThree.resize and
     * Game.onResize, which both ultimately size their canvases to the full
     * viewport). Lets a Pixi element track a 3D entity: project here, then
     * convert the result into whatever Pixi container you want to parent it
     * under via plain `container.toLocal()` — no resolution division needed,
     * since Pixi's stage space is itself sized in raw CSS pixels (see
     * EntityIndicatorManager.toOverlayLocal for the boost indicator's use of
     * this) — that step is Pixi-specific and deliberately not baked in here.
     *
     * Returns null when the point is behind the camera, so callers can hide
     * whatever UI would otherwise land at a bogus on-screen position.
     */
    public worldToScreen(worldPos: THREE.Vector3): { x: number; y: number } | null {
        // Project() alone isn't enough to detect "behind the camera" — a
        // point behind the near plane can still land inside the -1..1 NDC
        // box with flipped sign, reading as a valid on-screen position.
        // Camera-space Z is unambiguous: the camera looks down its own -Z,
        // so anything in front has a negative view-space Z.
        const viewSpace = worldPos.clone().applyMatrix4(this.threeCamera.matrixWorldInverse);
        if (viewSpace.z > 0) return null;

        const ndc = worldPos.clone().project(this.threeCamera);
        return {
            x: (ndc.x * 0.5 + 0.5) * window.innerWidth,
            y: (1 - (ndc.y * 0.5 + 0.5)) * window.innerHeight,
        };
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