// Bend.ts
//
// The world curving away from the camera's focus, like the mow game's: every material's vertices drop by
// strength × (distance from the origin)² in world space. Only vertices move, so anything big and flat has to be cut
// into small pieces to follow the curve (bendSegments(), Subdivide.ts). The strength is `camera.bend` in ui/ufo.json.
//
// Three.js culls by an object's unbent position, which the bend leaves well above where it's drawn: things pop out
// while still on screen. BendCuller does that test at the bent position instead.

import * as THREE from 'three';

/** How long a piece of flat geometry gets (world units). */
const SEGMENT = 1;

export const bendUniforms = {
    uBendOrigin: { value: new THREE.Vector3() },
    uBendStrength: { value: 0 },
};

const bent = new WeakSet<THREE.Material>();

/** How many pieces something `length` long needs to follow the bend. */
export const bendSegments = (length: number): number => Math.max(1, Math.ceil(length / SEGMENT));

export function updateBend(origin: THREE.Vector3, strength: number): void {
    bendUniforms.uBendOrigin.value.copy(origin);
    bendUniforms.uBendStrength.value = strength;
}

/**
 * Bends one material (once). A material's clone doesn't keep this: bend the clone too. Three.js picks compiled shaders
 * by a key, so the bend goes in the key or an unbent copy of the same material could share a program with this one.
 */
export function applyBend(material: THREE.Material): void {
    if (bent.has(material)) return;
    bent.add(material);
    const previousKey = material.customProgramCacheKey.bind(material);
    material.customProgramCacheKey = () => `${previousKey()}|bend`;
    const previous = material.onBeforeCompile;
    material.onBeforeCompile = (shader, renderer) => {
        previous(shader, renderer);
        shader.uniforms.uBendOrigin = bendUniforms.uBendOrigin;
        shader.uniforms.uBendStrength = bendUniforms.uBendStrength;
        shader.vertexShader = `uniform vec3 uBendOrigin;\nuniform float uBendStrength;\n${shader.vertexShader}`.replace('#include <project_vertex>', `
            vec4 _bendLocal = vec4(transformed, 1.0);
            #ifdef USE_INSTANCING
                _bendLocal = instanceMatrix * _bendLocal;
            #endif
            vec4 _bendWorld = modelMatrix * _bendLocal;
            float _bendX = _bendWorld.x - uBendOrigin.x;
            float _bendZ = _bendWorld.z - uBendOrigin.z;
            _bendWorld.y -= (_bendX * _bendX + _bendZ * _bendZ) * uBendStrength;
            vec4 mvPosition = viewMatrix * _bendWorld;
            gl_Position = projectionMatrix * mvPosition;
        `);
    };
    material.needsUpdate = true;
}

/** Bends everything under `object`. */
export function bendObject(object: THREE.Object3D): void {
    object.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return;
        [child.material].flat().forEach((material) => applyBend(material));
    });
}

interface Culled {
    object: THREE.Object3D;
    /** Its bounding sphere, unbent. */
    center: THREE.Vector3;
    radius: number;
}

/** Hides what's off screen, testing where the bend really draws it. Three.js's own test is off for what it tracks. */
export class BendCuller {
    private readonly entries = new Map<THREE.Object3D, Culled>();
    private readonly frustum = new THREE.Frustum();
    private readonly matrix = new THREE.Matrix4();
    private readonly sphere = new THREE.Sphere();

    /** Tracks `object`, measured where it stands (it doesn't move). */
    public addStatic(object: THREE.Object3D): void {
        const sphere = new THREE.Box3().setFromObject(object).getBoundingSphere(new THREE.Sphere());
        this.add(object, sphere.center, sphere.radius);
    }

    /** Tracks `object`; `center` can be moved by the caller while it drives around. */
    public add(object: THREE.Object3D, center: THREE.Vector3, radius: number): void {
        object.traverse((child) => {
            child.frustumCulled = false;
        });
        this.entries.set(object, { object, center, radius });
    }

    /** No longer tracked, and shown. */
    public remove(object: THREE.Object3D): void {
        if (this.entries.delete(object)) object.visible = true;
    }

    /** Call with the camera placed and the bend updated. */
    public update(camera: THREE.Camera): void {
        camera.updateMatrixWorld();
        this.frustum.setFromProjectionMatrix(this.matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
        const origin = bendUniforms.uBendOrigin.value;
        const k = bendUniforms.uBendStrength.value;
        for (const { object, center, radius } of this.entries.values()) {
            const d = Math.hypot(center.x - origin.x, center.z - origin.z);
            // Across a sphere the drop runs from k(d - r)² to k(d + r)²: its middle, and half of that range on the radius.
            this.sphere.center.set(center.x, center.y - k * (d * d + radius * radius), center.z);
            this.sphere.radius = radius + 2 * k * d * radius;
            object.visible = this.frustum.intersectsSphere(this.sphere);
        }
    }
}
