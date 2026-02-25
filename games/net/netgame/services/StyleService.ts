import * as THREE from 'three';

export class StyleService {
    public static config = {
        colorTop: { value: new THREE.Color(0xffffff) },    // Light/White tint at top
        colorBottom: { value: new THREE.Color(0x2222bb) }, // Darker/Muted tint at bottom
        rimColor: { value: new THREE.Color(0xffffff) },    // Edge highlight color
        gradStart: { value: -100.0 },
        gradEnd: { value: 10.0 },
        rimPower: { value: 20.5 },                          // Sharpness of the edge glow
        gradIntensity: { value: 1 }                      // 0 = material color only, 1 = full gradient
    };

    public static applyStyle(material: THREE.Material) {
        material.onBeforeCompile = (shader) => {
            // 1. Inject Uniforms
            shader.uniforms.uColorTop = StyleService.config.colorTop;
            shader.uniforms.uColorBottom = StyleService.config.colorBottom;
            shader.uniforms.uRimColor = StyleService.config.rimColor;
            shader.uniforms.uGradStart = StyleService.config.gradStart;
            shader.uniforms.uGradEnd = StyleService.config.gradEnd;
            shader.uniforms.uRimPower = StyleService.config.rimPower;
            shader.uniforms.uGradInt = StyleService.config.gradIntensity;

            // 2. Pass World Pos and Normal from Vertex to Fragment
            shader.vertexShader = `
                varying vec3 vWorldPos;
                varying vec3 vWorldNormal;
            ` + shader.vertexShader;

            shader.vertexShader = shader.vertexShader.replace(
                `#include <worldpos_vertex>`,
                `
                #include <worldpos_vertex>
                vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
                vWorldNormal = normalize(normalMatrix * normal);
                `
            );
            // vWorldNormal = normalize(modelMatrix * vec4(normal, 0.0)).xyz;

            // 3. Fragment Shader: Blend, don't Overwrite
            shader.fragmentShader = `
                uniform vec3 uColorTop;
                uniform vec3 uColorBottom;
                uniform vec3 uRimColor;
                uniform float uGradStart;
                uniform float uGradEnd;
                uniform float uRimPower;
                uniform float uGradInt;
                varying vec3 vWorldPos;
                varying vec3 vWorldNormal;
            ` + shader.fragmentShader;

            shader.fragmentShader = shader.fragmentShader.replace(
                `#include <color_fragment>`,
                `
                #include <color_fragment>

                // A. Calculate the Height Gradient Factor
                float h = clamp((vWorldPos.y - uGradStart) / (uGradEnd - uGradStart), 0.0, 1.0);
                vec3 heightTint = mix(uColorBottom, uColorTop, h);

                // B. Blend height tint with the original material color (diffuseColor)
                // Using 'mix' allows you to control how much the gradient affects the base color
                diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * heightTint, uGradInt);

                // C. Fresnel / Rim Lighting (The "Fall Guys" Plastic Look)
                vec3 viewDir = normalize(cameraPosition - vWorldPos);
                float fresnel = pow(1.0 - clamp(dot(viewDir, vWorldNormal), 0.0, 1.0), uRimPower);
                
                // D. Add the rim light on top (Additive)
                // This preserves the base color but adds a "shine" on the silhouette
                diffuseColor.rgb += uRimColor * fresnel * 0.4;
                `
            );
        };
    }
}