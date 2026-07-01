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

    /**
     * Fades diffuseColor.a between two world-Y heights.
     * Fully opaque at/above fadeFrom, fully transparent at/below fadeTo.
     */
    public static applyBottomFade(material: THREE.Material, fadeFrom: number, fadeTo: number): void {
        material.transparent = true;
        const prev = material.onBeforeCompile;
        material.onBeforeCompile = (shader, renderer) => {
            prev(shader, renderer);
            shader.uniforms.uFadeFrom = { value: fadeFrom };
            shader.uniforms.uFadeTo   = { value: fadeTo };
            shader.vertexShader   = 'varying float vWorldY;\n' + shader.vertexShader;
            shader.fragmentShader = 'uniform float uFadeFrom;\nuniform float uFadeTo;\nvarying float vWorldY;\n' + shader.fragmentShader;
            shader.vertexShader = shader.vertexShader.replace(
                '#include <begin_vertex>',
                '#include <begin_vertex>\nvWorldY = (modelMatrix * vec4(position, 1.0)).y;',
            );
            // diffuseColor.a is used directly in output_fragment — safer than patching gl_FragColor
            shader.fragmentShader = shader.fragmentShader.replace(
                '#include <alphamap_fragment>',
                '#include <alphamap_fragment>\ndiffuseColor.a *= smoothstep(uFadeTo, uFadeFrom, vWorldY);',
            );
        };
        material.needsUpdate = true;
    }

    /**
     * Fades diffuseColor.a by XZ distance from the player.
     * Fully opaque within fadeStart, fully transparent at fadeEnd.
     * Reuses uBendOrigin so no extra per-frame update is needed.
     */
    public static applyDistanceFade(material: THREE.Material, fadeStart: number, fadeEnd: number): void {
        material.transparent = true;
        const prev = material.onBeforeCompile;
        material.onBeforeCompile = (shader, renderer) => {
            prev(shader, renderer);
            shader.uniforms.uBendOrigin = BendService.uniforms.uBendOrigin;
            shader.uniforms.uDistFadeStart = { value: fadeStart };
            shader.uniforms.uDistFadeEnd   = { value: fadeEnd };
            shader.vertexShader = 'varying vec2 vWorldXZ;\n' + shader.vertexShader;
            shader.fragmentShader = [
                'uniform vec3  uBendOrigin;',
                'uniform float uDistFadeStart;',
                'uniform float uDistFadeEnd;',
                'varying vec2  vWorldXZ;',
            ].join('\n') + '\n' + shader.fragmentShader;
            shader.vertexShader = shader.vertexShader.replace(
                '#include <begin_vertex>',
                '#include <begin_vertex>\nvWorldXZ = (modelMatrix * vec4(position, 1.0)).xz;',
            );
            shader.fragmentShader = shader.fragmentShader.replace(
                '#include <alphamap_fragment>',
                '#include <alphamap_fragment>\nfloat _xzDist = length(vWorldXZ - uBendOrigin.xz);\ndiffuseColor.a *= 1.0 - smoothstep(uDistFadeStart, uDistFadeEnd, _xzDist);',
            );
        };
        material.needsUpdate = true;
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
