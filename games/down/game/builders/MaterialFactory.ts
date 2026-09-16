import * as THREE from 'three';

export class MaterialFactory {
    private static readonly OUTLINE_COLOR = 0x3a2525;
    private static readonly OUTLINE_SCALE = 1.035;

    static getToonMaterial(
        color: THREE.ColorRepresentation,
    ): THREE.MeshPhysicalMaterial {
        const material = new THREE.MeshPhysicalMaterial({
            color,
            metalness: 0,
            roughness: 0.6,

            clearcoat: 0.25,
            clearcoatRoughness: 0.45,

            ior: 1.46,
            envMapIntensity: 0.6,
        });

        material.onBeforeCompile = (shader) => {
            shader.uniforms.toonSteps = {
                value: 2,
            };

            shader.uniforms.toonShadowStrength = {
                value: 0.35,
            };

            shader.fragmentShader = shader.fragmentShader.replace(
                '#include <common>',
                `
                #include <common>

                uniform float toonSteps;
                uniform float toonShadowStrength;
                `,
            );

            shader.fragmentShader = shader.fragmentShader.replace(
                '#include <lights_fragment_begin>',
                `
                #include <lights_fragment_begin>

                float toonLight = 0.0;

                #if ( NUM_DIR_LIGHTS > 0 )

                    for ( int i = 0; i < NUM_DIR_LIGHTS; i++ ) {

                        toonLight += max(
                            dot(
                                geometryNormal,
                                directionalLights[i].direction
                            ),
                            0.0
                        );

                    }

                #endif

                toonLight = clamp(toonLight, 0.0, 1.0);

                // 3 discrete lighting bands.
                toonLight = floor(
                    toonLight * toonSteps
                ) / max(toonSteps - 1.0, 1.0);

                toonLight = mix(
                    1.0 - toonShadowStrength,
                    1.0,
                    toonLight
                );

                reflectedLight.directDiffuse *= toonLight;
                `,
            );
        };

        material.customProgramCacheKey = () => {
            return 'face-tower-toon-v2';
        };

        return material;
    }

    static getOutlineMaterial(): THREE.MeshBasicMaterial {
        return new THREE.MeshBasicMaterial({
            color: MaterialFactory.OUTLINE_COLOR,
            side: THREE.BackSide,
            depthWrite: true,
        });
    }

    static applyOutline(
        mesh: THREE.Mesh,
        outlineScale = MaterialFactory.OUTLINE_SCALE,
    ): THREE.Mesh {
        const outline = new THREE.Mesh(
            mesh.geometry,
            MaterialFactory.getOutlineMaterial(),
        );

        outline.name = 'outline';
        outline.scale.setScalar(outlineScale);

        // Render the outline before the actual body.
        outline.renderOrder = mesh.renderOrder - 1;

        // Don't let the outline interfere with the face decal.
        outline.castShadow = false;
        outline.receiveShadow = false;

        mesh.add(outline);

        return outline;
    }
}