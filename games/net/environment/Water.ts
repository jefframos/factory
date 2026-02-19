import * as THREE from 'three';

export class Water {
    public mesh: THREE.Mesh;
    private geometry: THREE.PlaneGeometry;
    private initialPos: Float32Array;
    private time: number = 0;

    constructor(width: number, height: number, color: number = 0x00d4ff) {
        // High segment count (64x64) makes the waves look "high-end"
        this.geometry = new THREE.PlaneGeometry(width, height, 64, 64);
        this.geometry.rotateX(-Math.PI / 2);

        // Store a copy of the original positions to use as a baseline for the math
        this.initialPos = new Float32Array(this.geometry.attributes.position.array);

        const material = new THREE.MeshStandardMaterial({
            color: color,
            roughness: 0.1,
            metalness: 0.6,
            transparent: true,
            opacity: 0.85,
            flatShading: false // Set to true for a "low-poly" stylized look
        });

        this.mesh = new THREE.Mesh(this.geometry, material);
    }

    public update(delta: number): void {
        this.time += delta;
        const posAttribute = this.geometry.attributes.position;

        for (let i = 0; i < posAttribute.count; i++) {
            // We read from the initialPos so the math is always relative to the "flat" plane
            const x = this.initialPos[i * 3];
            const z = this.initialPos[i * 3 + 2];

            // Complex wave: combines distance from center + a scrolling sine
            const dist = Math.sqrt(x * x + z * z);
            const wave = Math.sin(dist * 0.5 - this.time * 2.0) * 1.5;
            const ripple = Math.cos(x * 0.3 + this.time * 2.0) * 0.21;

            posAttribute.setY(i, wave + ripple);
        }

        posAttribute.needsUpdate = true;
        // Re-calculate normals so the light reflections move with the waves
        this.geometry.computeVertexNormals();
    }

    public setPosition(x: number, y: number, z: number): void {
        this.mesh.position.set(x, y, z);
    }
}