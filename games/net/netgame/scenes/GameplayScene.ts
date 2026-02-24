import { Game } from '@core/Game';
import { ThreeScene } from '@core/scene/ThreeScene';
import * as THREE from 'three';
import { SceneTheme, THEMES } from '../../environment/SceneTheme';
import { Water } from '../../environment/Water';

export default class GameplayScene extends ThreeScene {
    private pulsingLight!: THREE.PointLight;
    private keyLight!: THREE.DirectionalLight;
    private fillLight!: THREE.DirectionalLight;
    private ambientLight!: THREE.AmbientLight;

    private time: number = 0;
    private water!: Water;
    private baseGroup: THREE.Group = new THREE.Group();


    constructor(game: Game) {
        super(game);
        this.setThreeLayer(false);
        // Initialize lights once so we can update them later
        this.initLights();

        // Default to Night or Day
        this.updateVisuals(THEMES.DRIVE_MAD);
    }

    private initLights(): void {
        this.keyLight = new THREE.DirectionalLight(0xffffff, 1);
        this.keyLight.position.set(5, 5, 5);

        this.fillLight = new THREE.DirectionalLight(0xffffff, 0.5);
        this.fillLight.position.set(-5, 0, -5);

        this.pulsingLight = new THREE.PointLight(0xffffff, 1, 10);
        this.pulsingLight.position.set(0, 2, 0);

        this.ambientLight = new THREE.AmbientLight(0xffffff, 0.5);

        ///this.threeScene.add(this.keyLight, this.fillLight, this.pulsingLight, this.ambientLight);
        this.threeScene.add(this.keyLight, this.fillLight, this.ambientLight);
        this.threeScene.add(this.baseGroup);

    }

    public updateVisuals(data: SceneTheme): void {
        // 1. Update Background Gradient
        const canvas = document.createElement('canvas');
        canvas.width = 2;
        canvas.height = 512;
        const ctx = canvas.getContext('2d')!;
        const grad = ctx.createLinearGradient(0, 0, 0, 512);
        grad.addColorStop(0, data.topColor);
        grad.addColorStop(1, data.bottomColor);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 2, 512);

        if (this.threeScene.background instanceof THREE.Texture) {
            this.threeScene.background.dispose(); // Clean up memory
        }
        this.threeScene.background = new THREE.CanvasTexture(canvas);

        // 2. Update Lights
        this.keyLight.color.setHex(data.keyLightColor);
        this.keyLight.intensity = data.intensity;

        this.fillLight.color.setHex(data.fillLightColor);
        this.fillLight.intensity = data.intensity * 0.5;

        this.ambientLight.color.setHex(data.ambientColor);

        // 3. Update or Create Water
        if (!this.water) {
            this.water = new Water(3000, 3000, data.waterColor);
            this.water.mesh.scale.addScalar(5)
            this.baseGroup.position.y = -78;
            this.baseGroup.add(this.water.mesh);
        } else {
            // Assuming your Water class has a way to update color:
            (this.water.mesh.material as THREE.MeshStandardMaterial).color.setHex(data.waterColor);
        }

    }

    public update(delta: number): void {
        if (this.water) this.water.update(delta);

        this.time += delta * 0.001;
        if (this.pulsingLight) {
            this.pulsingLight.intensity = 1 + Math.sin(this.time * 2) * 0.5;
        }

        super.update(delta);
    }
}