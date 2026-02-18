import * as THREE from 'three';

export class ThreeCameraService {
    // Existing Config
    public distance: number = 400;
    public orbitAngle: number = 0;
    public elevationAngle: number = 0.2;
    public lerpFactor: number = 0.1;

    // New Properties
    private _background: string = '#1099bb';
    private _fogColor: string = '#1099bb';
    private _fogNear: number = 10;
    private _fogFar: number = 2000;

    private currentTargetPos = new THREE.Vector3();

    constructor(
        private camera: THREE.PerspectiveCamera,
        private scene: THREE.Scene,
        private renderer: THREE.WebGLRenderer
    ) {
        this.updateFog();
        this.updateBackground();
    }

    /**
     * Camera Far Plane (Render Distance)
     */
    public get renderDistance(): number { return this.camera.far; }
    public set renderDistance(val: number) {
        this.camera.far = val;
        this.camera.updateProjectionMatrix();
    }

    /**
     * Background Color
     */
    public get background(): string { return this._background; }
    public set background(hex: string) {
        this._background = hex;
        this.updateBackground();
    }

    private updateBackground() {
        this.renderer.setClearColor(this._background);
        // If you want the scene background to also be this color:
        // this.scene.background = new THREE.Color(this._background);
    }

    /**
     * Fog Management
     */
    public get fogNear(): number { return this._fogNear; }
    public set fogNear(v: number) { this._fogNear = v; this.updateFog(); }

    public get fogFar(): number { return this._fogFar; }
    public set fogFar(v: number) { this._fogFar = v; this.updateFog(); }

    public get fogColor(): string { return this._fogColor; }
    public set fogColor(v: string) { this._fogColor = v; this.updateFog(); }

    private updateFog() {
        this.scene.fog = new THREE.Fog(this._fogColor, this._fogNear, this._fogFar);
    }

    public update(target: { x: number, y: number }): void {
        const target3D = new THREE.Vector3(target.x, -target.y, 0);
        this.currentTargetPos.lerp(target3D, this.lerpFactor);

        const x = this.currentTargetPos.x + this.distance * Math.sin(this.orbitAngle) * Math.cos(this.elevationAngle);
        const y = this.currentTargetPos.y + this.distance * Math.sin(this.elevationAngle);
        const z = this.currentTargetPos.z + this.distance * Math.cos(this.orbitAngle) * Math.cos(this.elevationAngle);

        this.camera.position.set(x, y, z);
        this.camera.lookAt(this.currentTargetPos);
    }

    public teleport(target: { x: number, y: number }): void {
        this.currentTargetPos.set(target.x, -target.y, 0);
        this.update(target);
    }
}