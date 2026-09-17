// RunnerBendService.ts
//
// Dynamic curved-world deformation for runner minigames.
//
// The bend is still DEPTH-ONLY:
// a vertex's X position never affects how much it bends.
// Every vertex at the same depth receives the same displacement,
// keeping the full track cross-section together.
//
// Unlike the original single-sine implementation, this version combines
// multiple waves and slowly changes their phase/strength based on player
// progress. This prevents the level from feeling like:
//
//     left -> right -> left -> right
//
// and instead produces longer, less predictable sections more similar to
// an authored endless-runner path.
//
// IMPORTANT:
// The bend itself remains relative to the player:
//
//     depth = vertexWorldZ - playerWorldZ
//
// so geometry near the player remains stable.
//
// X = horizontal turns.
// Y = hills.

import * as THREE from 'three';

export class RunnerBendService {
    public static uniforms = {
        uBendOrigin: {
            value: new THREE.Vector3(),
        },

        // -----------------------------------------------------------------
        // Horizontal turns
        // -----------------------------------------------------------------

        /**
         * Maximum horizontal displacement.
         */
        uBendXAmplitude: {
            value: 10,
        },

        /**
         * Main horizontal frequency.
         *
         * Lower = longer turns.
         */
        uBendXFrequency: {
            value: 0.072,
        },

        /**
         * Strength of the second horizontal wave.
         */
        uBendXSecondaryStrength: {
            value: 0.45,
        },

        /**
         * Strength of the third horizontal wave.
         */
        uBendXTertiaryStrength: {
            value: 0.82,
        },

        // -----------------------------------------------------------------
        // Vertical hills
        // -----------------------------------------------------------------

        /**
         * Maximum vertical displacement.
         */
        uBendYAmplitude: {
            value: 20,
        },

        /**
         * Main hill frequency.
         */
        uBendYFrequency: {
            value: 0.054,
        },

        /**
         * Strength of the second vertical wave.
         */
        uBendYSecondaryStrength: {
            value: 0.35,
        },

        /**
         * Strength of the third vertical wave.
         */
        uBendYTertiaryStrength: {
            value: 0.85,
        },

        // -----------------------------------------------------------------
        // Distance envelope
        // -----------------------------------------------------------------

        /**
         * Controls how quickly the deformation becomes visible.
         *
         * 1 / (60 * 60) means the envelope reaches its maximum
         * at roughly 60 world units away from the player.
         */
        uBendGrowth: {
            value: 1 / (60 * 60),
        },

        // -----------------------------------------------------------------
        // World progression
        // -----------------------------------------------------------------

        /**
         * Controls how quickly the CHARACTER of the path changes
         * as the player moves through the world.
         *
         * This should be much slower than the actual bend frequencies.
         */
        uProgressFrequency: {
            value: 0.004,
        },
    };

    private static readonly bentMaterials = new WeakSet<THREE.Material>();

    /**
     * Player / camera bend origin in world space.
     */
    public static updateOrigin(position: THREE.Vector3): void {
        RunnerBendService.uniforms.uBendOrigin.value.copy(position);
    }

    /**
     * Applies the runner bend shader modification.
     */
    public static applyBend(material: THREE.Material): void {
        if (RunnerBendService.bentMaterials.has(material)) {
            return;
        }

        RunnerBendService.bentMaterials.add(material);

        const previousOnBeforeCompile = material.onBeforeCompile;

        material.onBeforeCompile = (shader, renderer) => {
            previousOnBeforeCompile(shader, renderer);

            // -------------------------------------------------------------
            // Uniform bindings
            // -------------------------------------------------------------

            shader.uniforms.uBendOrigin =
                RunnerBendService.uniforms.uBendOrigin;

            shader.uniforms.uBendXAmplitude =
                RunnerBendService.uniforms.uBendXAmplitude;

            shader.uniforms.uBendXFrequency =
                RunnerBendService.uniforms.uBendXFrequency;

            shader.uniforms.uBendXSecondaryStrength =
                RunnerBendService.uniforms.uBendXSecondaryStrength;

            shader.uniforms.uBendXTertiaryStrength =
                RunnerBendService.uniforms.uBendXTertiaryStrength;

            shader.uniforms.uBendYAmplitude =
                RunnerBendService.uniforms.uBendYAmplitude;

            shader.uniforms.uBendYFrequency =
                RunnerBendService.uniforms.uBendYFrequency;

            shader.uniforms.uBendYSecondaryStrength =
                RunnerBendService.uniforms.uBendYSecondaryStrength;

            shader.uniforms.uBendYTertiaryStrength =
                RunnerBendService.uniforms.uBendYTertiaryStrength;

            shader.uniforms.uBendGrowth =
                RunnerBendService.uniforms.uBendGrowth;

            shader.uniforms.uProgressFrequency =
                RunnerBendService.uniforms.uProgressFrequency;

            // -------------------------------------------------------------
            // Shader uniforms + helper functions
            // -------------------------------------------------------------

            shader.vertexShader = `
                uniform vec3 uBendOrigin;

                uniform float uBendXAmplitude;
                uniform float uBendXFrequency;
                uniform float uBendXSecondaryStrength;
                uniform float uBendXTertiaryStrength;

                uniform float uBendYAmplitude;
                uniform float uBendYFrequency;
                uniform float uBendYSecondaryStrength;
                uniform float uBendYTertiaryStrength;

                uniform float uBendGrowth;

                uniform float uProgressFrequency;

                // ---------------------------------------------------------
                // Horizontal curve
                //
                // Several non-matching frequencies are combined.
                //
                // "progress" changes the phase of those waves extremely
                // slowly as the player moves through the level.
                //
                // This gives us different-looking sections without obvious
                // repetition.
                // ---------------------------------------------------------

                float runnerCurveX(float depth, float progress) {
                    float progressPhase =
                        progress * uProgressFrequency;

                    // Very slow evolution of the overall section.
                    float phaseA =
                        sin(progressPhase * 0.73) * 2.5;

                    float phaseB =
                        sin(progressPhase * 1.31 + 2.1) * 4.0;

                    float phaseC =
                        sin(progressPhase * 0.41 + 4.7) * 5.0;

                    // Slowly change how important the secondary curves are.
                    float secondaryVariation =
                        0.65
                        + 0.35
                        * sin(progressPhase * 0.57 + 1.3);

                    float tertiaryVariation =
                        0.55
                        + 0.45
                        * sin(progressPhase * 0.29 + 3.6);

                    float primary =
                        sin(
                            depth * uBendXFrequency
                            + phaseA
                        );

                    float secondary =
                        sin(
                            depth
                            * uBendXFrequency
                            * 0.43
                            + phaseB
                        )
                        * uBendXSecondaryStrength
                        * secondaryVariation;

                    float tertiary =
                        sin(
                            depth
                            * uBendXFrequency
                            * 0.17
                            + phaseC
                        )
                        * uBendXTertiaryStrength
                        * tertiaryVariation;

                    float totalStrength =
                        1.0
                        + uBendXSecondaryStrength
                        + uBendXTertiaryStrength;

                    return (
                        primary
                        + secondary
                        + tertiary
                    ) / totalStrength;
                }

                // ---------------------------------------------------------
                // Vertical curve
                //
                // Uses completely different ratios and progression phases
                // so hills do not synchronize with turns.
                // ---------------------------------------------------------

                float runnerCurveY(float depth, float progress) {
                    float progressPhase =
                        progress * uProgressFrequency;

                    float phaseA =
                        sin(progressPhase * 0.51 + 1.7) * 2.0;

                    float phaseB =
                        sin(progressPhase * 0.91 + 3.9) * 3.0;

                    float phaseC =
                        sin(progressPhase * 0.33 + 5.4) * 4.0;

                    float secondaryVariation =
                        0.7
                        + 0.3
                        * sin(progressPhase * 0.47 + 2.4);

                    float tertiaryVariation =
                        0.6
                        + 0.4
                        * sin(progressPhase * 0.21 + 5.1);

                    float primary =
                        sin(
                            depth * uBendYFrequency
                            + phaseA
                        );

                    float secondary =
                        sin(
                            depth
                            * uBendYFrequency
                            * 0.37
                            + phaseB
                        )
                        * uBendYSecondaryStrength
                        * secondaryVariation;

                    float tertiary =
                        sin(
                            depth
                            * uBendYFrequency
                            * 0.13
                            + phaseC
                        )
                        * uBendYTertiaryStrength
                        * tertiaryVariation;

                    float totalStrength =
                        1.0
                        + uBendYSecondaryStrength
                        + uBendYTertiaryStrength;

                    return (
                        primary
                        + secondary
                        + tertiary
                    ) / totalStrength;
                }
            ` + shader.vertexShader;

            // -------------------------------------------------------------
            // Vertex projection replacement
            // -------------------------------------------------------------

            shader.vertexShader = shader.vertexShader.replace(
                '#include <project_vertex>',
                `
                    // -----------------------------------------------------
                    // Convert vertex to world space.
                    // -----------------------------------------------------

                    vec4 _bendLocal =
                        vec4(transformed, 1.0);

                    #ifdef USE_INSTANCING
                        _bendLocal =
                            instanceMatrix
                            * _bendLocal;
                    #endif

                    vec4 _bendWorld =
                        modelMatrix
                        * _bendLocal;

                    // -----------------------------------------------------
                    // Distance from player along the runner's forward axis.
                    //
                    // X IS NEVER USED HERE.
                    //
                    // Therefore every vertex at the same Z bends together.
                    // -----------------------------------------------------

                    float _depth =
                        _bendWorld.z
                        - uBendOrigin.z;

                    // -----------------------------------------------------
                    // Distance envelope.
                    //
                    // Near player:
                    //
                    //     almost completely straight
                    //
                    // Far away:
                    //
                    //     full deformation
                    //
                    // Hard capped at 1.
                    // -----------------------------------------------------

                    float _envelope =
                        min(
                            _depth
                            * _depth
                            * uBendGrowth,
                            1.0
                        );

                    // -----------------------------------------------------
                    // Player progress.
                    //
                    // This does NOT determine the bend amount.
                    //
                    // It only changes the CHARACTER of the curves slowly
                    // over the course of the level.
                    // -----------------------------------------------------

                    float _progress =
                        uBendOrigin.z;

                    // -----------------------------------------------------
                    // Horizontal path.
                    // -----------------------------------------------------

                    float _curveX =
                        runnerCurveX(
                            _depth,
                            _progress
                        );

                    _bendWorld.x +=
                        _curveX
                        * _envelope
                        * uBendXAmplitude;

                    // -----------------------------------------------------
                    // Vertical path.
                    // -----------------------------------------------------

                    float _curveY =
                        runnerCurveY(
                            _depth,
                            _progress
                        );

                    _bendWorld.y +=
                        _curveY
                        * _envelope
                        * uBendYAmplitude;

                    // -----------------------------------------------------
                    // Projection.
                    // -----------------------------------------------------

                    vec4 mvPosition =
                        viewMatrix
                        * _bendWorld;

                    gl_Position =
                        projectionMatrix
                        * mvPosition;
                `,
            );
        };

        material.needsUpdate = true;
    }
}