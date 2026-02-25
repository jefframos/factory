import * as THREE from 'three';

export class BendService {
    // Global uniforms that all materials will share
    public static uniforms = {
        uBendOrigin: { value: new THREE.Vector3(0, 0, 0) },
        uBendAmount: { value: new THREE.Vector2(0.000175, 0.0000) } // x = horizontal bend, y = vertical drop
    };

    public static updateOrigin(position: THREE.Vector3) {
        this.uniforms.uBendOrigin.value.copy(position);
    }

    /**
     * Injects the bend logic into any Three.js material
     */
    public static applyBend(material: THREE.Material) {
        const previousOnBeforeCompile = material.onBeforeCompile;
        material.onBeforeCompile = (shader) => {
            previousOnBeforeCompile(shader);
            shader.uniforms.uBendOrigin = BendService.uniforms.uBendOrigin;
            shader.uniforms.uBendAmount = BendService.uniforms.uBendAmount;

            shader.vertexShader = `
                uniform vec3 uBendOrigin;
                uniform vec2 uBendAmount;
            ` + shader.vertexShader;

            shader.vertexShader = shader.vertexShader.replace(
                `#include <begin_vertex>`,
                `
                #include <begin_vertex>
                
                // Calculate world position of the vertex
                vec4 worldPosition = modelMatrix * vec4(transformed, 1.0);
                
                // Distance from the player/origin on the "forward" axis (X in your setup likely)
                // Adjust 'worldPosition.x' to whatever axis your truck moves along
                float dist = worldPosition.x - uBendOrigin.x;
                
                // Only bend things in front of or far from the origin
                float distSq = dist * dist;
                
                // Apply the curve
                // We modify transformed.y (vertical) and transformed.z (horizontal)
                transformed.y -= distSq * uBendAmount.y; 
                transformed.z -= distSq * uBendAmount.x;
                //transformed.z -= sin(dist * 0.005) * 10.0;
                `
            );
        };
    }
}