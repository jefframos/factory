import * as THREE from 'three';

/**
 * Radial world-bend: the ground (and everything else bent) curves away from
 * the player in all directions.
 *
 * Injects into #include <project_vertex> (not <begin_vertex>) so it works in
 * world-Y regardless of the object's own rotation (the floor is rotated
 * -PI/2 on X, which would otherwise make a begin_vertex injection bend along
 * the wrong axis).
 *
 * Tuning: uBendStrength = world-Y drop per unit^2 of XZ distance from origin.
 *   0.001 = very subtle   0.002 = gentle horizon   0.005 = exaggerated planet
 */
export class BendService {
    public static uniforms = {
        uBendOrigin: { value: new THREE.Vector3() },
        uBendStrength: { value: 0.002 },
    };

    public static updateOrigin(position: THREE.Vector3): void {
        this.uniforms.uBendOrigin.value.copy(position);
    }

    /**
     * Materials bent more than once (e.g. a mesh traversal calling applyBend()
     * per submesh, when several submeshes share one material) would otherwise
     * chain onBeforeCompile twice, duplicating the uniform declaration and
     * failing to compile. This guard lets any caller call applyBend() as many
     * times as convenient on the same material with no ill effect.
     */
    private static readonly bentMaterials = new WeakSet<THREE.Material>();

    public static applyBend(material: THREE.Material): void {
        if (BendService.bentMaterials.has(material)) {
            return;
        }
        BendService.bentMaterials.add(material);

        const prev = material.onBeforeCompile;
        material.onBeforeCompile = (shader, renderer) => {
            prev(shader, renderer);
            shader.uniforms.uBendOrigin = BendService.uniforms.uBendOrigin;
            shader.uniforms.uBendStrength = BendService.uniforms.uBendStrength;

            shader.vertexShader = `
                uniform vec3  uBendOrigin;
                uniform float uBendStrength;
            ` + shader.vertexShader;

            // Working in world space (after modelMatrix) means the bend is always
            // in world-Y regardless of the object's local rotation or scale.
            shader.vertexShader = shader.vertexShader.replace(
                `#include <project_vertex>`,
                `
                vec4 _bendLocal = vec4( transformed, 1.0 );
                #ifdef USE_INSTANCING
                    _bendLocal = instanceMatrix * _bendLocal;
                #endif
                vec4 _bendWorld = modelMatrix * _bendLocal;
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
