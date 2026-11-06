// Bend.ts
//
// The world curving away from the camera's focus (UFO's and mow's bend, without UFO's tractor-beam light): every bent
// material's vertices drop by strength × (distance from the origin)² in world space. Only vertices move, so anything
// big and flat has to be cut into small pieces to follow the curve (bendSegments()). Mob's origin is the cannon: the
// field drops away towards the enemy base like a horizon.

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

/** How far the bend drops a point at (x, z) right now. */
export function bendDrop(x: number, z: number): number {
    const origin = bendUniforms.uBendOrigin.value;
    const dx = x - origin.x;
    const dz = z - origin.z;
    return (dx * dx + dz * dz) * bendUniforms.uBendStrength.value;
}

/**
 * Bends one material (once). Three.js picks compiled shaders by a key, so the bend goes in the key or an unbent copy of
 * the same material could share a program with this one. Works on instanced meshes too (the instance's matrix first).
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

/** Bends everything under `object` — except shader materials, which bend in their own shader (Water.ts). */
export function bendObject(object: THREE.Object3D): void {
    object.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return;
        [child.material].flat().forEach((material) => {
            if (!(material instanceof THREE.ShaderMaterial)) applyBend(material);
        });
    });
}
