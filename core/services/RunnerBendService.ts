// RunnerBendService.ts
//
// Dynamic curved-world deformation for runner minigames.
//
// A vertex's own X position never affects how much it bends — every vertex
// at the same Z receives the same displacement, keeping the full track
// cross-section together.
//
// X and Y use two DIFFERENT notions of "how far along":
//
// - X (horizontal turns) is keyed to the vertex's own ABSOLUTE world Z — a
//   fixed, authored S-curve laid out along the level, the same shape every
//   time the player reaches a given spot (see runnerCurveX's own doc on
//   why: a player-relative version could never make different STRETCHES of
//   the level lean different ways).
// - Y (hills) is keyed to relative depth (vertexWorldZ - playerWorldZ) —
//   it's not an authored shape, it's a "how far is this from the player
//   RIGHT NOW" sink effect (see runnerCurveY's own doc), so it always
//   applies to whatever's currently far away, regardless of level position.
//
// Both are only ever REVEALED near the top of the frame / far from the
// player, via the shared player-relative envelope below — nearby geometry
// (where the player currently is) always stays flat regardless of either
// curve's own value.

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
            value: 12,
        },

        /**
         * Main horizontal frequency.
         *
         * Lower = longer, smoother, less perceptible turns. Tuned so a
         * full left-right-left swing spans roughly a level's own length
         * (see runnerCurveX's own doc on why this is keyed to absolute
         * world position, not distance from the player) rather than
         * either flickering by too fast or never visibly turning at all.
         */
        uBendXFrequency: {
            value: 0.015,
        },

        /**
         * Strength of the second (higher-frequency detail) horizontal wave
         * — kept small so it only adds subtle texture, not visible wobble.
         */
        uBendXSecondaryStrength: {
            value: 0.12,
        },

        /**
         * Strength of the third (highest-frequency detail) horizontal wave
         * — kept even smaller than the secondary strength for the same
         * reason.
         */
        uBendXTertiaryStrength: {
            value: 0.06,
        },

        // -----------------------------------------------------------------
        // Vertical hills
        // -----------------------------------------------------------------

        /**
         * Maximum vertical displacement.
         */
        uBendYAmplitude: {
            value: 30,
        },

        /**
         * Main hill frequency.
         */
        uBendYFrequency: {
            value: 0.012,
        },

        /**
         * Fraction of each vertical "step" cycle spent actually descending —
         * the rest of the cycle stays flat at the new, lower height. See
         * runnerCurveY()'s own doc: this is what produces the
         * bend-down / flatten / bend-down-again rhythm rather than a smooth
         * up-and-down wave.
         */
        uBendYDescendFraction: {
            value: 0.85,
        },

        // -----------------------------------------------------------------
        // Distance envelope
        // -----------------------------------------------------------------

        /**
         * World units of depth that stay completely flat before the
         * envelope starts growing at all — pushes the point where the bend
         * becomes visible further from the player (which, from this
         * camera's perspective, reads as further UP the screen, closer to
         * the horizon, rather than happening close by/low in the frame).
         */
        uBendStartDistance: {
            value: 10,
        },

        /**
         * Controls how quickly the deformation becomes visible ONCE past
         * uBendStartDistance.
         *
         * 1 / (60 * 60) means the envelope reaches its maximum
         * roughly 60 world units past that start distance.
         */
        uBendGrowth: {
            value: 1 / (60 * 60),
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

            shader.uniforms.uBendYDescendFraction =
                RunnerBendService.uniforms.uBendYDescendFraction;

            shader.uniforms.uBendStartDistance =
                RunnerBendService.uniforms.uBendStartDistance;

            shader.uniforms.uBendGrowth =
                RunnerBendService.uniforms.uBendGrowth;

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
                uniform float uBendYDescendFraction;

                uniform float uBendStartDistance;
                uniform float uBendGrowth;

                // ---------------------------------------------------------
                // Horizontal curve
                //
                // Takes the vertex's ABSOLUTE world Z, not its distance
                // from the player — this is a fixed, authored S-curve laid
                // out along the level, always the same shape at the same
                // spot every time the player reaches it. Whether any of it
                // is actually VISIBLE (and how strongly) is entirely up to
                // the caller's own player-relative envelope multiplier —
                // see this file's own doc.
                //
                // An earlier version based this on relative depth instead
                // (the player's own distance from the point), reasoning
                // that would guarantee regular alternation — but a single
                // obstacle's own approach only ever sweeps through a short,
                // near-zero slice of that depth range, so in practice nearly
                // every obstacle read as leaning the exact same way. Tying
                // the curve to fixed world position instead means
                // DIFFERENT STRETCHES of the level genuinely lean
                // differently — left for a while, then right, then back —
                // which is what actually reads as changing sides.
                // ---------------------------------------------------------

                float runnerCurveX(float worldZ) {
                    float primary =
                        sin(worldZ * uBendXFrequency);

                    float secondary =
                        sin(
                            worldZ
                            * uBendXFrequency
                            * 1.6
                            + 1.1
                        )
                        * uBendXSecondaryStrength;

                    float tertiary =
                        sin(
                            worldZ
                            * uBendXFrequency
                            * 2.3
                            + 2.6
                        )
                        * uBendXTertiaryStrength;

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
                // NOT a wave — a descending staircase. Every 1/uBendYFrequency
                // world units of depth is one "step": the first
                // uBendYDescendFraction portion of it eases the ground down
                // by one more amplitude unit, then the rest of the step
                // holds perfectly flat before the next step begins. So the
                // path never comes back up — it repeats
                // bend-down -> flatten -> bend-down -> flatten the further
                // out it goes, which is also what lets distant obstacles/
                // floor sink out of the camera's view without needing to
                // stop rendering them.
                // ---------------------------------------------------------

                float runnerCurveY(float depth) {
                    float period =
                        1.0 / max(uBendYFrequency, 0.0001);

                    float descendLength =
                        period
                        * clamp(uBendYDescendFraction, 0.01, 1.0);

                    float dist = abs(depth);

                    float stepIndex = floor(dist / period);
                    float cyclePos = mod(dist, period);

                    float t =
                        clamp(cyclePos / descendLength, 0.0, 1.0);
                    float eased = t * t * (3.0 - 2.0 * t);

                    // Always <= 0 — the track only ever steps DOWN.
                    return -(stepIndex + eased);
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
                    // Near player (up to uBendStartDistance):
                    //
                    //     completely straight, no bend at all
                    //
                    // Far away:
                    //
                    //     full deformation
                    //
                    // Hard capped at 1. The uBendStartDistance deadzone is
                    // what pushes the visible bend further from the player
                    // — i.e. further up the screen, toward the horizon.
                    // -----------------------------------------------------

                    float _bendDist =
                        max(
                            abs(_depth)
                            - uBendStartDistance,
                            0.0
                        );

                    float _envelope =
                        min(
                            _bendDist
                            * _bendDist
                            * uBendGrowth,
                            1.0
                        );

                    // -----------------------------------------------------
                    // Horizontal path — fixed authored shape, keyed to
                    // this vertex's own absolute world Z (see
                    // runnerCurveX's own doc), only ever revealed by the
                    // player-relative envelope above.
                    // -----------------------------------------------------

                    float _curveX =
                        runnerCurveX(_bendWorld.z);

                    _bendWorld.x +=
                        _curveX
                        * _envelope
                        * uBendXAmplitude;

                    // -----------------------------------------------------
                    // Vertical path.
                    // -----------------------------------------------------

                    float _curveY =
                        runnerCurveY(_depth);

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
