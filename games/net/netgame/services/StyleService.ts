import * as THREE from 'three';

export class StyleService {
    public static config = {
        colorTop: { value: new THREE.Color(0x7CFF01) },    // Color above End point
        colorBottom: { value: new THREE.Color(0x0072ff) }, // Color below Start point
        gradStart: { value: -50.0 },                      // World Y where gradient begins
        gradEnd: { value: 200.0 },                        // World Y where gradient ends
        pixelSize: { value: 5.0 }                         // Size of the color steps
    };

    public static applyStyle(material: THREE.Material) {
        const previousOnBeforeCompile = material.onBeforeCompile;
        material.onBeforeCompile = (shader) => {
            previousOnBeforeCompile(shader);
            // 1. Inject Uniforms
            shader.uniforms.uColorTop = StyleService.config.colorTop;
            shader.uniforms.uColorBottom = StyleService.config.colorBottom;
            shader.uniforms.uGradStart = StyleService.config.gradStart;
            shader.uniforms.uGradEnd = StyleService.config.gradEnd;
            shader.uniforms.uPixelSize = StyleService.config.pixelSize;

            // 2. Fragment Shader Headers
            shader.fragmentShader = `
                uniform vec3 uColorTop;
                uniform vec3 uColorBottom;
                uniform float uGradStart;
                uniform float uGradEnd;
                uniform float uPixelSize;
                varying vec3 vWorldPos;
            ` + shader.fragmentShader;

            // 3. Vertex Shader: Capture World Position
            shader.vertexShader = `
                varying vec3 vWorldPos;
            ` + shader.vertexShader;

            shader.vertexShader = shader.vertexShader.replace(
                `#include <worldpos_vertex>`,
                `
                #include <worldpos_vertex>
                vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
                `
            );

            // 4. Fragment Shader: Clamped Linear Interpolation with Pixelation
            shader.fragmentShader = shader.fragmentShader.replace(
                `#include <color_fragment>`,
                `
                #include <color_fragment>
                
                // 1. Pixelate the world Y position
                float pixY = floor(vWorldPos.y / uPixelSize) * uPixelSize;
                
                // 2. Map pixY to a 0.0 - 1.0 range between Start and End
                // formula: (value - min) / (max - min)
                float range = uGradEnd - uGradStart;
                float factor = (pixY - uGradStart) / range;
                
                // 3. Clamp the factor so it doesn't go below 0 or above 1
                factor = clamp(factor, 0.0, 1.0);
                
                // 4. Mix and apply
                vec3 finalGradColor = mix(uColorBottom, uColorTop, factor);
                diffuseColor.rgb *= finalGradColor;
                `
            );
        };
    }
}