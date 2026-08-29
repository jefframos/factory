import * as THREE from 'three';

/** Tunable knobs for BendService.applyOcclusionFade() — see that method's own doc. */
export interface OcclusionFadeConfig {
    /** World-unit radius around the camera->player line that's fully cut out. Default 1.2. */
    radius?: number;
    /** Extra distance beyond `radius` over which opacity eases back up to maxOpacity. Default 1.5. */
    fadeWidth?: number;
    /** Opacity for a fragment sitting right on the camera->player line. Default 0.15. */
    minOpacity?: number;
    /** Opacity once past radius+fadeWidth, i.e. the material's normal look. Default 1.0. */
    maxOpacity?: number;
    /**
     * When true, cuts fragments out via a per-pixel dithered discard instead of alpha-blending
     * diffuseColor.a. Keeps the material fully OPAQUE (transparent stays false) — no blend
     * sorting against other transparent props, no depth-write-off artifacts, closer to the
     * "true cutout" the stencil alternative would have given, just cheaper. The tradeoff is a
     * visible stipple/noise texture in the faded region instead of a smooth fade — that's the
     * whole point of flipping this on to compare against the default smooth blend. Default false.
     */
    dither?: boolean;
}

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
        uBendOrigin: { value: new THREE.Vector3() },
        uBendStrength: { value: 0.002 },
        /** World-space camera position, read by applyOcclusionFade() — see updateCameraPosition(). */
        uOccCameraPos: { value: new THREE.Vector3() },
        /**
         * The "player" end of the occlusion segment — deliberately its OWN uniform rather than
         * reusing uBendOrigin (the player's base/feet, which is what the ground-bend math
         * needs). Occlusion reads much better centered on the character's torso/head, since
         * that's the mass a tree trunk actually swallows — see updateOcclusionTarget().
         */
        uOccPlayerPos: { value: new THREE.Vector3() },
    };

    /** Remembers the last non-zero strength so setEnabled(true) restores whatever it was tuned to, rather than a hardcoded default. */
    private static lastStrength = this.uniforms.uBendStrength.value;

    public static updateOrigin(position: THREE.Vector3): void {
        this.uniforms.uBendOrigin.value.copy(position);
    }

    /** Feeds the camera's current world position to every material bent via applyOcclusionFade(). Call once per render frame (see PizzaScene.update()). */
    public static updateCameraPosition(position: THREE.Vector3): void {
        this.uniforms.uOccCameraPos.value.copy(position);
    }

    /**
     * Sets the "player" end of the occlusion segment. `position` should already be wherever
     * you want the cutout centered on (e.g. playerPosition + a vertical offset for torso/head
     * height) — this method doesn't add anything itself, so the caller controls the offset.
     */
    public static updateOcclusionTarget(position: THREE.Vector3): void {
        this.uniforms.uOccPlayerPos.value.copy(position);
    }

    /**
     * Global on/off switch for every material that's had applyBend() called
     * on it — since they all read the SAME uBendStrength uniform, zeroing it
     * here turns the bend off everywhere at once without touching any
     * individual material or mesh. Everything stays hooked up; this is the
     * one place to flip.
     */
    public static setEnabled(enabled: boolean): void {
        if (enabled) {
            this.uniforms.uBendStrength.value = this.lastStrength;
        } else {
            this.lastStrength = this.uniforms.uBendStrength.value || this.lastStrength;
            this.uniforms.uBendStrength.value = 0;
        }
    }

    /**
     * JS-side mirror of the vertex-shader math in applyBend — for positioning
     * screen-space UI (name tags, boost bars) that tracks a bent mesh, since
     * worldToScreen() projects raw world positions and has no idea the GPU
     * dropped the actual vertex's Y. Safe to call unconditionally: with
     * uBendStrength at 0 the subtracted term is 0, so this is a no-op and the
     * position passes through unchanged.
     */
    public static applyToPosition(pos: THREE.Vector3): THREE.Vector3 {
        const origin = this.uniforms.uBendOrigin.value;
        const strength = this.uniforms.uBendStrength.value;
        const dx = pos.x - origin.x;
        const dz = pos.z - origin.z;
        return new THREE.Vector3(pos.x, pos.y - (dx * dx + dz * dz) * strength, pos.z);
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
            shader.uniforms.uFadeTo = { value: fadeTo };
            shader.vertexShader = 'varying float vWorldY;\n' + shader.vertexShader;
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
            shader.uniforms.uDistFadeEnd = { value: fadeEnd };
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

    /**
     * Camera-occlusion cutout: fades diffuseColor.a for any fragment sitting close to the
     * camera→player line, so props between the camera and the character thin out instead of
     * fully hiding them. Cheaper than a stencil-mask pass — no extra render target or draw
     * call, just a per-fragment distance-to-segment test reusing the SAME uBendOrigin (player
     * position) uniform every bent material already reads, plus the shared uOccCameraPos
     * uniform updated once per frame from PizzaScene (see updateCameraPosition()).
     *
     * `config` is per-material on purpose (unlike uBendStrength/uBendOrigin, which are shared
     * globals) — a thin fence post and a big prop shed both want to occlude, but with very
     * different radius/opacity so the fence barely dims while the shed cuts out hard.
     */
    private static readonly occludedMaterials = new WeakSet<THREE.Material>();

    public static applyOcclusionFade(material: THREE.Material, config: OcclusionFadeConfig = {}): void {
        if (BendService.occludedMaterials.has(material)) {
            return;
        }
        BendService.occludedMaterials.add(material);

        const radius = config.radius ?? 1.2;
        const fadeWidth = Math.max(config.fadeWidth ?? 1.5, 0.001); // 0 would divide-by-zero in smoothstep
        const minOpacity = config.minOpacity ?? 0.15;
        const maxOpacity = config.maxOpacity ?? 1.0;
        const dither = config.dither ?? false;

        // Dithered discard needs no blending at all — leave the material opaque. The smooth
        // path still needs alpha blending, same as every other *Fade method in this file.
        material.transparent = !dither;
        const prev = material.onBeforeCompile;
        material.onBeforeCompile = (shader, renderer) => {
            prev(shader, renderer);
            shader.uniforms.uOccCameraPos = BendService.uniforms.uOccCameraPos;
            shader.uniforms.uOccPlayerPos = BendService.uniforms.uOccPlayerPos;
            shader.uniforms.uOccRadius = { value: radius };
            shader.uniforms.uOccFadeWidth = { value: fadeWidth };
            shader.uniforms.uOccMinOpacity = { value: minOpacity };
            shader.uniforms.uOccMaxOpacity = { value: maxOpacity };

            shader.vertexShader = 'varying vec3 vOccWorldPos;\n' + shader.vertexShader;
            // Ordered 4x4 Bayer matrix, evaluated with an if-chain instead of a dynamically-
            // indexed array (GLSL ES 1.00 / WebGL1 doesn't allow indexing an array with a
            // non-constant expression) — same 16 evenly-spaced threshold levels every classic
            // ordered-dither implementation uses, giving a regular stipple grid instead of the
            // clumpy look a pure hash/noise threshold produces.
            const bayerFn = dither ? `
                float _occBayer4x4(vec2 fragCoord) {
                    int ix = int(mod(fragCoord.x, 4.0));
                    int iy = int(mod(fragCoord.y, 4.0));
                    int index = ix + iy * 4;
                    if (index == 0)  return 0.0  / 16.0;
                    if (index == 1)  return 8.0  / 16.0;
                    if (index == 2)  return 2.0  / 16.0;
                    if (index == 3)  return 10.0 / 16.0;
                    if (index == 4)  return 12.0 / 16.0;
                    if (index == 5)  return 4.0  / 16.0;
                    if (index == 6)  return 14.0 / 16.0;
                    if (index == 7)  return 6.0  / 16.0;
                    if (index == 8)  return 3.0  / 16.0;
                    if (index == 9)  return 11.0 / 16.0;
                    if (index == 10) return 1.0  / 16.0;
                    if (index == 11) return 9.0  / 16.0;
                    if (index == 12) return 15.0 / 16.0;
                    if (index == 13) return 7.0  / 16.0;
                    if (index == 14) return 13.0 / 16.0;
                    return 5.0 / 16.0;
                }
            ` : '';
            shader.fragmentShader = [
                'uniform vec3  uOccCameraPos;',
                'uniform vec3  uOccPlayerPos;',
                'uniform float uOccRadius;',
                'uniform float uOccFadeWidth;',
                'uniform float uOccMinOpacity;',
                'uniform float uOccMaxOpacity;',
                'varying vec3  vOccWorldPos;',
                bayerFn,
            ].join('\n') + '\n' + shader.fragmentShader;
            shader.vertexShader = shader.vertexShader.replace(
                '#include <begin_vertex>',
                '#include <begin_vertex>\nvOccWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;',
            );
            // Distance from this fragment to the closest point on the camera->player segment
            // (clamped projection `h`, standard point-to-segment formula) — fragments near
            // that line are "in the way" regardless of how far along the line they sit.
            //
            // _occAlpha is shared by both branches below: it's exactly what the smooth path
            // multiplies into diffuseColor.a, and exactly what the dithered path compares a
            // per-pixel noise threshold against — same falloff curve, two different ways of
            // expressing it on screen.
            const occlusionTail = dither
                ? `float _occDitherThreshold = _occBayer4x4(gl_FragCoord.xy);
                if (_occDitherThreshold > _occAlpha) discard;`
                : 'diffuseColor.a *= _occAlpha;';
            shader.fragmentShader = shader.fragmentShader.replace(
                '#include <alphamap_fragment>',
                `#include <alphamap_fragment>
                vec3 _occPa = vOccWorldPos - uOccCameraPos;
                vec3 _occBa = uOccPlayerPos - uOccCameraPos;
                float _occH = clamp(dot(_occPa, _occBa) / max(dot(_occBa, _occBa), 0.0001), 0.0, 1.0);
                float _occDist = length(_occPa - _occBa * _occH);
                float _occAlpha = mix(uOccMinOpacity, uOccMaxOpacity, smoothstep(uOccRadius, uOccRadius + uOccFadeWidth, _occDist));
                ${occlusionTail}`,
            );
        };
        material.needsUpdate = true;
    }

    /**
     * Materials bent more than once (e.g. GlbVisualComponent traversing every mesh in a
     * loaded prop and calling applyBend() per mesh, when a glTF export commonly reuses ONE
     * material across several mesh primitives) would otherwise chain onBeforeCompile twice —
     * each call prepends `uniform vec3 uBendOrigin; uniform float uBendStrength;`
     * unconditionally, so a second call on the same material duplicates that declaration and
     * the vertex shader fails to compile. This guards applyBend() itself so any caller can
     * call it as many times as convenient on the same material with no ill effect.
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

            // Replace the standard project_vertex with a world-space version.
            // Working in world space (after modelMatrix) means the bend is always
            // in world-Y regardless of the object's local rotation or scale.
            // mvPosition is preserved so fog still works correctly.
            //
            // The stock project_vertex chunk multiplies by instanceMatrix (under
            // USE_INSTANCING) BEFORE modelMatrix — skipping that here would collapse
            // every instance of an InstancedMesh onto the object's own transform, since
            // `transformed` alone carries no per-instance offset. Re-applying it keeps
            // InstancedMesh (e.g. TileMap.ts) working under the bend.
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
