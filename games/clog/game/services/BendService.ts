import * as THREE from 'three';

/**
 * Radial world-bend: the ground curves away from the player in all directions.
 *
 * Injects into #include <project_vertex> (not <begin_vertex>) so it works in
 * world-Y regardless of the object's own rotation (floor is rotated -PI/2 on X,
 * which would otherwise make a begin_vertex injection bend along the wrong axis).
 *
 * Tuning: uBendStrength = world-Y drop per unit² of XZ distance from origin.
 *   0.001 = very subtle   0.002 = gentle horizon   0.005 = exaggerated planet
 */
export class BendService {
    public static uniforms = {
        uBendOrigin:   { value: new THREE.Vector3() },
        uBendStrength: { value: 0.002 },
    };

    public static updateOrigin(position: THREE.Vector3): void {
        this.uniforms.uBendOrigin.value.copy(position);
    }

    public static applyBend(material: THREE.Material): void {
        const prev = material.onBeforeCompile;
        material.onBeforeCompile = (shader, renderer) => {
            prev(shader, renderer);
            shader.uniforms.uBendOrigin   = BendService.uniforms.uBendOrigin;
            shader.uniforms.uBendStrength = BendService.uniforms.uBendStrength;

            shader.vertexShader = `
                uniform vec3  uBendOrigin;
                uniform float uBendStrength;
            ` + shader.vertexShader;

            // Replace the standard project_vertex with a world-space version.
            // Working in world space (after modelMatrix) means the bend is always
            // in world-Y regardless of the object's local rotation or scale.
            // mvPosition is preserved so fog still works correctly.
            shader.vertexShader = shader.vertexShader.replace(
                `#include <project_vertex>`,
                `
                vec4 _bendWorld = modelMatrix * vec4( transformed, 1.0 );
                float _dx = _bendWorld.x - uBendOrigin.x;
                float _dz = _bendWorld.z - uBendOrigin.z;
                _bendWorld.y -= ( _dx * _dx + _dz * _dz ) * uBendStrength;
                vec4 mvPosition = viewMatrix * _bendWorld;
                gl_Position = projectionMatrix * mvPosition;
                `
            );
        };
        material.needsUpdate = true;
    }
}
