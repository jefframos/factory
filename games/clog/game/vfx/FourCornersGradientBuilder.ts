import * as THREE from 'three';

export type FourCornersGradientMode = 'simple' | 'four-way';

export type SimpleGradientColors = {
    topColor?: number;
    bottomColor?: number;
};

export type FourWayGradientColors = {
    topColor?: number;
    leftColor?: number;
    bottomColor?: number;
    rightColor?: number;
    radius?: number;
    speed?: number;
};

export type FourCornersGradientBuildConfig = {
    camera: THREE.PerspectiveCamera;
    mode?: FourCornersGradientMode;
    distance?: number;
    simple?: SimpleGradientColors;
    fourWay?: FourWayGradientColors;
};

export default class FourCornersGradientBuilder {
    private camera?: THREE.PerspectiveCamera;
    private gradientMesh?: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
    private gradientDistance = 30;
    private currentMode: FourCornersGradientMode = 'simple';
    private animationSpeed = 0;
    private time = 0;
    private readonly onResize = () => this.resize();

    public build(config: FourCornersGradientBuildConfig): void {
        this.camera = config.camera;
        this.gradientDistance = config.distance ?? 30;
        this.currentMode = config.mode ?? 'simple';

        this.disposeMesh();

        const geometry = new THREE.PlaneGeometry(1, 1);
        const material = this.currentMode === 'four-way'
            ? this.createFourWayMaterial(config.fourWay)
            : this.createSimpleMaterial(config.simple);

        this.gradientMesh = new THREE.Mesh(geometry, material);
        this.gradientMesh.frustumCulled = false;
        this.gradientMesh.renderOrder = -1000;

        this.camera.add(this.gradientMesh);
        this.resize();
        window.addEventListener('resize', this.onResize);
    }

    public resize(): void {
        if (!this.gradientMesh || !this.camera) return;

        const fovRad = THREE.MathUtils.degToRad(this.camera.getEffectiveFOV());
        const visibleHeight = 2 * Math.tan(fovRad / 2) * this.gradientDistance;
        const visibleWidth = visibleHeight * this.camera.aspect;

        this.gradientMesh.position.set(0, 0, -this.gradientDistance);
        this.gradientMesh.scale.set(visibleWidth, visibleHeight, 1);
    }

    public update(delta: number): void {
        if (!this.gradientMesh || this.currentMode !== 'four-way' || this.animationSpeed <= 0) {
            return;
        }

        this.time += delta * this.animationSpeed;
        this.gradientMesh.material.uniforms.uTime.value = this.time;
    }

    public destroy(): void {
        window.removeEventListener('resize', this.onResize);
        this.disposeMesh();
        this.camera = undefined;
        this.time = 0;
        this.animationSpeed = 0;
    }

    // Pass hex colors as raw sRGB Vector3 so THREE.js ColorManagement doesn't
    // linearize them. ShaderMaterial outputs gl_FragColor directly without the
    // automatic sRGB re-encoding that built-in materials get, so linear values
    // passed through THREE.Color would appear darker on sRGB monitors.
    private srgb(hex: number): THREE.Vector3 {
        return new THREE.Vector3(
            ((hex >> 16) & 0xff) / 255,
            ((hex >> 8)  & 0xff) / 255,
            ( hex        & 0xff) / 255,
        );
    }

    private createSimpleMaterial(colors?: SimpleGradientColors): THREE.ShaderMaterial {
        this.animationSpeed = 0;

        return new THREE.ShaderMaterial({
            uniforms: {
                colorTop:    { value: this.srgb(colors?.topColor    ?? 0x2fe214) },
                colorBottom: { value: this.srgb(colors?.bottomColor ?? 0x00e5ff) },
            },
            vertexShader: `
                varying vec2 vUv;

                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform vec3 colorTop;
                uniform vec3 colorBottom;
                varying vec2 vUv;

                void main() {
                    gl_FragColor = vec4(mix(colorBottom, colorTop, vUv.y), 1.0);
                }
            `,
            depthWrite: false,
            depthTest: false,
            side: THREE.DoubleSide,
        });
    }

    private createFourWayMaterial(colors?: FourWayGradientColors): THREE.ShaderMaterial {
        const radius = Math.max(0.1, colors?.radius ?? 1.25);
        this.animationSpeed = Math.max(0, colors?.speed ?? 0.2);

        return new THREE.ShaderMaterial({
            uniforms: {
                colorTop:    { value: this.srgb(colors?.topColor    ?? 0x197bd4) },
                colorLeft:   { value: this.srgb(colors?.leftColor   ?? 0x3054ea) },
                colorBottom: { value: this.srgb(colors?.bottomColor ?? 0x181727) },
                colorRight:  { value: this.srgb(colors?.rightColor  ?? 0x00b8ff) },
                uRadius: { value: radius },
                uTime: { value: 0 },
            },
            vertexShader: `
                varying vec2 vUv;

                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform vec3 colorTop;
                uniform vec3 colorLeft;
                uniform vec3 colorBottom;
                uniform vec3 colorRight;
                uniform float uRadius;
                uniform float uTime;
                varying vec2 vUv;

                float weightPow(float v) {
                    return pow(clamp(v, 0.0, 1.0), 2.2);
                }

                void main() {
                    vec2 p = vUv * 2.0 - 1.0;
                    vec2 centerOffset = vec2(
                        sin(uTime * 0.9) * 0.25,
                        cos(uTime * 0.9) * 0.25
                    );

                    vec2 normalized = (p - centerOffset) / max(uRadius, 0.001);

                    float topW = weightPow((normalized.y + 1.0) * 0.5);
                    float bottomW = weightPow((-normalized.y + 1.0) * 0.5);
                    float leftW = weightPow((-normalized.x + 1.0) * 0.5);
                    float rightW = weightPow((normalized.x + 1.0) * 0.5);

                    float total = max(topW + bottomW + leftW + rightW, 0.0001);

                    vec3 color = (
                        colorTop * topW
                        + colorBottom * bottomW
                        + colorLeft * leftW
                        + colorRight * rightW
                    ) / total;

                    gl_FragColor = vec4(color, 1.0);
                }
            `,
            depthWrite: false,
            depthTest: false,
            side: THREE.DoubleSide,
        });
    }

    private disposeMesh(): void {
        if (!this.gradientMesh) {
            return;
        }

        this.gradientMesh.parent?.remove(this.gradientMesh);
        this.gradientMesh.geometry.dispose();
        this.gradientMesh.material.dispose();
        this.gradientMesh = undefined;
    }
}
