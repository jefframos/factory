import * as THREE from 'three';
import ShootingStarEffect, { type ShootingStarSettings } from './ShootingStarEffect';

type BoundsInput  = { width: number; height: number };
type Vector2Input = { x: number; y: number };
type Vector3Input = { x: number; y: number; z: number };

type StarfieldMotionConfig = {
    angleDeg: number;
    speed: number;
};

export type StarfieldBackgroundBuildConfig = {
    target: THREE.Object3D;
    position?: Vector3Input;
    bounds?: BoundsInput;
    starCount?: number;
    colorA?: number;
    colorB?: number;
    colorTransitionSpeed?: number;
    velocity?: Vector2Input;
    motion?: Partial<StarfieldMotionConfig>;
    shootingStar?: Partial<ShootingStarSettings>;
};

export default class StarfieldBackground {
    private target?: THREE.Object3D;
    private points?: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
    private pointsGeometry?: THREE.BufferGeometry;
    private pointsMaterial?: THREE.ShaderMaterial;
    private shootingStarEffect: ShootingStarEffect = new ShootingStarEffect();

    private position = new THREE.Vector3(0, 0, -29.8);
    private starCount = 460;
    private colorTransitionSpeed = 0.12;
    private velocity = new THREE.Vector2(0.7, -0.12);
    private motionAngleDeg = -9.73;
    private motionSpeed = 0.71;
    private colorPhase = 0;

    private visibleWidth = 16;
    private visibleHeight = 9;
    private halfWidth = 0.5;
    private halfHeight = 0.5;

    private starPositions?: Float32Array;
    private starDepths?: Float32Array;

    public build(config: StarfieldBackgroundBuildConfig): void {
        this.target = config.target;
        this.position.set(
            config.position?.x ?? 0,
            config.position?.y ?? 0,
            config.position?.z ?? -29.8,
        );
        this.visibleWidth = Math.max(1, config.bounds?.width ?? 16);
        this.visibleHeight = Math.max(1, config.bounds?.height ?? 9);
        this.halfWidth = this.visibleWidth * 0.5;
        this.halfHeight = this.visibleHeight * 0.5;
        this.starCount = Math.max(50, Math.floor(config.starCount ?? 460));
        this.colorTransitionSpeed = Math.max(0, config.colorTransitionSpeed ?? 0.12);

        const velocityX = config.velocity?.x ?? 0.7;
        const velocityY = config.velocity?.y ?? -0.12;
        const defaultSpeed = Math.hypot(velocityX, velocityY);
        const defaultAngleDeg = THREE.MathUtils.radToDeg(Math.atan2(velocityY, velocityX));

        this.motionAngleDeg = config.motion?.angleDeg ?? defaultAngleDeg;
        this.motionSpeed = Math.max(0, config.motion?.speed ?? defaultSpeed);
        this.syncVelocityFromMotion();

        this.dispose();
        this.createStars(config.colorA ?? 0x9fd3ff, config.colorB ?? 0xe1f4ff);
        this.shootingStarEffect.build({
            target: this.target,
            position: { x: this.position.x, y: this.position.y, z: this.position.z },
            bounds: { width: this.visibleWidth, height: this.visibleHeight },
            resolveTint: () => this.getCurrentStarTint(),
            settings: config.shootingStar,
        });
        this.applyTransforms();
    }

    public setBounds(width: number, height: number): void {
        this.visibleWidth = Math.max(1, width);
        this.visibleHeight = Math.max(1, height);
        this.halfWidth = this.visibleWidth * 0.5;
        this.halfHeight = this.visibleHeight * 0.5;
        this.shootingStarEffect.setBounds(this.visibleWidth, this.visibleHeight);
        this.applyTransforms();
    }

    public setPosition(position: Vector3Input): void {
        this.position.set(position.x, position.y, position.z);
        this.shootingStarEffect.setPosition(position);
        this.applyTransforms();
    }

    public setShootingStarSettings(settings: Partial<ShootingStarSettings>): void {
        this.shootingStarEffect.setSettings(settings);
    }

    public setMotion(angleDeg: number, speed: number): void {
        this.motionAngleDeg = angleDeg;
        this.motionSpeed = Math.max(0, speed);
        this.syncVelocityFromMotion();
    }

    public setMotionAngle(angleDeg: number): void {
        this.motionAngleDeg = angleDeg;
        this.syncVelocityFromMotion();
    }

    public setMotionSpeed(speed: number): void {
        this.motionSpeed = Math.max(0, speed);
        this.syncVelocityFromMotion();
    }

    public resize(): void {
        this.applyTransforms();
    }

    public update(delta: number): void {
        if (!this.pointsGeometry || !this.pointsMaterial || !this.starPositions || !this.starDepths) return;

        this.colorPhase += delta * this.colorTransitionSpeed;
        this.pointsMaterial.uniforms.uColorMix.value = (Math.sin(this.colorPhase) + 1) * 0.5;

        const margin = 0.7;
        const maxX = this.halfWidth + margin;
        const minX = -this.halfWidth - margin;
        const maxY = this.halfHeight + margin;
        const minY = -this.halfHeight - margin;

        for (let i = 0; i < this.starCount; i += 1) {
            const index = i * 3;
            const depth = this.starDepths[i];
            const speedScale = THREE.MathUtils.lerp(0.2, 1.15, depth);

            this.starPositions[index]     += this.velocity.x * speedScale * delta;
            this.starPositions[index + 1] += this.velocity.y * speedScale * delta;

            if (this.starPositions[index] > maxX)       this.starPositions[index] = minX;
            else if (this.starPositions[index] < minX)  this.starPositions[index] = maxX;

            if (this.starPositions[index + 1] > maxY)       this.starPositions[index + 1] = minY;
            else if (this.starPositions[index + 1] < minY)  this.starPositions[index + 1] = maxY;
        }

        this.pointsGeometry.attributes.position.needsUpdate = true;
        this.shootingStarEffect.update(delta);
    }

    public destroy(): void {
        this.dispose();
        this.target = undefined;
        this.starPositions = undefined;
        this.starDepths = undefined;
    }

    private syncVelocityFromMotion(): void {
        const angleRad = THREE.MathUtils.degToRad(this.motionAngleDeg);
        this.velocity.set(Math.cos(angleRad) * this.motionSpeed, Math.sin(angleRad) * this.motionSpeed);
    }

    private applyTransforms(): void {
        if (this.points) this.points.position.copy(this.position);
    }

    private createStars(colorA: number, colorB: number): void {
        if (!this.target) return;

        const positions = new Float32Array(this.starCount * 3);
        const sizes     = new Float32Array(this.starCount);
        const depths    = new Float32Array(this.starCount);

        for (let i = 0; i < this.starCount; i += 1) {
            const index = i * 3;
            positions[index]     = THREE.MathUtils.randFloatSpread(this.visibleWidth);
            positions[index + 1] = THREE.MathUtils.randFloatSpread(this.visibleHeight);
            positions[index + 2] = 0;

            const depth = Math.random();
            depths[i] = depth;
            sizes[i]  = THREE.MathUtils.lerp(1.0, 5.0, depth);
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('aSize',    new THREE.BufferAttribute(sizes, 1));
        geometry.setAttribute('aDepth',   new THREE.BufferAttribute(depths, 1));

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uColorA:    { value: new THREE.Color(colorA) },
                uColorB:    { value: new THREE.Color(colorB) },
                uColorMix:  { value: 0 },
                uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) },
            },
            vertexShader: `
                attribute float aSize;
                attribute float aDepth;
                varying float vDepth;
                uniform float uPixelRatio;
                void main() {
                    vDepth = aDepth;
                    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                    gl_PointSize = aSize * uPixelRatio * mix(0.7, 1.3, aDepth);
                    gl_Position = projectionMatrix * mvPosition;
                }
            `,
            fragmentShader: `
                uniform vec3 uColorA;
                uniform vec3 uColorB;
                uniform float uColorMix;
                varying float vDepth;
                void main() {
                    vec2 p = gl_PointCoord - 0.5;
                    float dist = length(p);
                    float alpha = smoothstep(0.52, 0.0, dist) * mix(0.3, 0.9, vDepth);
                    vec3 color = mix(uColorA, uColorB, uColorMix);
                    color = mix(color * 0.75, color, vDepth);
                    gl_FragColor = vec4(color, alpha);
                }
            `,
            transparent: true,
            depthWrite: false,
            depthTest: false,
            blending: THREE.AdditiveBlending,
        });

        const points = new THREE.Points(geometry, material);
        points.frustumCulled = false;
        points.renderOrder = -990;

        this.target.add(points);
        this.points = points;
        this.pointsGeometry = geometry;
        this.pointsMaterial = material;
        this.starPositions = positions;
        this.starDepths = depths;
    }

    private getCurrentStarTint(): THREE.Color {
        if (!this.pointsMaterial) return new THREE.Color(0xd3e8ff);
        const colorMix = this.pointsMaterial.uniforms.uColorMix.value as number;
        const colorA   = this.pointsMaterial.uniforms.uColorA.value as THREE.Color;
        const colorB   = this.pointsMaterial.uniforms.uColorB.value as THREE.Color;
        return colorA.clone().lerp(colorB, colorMix);
    }

    private dispose(): void {
        if (this.points) {
            this.points.parent?.remove(this.points);
            this.pointsGeometry?.dispose();
            this.pointsMaterial?.dispose();
            this.points = undefined;
            this.pointsGeometry = undefined;
            this.pointsMaterial = undefined;
        }
        this.shootingStarEffect.destroy();
    }
}
