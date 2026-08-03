import * as THREE from 'three';

type BoundsInput  = { width: number; height: number };
type MinMax       = { min: number; max: number };
type Vector3Input = { x: number; y: number; z: number };

export type ShootingStarSettings = {
    spawnDelay: MinMax;
    duration: MinMax;
    speedFactor: MinMax;
    directionX: MinMax;
    directionY: MinMax;
    startXFactor: MinMax;
    startYFactor: MinMax;
    lengthFactor: number;
    thicknessFactor: number;
    coreSharpness: number;
    maxOpacity: number;
    zOffset: number;
};

export type ShootingStarBuildConfig = {
    target: THREE.Object3D;
    position: Vector3Input;
    bounds: BoundsInput;
    tint?: number;
    resolveTint?: () => THREE.Color;
    settings?: Partial<ShootingStarSettings>;
};

type ShootingStarState = {
    active: boolean;
    timer: number;
    elapsed: number;
    duration: number;
    speed: number;
    direction: THREE.Vector2;
    localPosition: THREE.Vector2;
};

const DEFAULT_SETTINGS: ShootingStarSettings = {
    spawnDelay: { min: 1.2, max: 2.5 },
    duration: { min: 0.5, max: 0.75 },
    speedFactor: { min: 0.85, max: 1.2 },
    directionX: { min: 0.86, max: 1 },
    directionY: { min: -0.62, max: -0.34 },
    startXFactor: { min: -0.9, max: 0.4 },
    startYFactor: { min: 0.1, max: 0.9 },
    lengthFactor: 0.18,
    thicknessFactor: 0.01,
    coreSharpness: 14,
    maxOpacity: 0.5,
    zOffset: -10,
};

export default class ShootingStarEffect {
    private target?: THREE.Object3D;
    private mesh?: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
    private settings: ShootingStarSettings = { ...DEFAULT_SETTINGS };
    private bounds = { width: 16, height: 9 };
    private position = new THREE.Vector3(0, 0, -29.8);
    private resolveTint?: () => THREE.Color;

    private state: ShootingStarState = {
        active: false,
        timer: 2,
        elapsed: 0,
        duration: 0,
        speed: 0,
        direction: new THREE.Vector2(1, -0.4),
        localPosition: new THREE.Vector2(),
    };

    public build(config: ShootingStarBuildConfig): void {
        this.destroy();

        this.target = config.target;
        this.position.set(config.position.x, config.position.y, config.position.z);
        this.bounds.width = Math.max(1, config.bounds.width);
        this.bounds.height = Math.max(1, config.bounds.height);
        this.resolveTint = config.resolveTint;
        this.applySettings(config.settings);

        const geometry = new THREE.PlaneGeometry(1, 1);
        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTint: { value: new THREE.Color(config.tint ?? 0xd3e8ff) },
                uOpacity: { value: 0 },
            },
            vertexShader: `
                varying vec2 vUv;

                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform vec3 uTint;
                uniform float uOpacity;
                varying vec2 vUv;

                void main() {
                    float tail = smoothstep(0.0, 1.0, 1.0 - vUv.x);
                    float core = exp(-pow((vUv.y - 0.5) * ${this.settings.coreSharpness.toFixed(1)}, 2.0));
                    float alpha = tail * core * uOpacity;
                    gl_FragColor = vec4(uTint, alpha);
                }
            `,
            transparent: true,
            depthWrite: false,
            depthTest: false,
            blending: THREE.AdditiveBlending,
        });

        this.mesh = new THREE.Mesh(geometry, material);
        this.mesh.visible = false;
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = -989;
        this.target.add(this.mesh);
        this.applyTransform();
    }

    public setBounds(width: number, height: number): void {
        this.bounds.width = Math.max(1, width);
        this.bounds.height = Math.max(1, height);
        this.applyTransform();
    }

    public setPosition(position: Vector3Input): void {
        this.position.set(position.x, position.y, position.z);
        this.applyTransform();
    }

    public setSettings(settings: Partial<ShootingStarSettings>): void {
        this.applySettings(settings);
        if (this.mesh) {
            const nextTint = (this.mesh.material.uniforms.uTint.value as THREE.Color).clone();
            this.build({
                target: this.target!,
                position: { x: this.position.x, y: this.position.y, z: this.position.z },
                bounds: { width: this.bounds.width, height: this.bounds.height },
                resolveTint: this.resolveTint,
                tint: nextTint.getHex(),
                settings: this.settings,
            });
        }
    }

    public update(delta: number): void {
        if (!this.mesh) return;

        if (!this.state.active) {
            this.state.timer -= delta;
            if (this.state.timer <= 0) this.spawn();
            return;
        }

        this.state.elapsed += delta;
        this.state.localPosition.addScaledVector(this.state.direction, this.state.speed * delta);
        this.mesh.position.x = this.position.x + this.state.localPosition.x;
        this.mesh.position.y = this.position.y + this.state.localPosition.y;

        const lifeT = THREE.MathUtils.clamp(this.state.elapsed / this.state.duration, 0, 1);
        const visibility = Math.sin(Math.PI * lifeT);
        this.mesh.material.uniforms.uOpacity.value = visibility * this.settings.maxOpacity;

        if (lifeT >= 1) {
            this.state.active = false;
            this.state.timer = THREE.MathUtils.randFloat(this.settings.spawnDelay.min, this.settings.spawnDelay.max);
            this.mesh.visible = false;
            this.mesh.material.uniforms.uOpacity.value = 0;
        }
    }

    public destroy(): void {
        if (!this.mesh) return;

        this.mesh.parent?.remove(this.mesh);
        this.mesh.geometry.dispose();
        this.mesh.material.dispose();
        this.mesh = undefined;
        this.target = undefined;
    }

    private spawn(): void {
        if (!this.mesh) return;

        const startX = THREE.MathUtils.randFloat(
            this.bounds.width * this.settings.startXFactor.min,
            this.bounds.width * this.settings.startXFactor.max,
        );
        const startY = THREE.MathUtils.randFloat(
            this.bounds.height * this.settings.startYFactor.min,
            this.bounds.height * this.settings.startYFactor.max,
        );

        this.state.active = true;
        this.state.elapsed = 0;
        this.state.duration = THREE.MathUtils.randFloat(this.settings.duration.min, this.settings.duration.max);
        this.state.speed = this.bounds.width * THREE.MathUtils.randFloat(this.settings.speedFactor.min, this.settings.speedFactor.max);
        this.state.direction
            .set(
                THREE.MathUtils.randFloat(this.settings.directionX.min, this.settings.directionX.max),
                THREE.MathUtils.randFloat(this.settings.directionY.min, this.settings.directionY.max),
            )
            .normalize();
        this.state.localPosition.set(startX, startY);

        this.mesh.visible = true;
        this.mesh.position.set(this.position.x + startX, this.position.y + startY, this.position.z + this.settings.zOffset);
        this.mesh.rotation.z = Math.atan2(this.state.direction.y, this.state.direction.x);
        this.mesh.material.uniforms.uOpacity.value = 0;

        if (this.resolveTint) {
            this.mesh.material.uniforms.uTint.value = this.resolveTint();
        }
    }

    private applyTransform(): void {
        if (!this.mesh) return;

        this.mesh.position.z = this.position.z + this.settings.zOffset;
        this.mesh.scale.set(
            this.bounds.height * this.settings.lengthFactor,
            this.bounds.height * this.settings.thicknessFactor,
            1,
        );
    }

    private applySettings(settings?: Partial<ShootingStarSettings>): void {
        this.settings = { ...this.settings, ...(settings ?? {}) };
    }
}
