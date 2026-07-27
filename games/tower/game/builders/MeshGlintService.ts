/**
 * MeshGlintService.ts
 *
 * ARCHITECTURE NOTE — Why the varying pattern is required:
 * ─────────────────────────────────────────────────────────
 * (a) `modelMatrix` and `position` are GLSL uniforms/attributes that only
 *     exist in the VERTEX shader stage.  Referencing them inside a fragment
 *     patch (e.g. replacing <dithering_fragment>) causes "undeclared
 *     identifier" compile errors on all WebGL implementations.
 *
 * (b) The fix is the classic "varying" pattern: compute the desired value in
 *     the vertex shader, write it to a `varying`, and read it in the fragment
 *     shader where it arrives interpolated across the triangle.
 *
 * (c) This means BOTH shaders now receive a patch:
 *       • Vertex  → declare `varying vec2 vGltWp`, compute & assign it at
 *                   <begin_vertex> using `transformed` (the Three.js mutable
 *                   local that accumulates morphing / skinning later in the
 *                   shader).
 *       • Fragment → declare the same `varying vec2 vGltWp`, then simply read
 *                   it inside the <dithering_fragment> replacement.
 *
 * (d) The `varying` declaration is prepended at FILE SCOPE on both shaders
 *     (not just the fragment) so that GLSL linkage can match the `out` →
 *     `in` pair across shader stages.
 *
 * (e) `transformed` is chosen over raw `position` so that future BendService
 *     (or morph/skin) hooks that also run after <begin_vertex> share the same
 *     local.  This keeps the world-space sampling point compositionally
 *     consistent with any geometry deformation.
 *
 * SKILL ENTRY: modelMatrix/position are restricted to the vertex stage —
 * use varyings written from <begin_vertex> whenever the fragment shader needs
 * world-space coordinates.
 */

import * as THREE from 'three';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GlintSpec {
    /**
     * Animation speed for the noise.
     */
    speed?: number;

    /**
     * World-space noise scale.
     * Higher values create smaller noise details.
     */
    noiseScale?: number;

    /**
     * How strongly noise changes the Fresnel.
     */
    noiseStrength?: number;

    /**
     * Overall added-light intensity.
     */
    intensity?: number;

    /**
     * Fresnel exponent.
     * Higher values make the effect thinner around the silhouette.
     */
    fresnelPower?: number;

    /**
     * Minimum Fresnel contribution.
     */
    fresnelBias?: number;

    /**
     * Optional effect tint.
     */
    tint?: THREE.Color;

    /**
     * How much the glint uses the supplied tint.
     *
     * 0 = derive entirely from the material
     * 1 = use the supplied tint entirely
     */
    tintMix?: number;

    /**
     * How much of the original material colour is retained in the glint.
     */
    materialColorMix?: number;

    /**
     * Controls small brightness variation over time.
     */
    shimmerStrength?: number;
}

const DEFAULT_GLINT_SPEC: Required<GlintSpec> = {
    speed: 0.12,

    noiseScale: 0.75,
    noiseStrength: 0.28,

    intensity: 0.16,

    fresnelPower: 3.2,
    fresnelBias: 0.02,

    // Slightly warm white instead of pure, harsh white.
    tint: new THREE.Color(0xfff4e8),

    tintMix: 0.18,
    materialColorMix: 0.8,

    shimmerStrength: 0.08,
};

interface GlintUniforms {
    uGlt_time: { value: number };
    uGlt_speed: { value: number };

    uGlt_noiseScale: { value: number };
    uGlt_noiseStrength: { value: number };

    uGlt_intensity: { value: number };

    uGlt_fresnelPower: { value: number };
    uGlt_fresnelBias: { value: number };

    uGlt_tint: { value: THREE.Color };
    uGlt_tintMix: { value: number };
    uGlt_materialColorMix: { value: number };

    uGlt_shimmerStrength: { value: number };
}



type PatchedMaterial = THREE.MeshStandardMaterial & {
    onBeforeCompile: (shader: THREE.WebGLProgramParametersWithUniforms, renderer: THREE.WebGLRenderer) => void;
    customProgramCacheKey: () => string;
};

// ─── GLSL fragments ───────────────────────────────────────────────────────────

const VARYING_DECL = 'varying vec3 vGltWorldPosition;';

const VERTEX_WP_ASSIGN = `
vGltWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;
`.trim();

// File-scope helpers + uniforms prepended to fragmentShader
const FRAGMENT_PREAMBLE = `
${VARYING_DECL}

uniform float uGlt_time;
uniform float uGlt_speed;

uniform float uGlt_noiseScale;
uniform float uGlt_noiseStrength;

uniform float uGlt_intensity;

uniform float uGlt_fresnelPower;
uniform float uGlt_fresnelBias;

uniform vec3 uGlt_tint;
uniform float uGlt_tintMix;
uniform float uGlt_materialColorMix;

uniform float uGlt_shimmerStrength;

// Value noise hash
float _gltHash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;

    return fract(
        p.x * p.y * p.z *
        (p.x + p.y + p.z)
    );
}

// Smooth 3D value noise
float _gltNoise(vec3 p) {
    vec3 cell = floor(p);
    vec3 local = fract(p);

    local = local * local * (3.0 - 2.0 * local);

    float n000 = _gltHash(cell + vec3(0.0, 0.0, 0.0));
    float n100 = _gltHash(cell + vec3(1.0, 0.0, 0.0));
    float n010 = _gltHash(cell + vec3(0.0, 1.0, 0.0));
    float n110 = _gltHash(cell + vec3(1.0, 1.0, 0.0));

    float n001 = _gltHash(cell + vec3(0.0, 0.0, 1.0));
    float n101 = _gltHash(cell + vec3(1.0, 0.0, 1.0));
    float n011 = _gltHash(cell + vec3(0.0, 1.0, 1.0));
    float n111 = _gltHash(cell + vec3(1.0, 1.0, 1.0));

    float nx00 = mix(n000, n100, local.x);
    float nx10 = mix(n010, n110, local.x);
    float nx01 = mix(n001, n101, local.x);
    float nx11 = mix(n011, n111, local.x);

    float nxy0 = mix(nx00, nx10, local.y);
    float nxy1 = mix(nx01, nx11, local.y);

    return mix(nxy0, nxy1, local.z);
}

// Two broad noise layers.
// This is smoother than random sparkle noise.
float _gltFbm(vec3 p) {
    float result = 0.0;

    result += _gltNoise(p) * 0.65;
    result += _gltNoise(p * 2.03 + 8.17) * 0.35;

    return result;
}
`.trimStart();


// Sentinel: if this string is already present in the dithering patch zone,
// we know the fragment has been patched.
const FRAG_PATCH_SENTINEL = '_gltNDotV =';


const GLINT_SHADER_MARKER = '// MeshGlintService resin fresnel';

const GLINT_REPLACEMENT = `
// MeshGlintService resin fresnel
{
    vec3 _gltViewDirection = normalize(-vViewPosition);
    vec3 _gltNormal = normalize(normal);

    float _gltNDotV = clamp(
        dot(_gltNormal, _gltViewDirection),
        0.0,
        1.0
    );

    // Strongest near the silhouette.
    float _gltFresnel = pow(
        1.0 - _gltNDotV,
        max(uGlt_fresnelPower, 0.0001)
    );

    _gltFresnel = clamp(
        _gltFresnel + uGlt_fresnelBias,
        0.0,
        1.0
    );

    // Slowly move the noise through world space.
    vec3 _gltNoisePosition =
        vGltWorldPosition * uGlt_noiseScale;

    _gltNoisePosition += vec3(
        uGlt_time * uGlt_speed * 0.37,
        uGlt_time * uGlt_speed * 0.19,
       -uGlt_time * uGlt_speed * 0.28
    );

    float _gltNoiseValue = _gltFbm(_gltNoisePosition);

    // Center around zero, preventing noise from only increasing brightness.
    float _gltSignedNoise =
        (_gltNoiseValue * 2.0 - 1.0) *
        uGlt_noiseStrength;

    // Noise only gently breaks up the Fresnel.
    float _gltNoisyFresnel = clamp(
        _gltFresnel * (1.0 + _gltSignedNoise),
        0.0,
        1.0
    );

    // Very mild slow shimmer.
    float _gltShimmer =
        1.0 +
        sin(
            uGlt_time * uGlt_speed * 2.0 +
            _gltNoiseValue * 6.2831853
        ) * uGlt_shimmerStrength;

    // diffuseColor is the material/albedo colour in this shader stage.
    vec3 _gltMaterialTint = mix(
        vec3(1.0),
        diffuseColor.rgb,
        uGlt_materialColorMix
    );

    vec3 _gltFinalTint = mix(
        _gltMaterialTint,
        uGlt_tint,
        uGlt_tintMix
    );

    float _gltAmount =
        _gltNoisyFresnel *
        _gltShimmer *
        uGlt_intensity;

    outgoingLight += _gltFinalTint * _gltAmount;
}

#include <opaque_fragment>
`;


// ─── Service ──────────────────────────────────────────────────────────────────

export class MeshGlintService {
    // Class-level animation clock shared across all managed materials.
    private static _clock = new THREE.Clock(false);
    private static _tick = 0;
    private static _rafId: number | null = null;

    // Per-material bookkeeping (WeakMap/WeakSet for GC-safety).
    private static _uniforms = new WeakMap<THREE.MeshStandardMaterial, GlintUniforms>();
    private static _materials = new WeakSet<THREE.MeshStandardMaterial>();
    // Stores the pre-glint onBeforeCompile so we can chain it.
    private static _prev = new WeakMap<
        THREE.MeshStandardMaterial,
        ((s: THREE.WebGLProgramParametersWithUniforms, r: THREE.WebGLRenderer) => void) | undefined
    >();

    // ── Public API ─────────────────────────────────────────────────────────────

    static applyGlints(mat: THREE.MeshStandardMaterial, spec: GlintSpec = {}): boolean {
        const settings: Required<GlintSpec> = {
            ...DEFAULT_GLINT_SPEC,
            ...spec,

            // Clone colours so callers cannot accidentally mutate shared defaults.
            tint: spec.tint?.clone() ?? DEFAULT_GLINT_SPEC.tint.clone(),
        };

        const uniforms: GlintUniforms = {
            uGlt_time: {
                value: 0,
            },

            uGlt_speed: {
                value: settings.speed,
            },

            uGlt_noiseScale: {
                value: settings.noiseScale,
            },

            uGlt_noiseStrength: {
                value: settings.noiseStrength,
            },

            uGlt_intensity: {
                value: settings.intensity,
            },

            uGlt_fresnelPower: {
                value: settings.fresnelPower,
            },

            uGlt_fresnelBias: {
                value: settings.fresnelBias,
            },

            uGlt_tint: {
                value: settings.tint,
            },

            uGlt_tintMix: {
                value: settings.tintMix,
            },

            uGlt_materialColorMix: {
                value: settings.materialColorMix,
            },

            uGlt_shimmerStrength: {
                value: settings.shimmerStrength,
            },
        };

        this._uniforms.set(mat, uniforms);
        this._materials.add(mat);

        const prevHook = mat.onBeforeCompile as
            ((s: THREE.WebGLProgramParametersWithUniforms, r: THREE.WebGLRenderer) => void) | undefined;
        this._prev.set(mat, prevHook);

        (mat as PatchedMaterial).onBeforeCompile = (shader, renderer) => {
            // Chain previous hook (e.g. ShineCoatService) first.
            prevHook?.(shader, renderer);

            // Inject uniforms.
            Object.assign(shader.uniforms, uniforms);

            // ── Vertex shader: declare varying + assign world-xz ──────────────────
            if (!shader.vertexShader.includes(VARYING_DECL)) {
                shader.vertexShader = VARYING_DECL + '\n' + shader.vertexShader;
            }

            if (
                shader.vertexShader.includes('#include <begin_vertex>') &&
                !shader.vertexShader.includes(VERTEX_WP_ASSIGN)
            ) {
                shader.vertexShader = shader.vertexShader.replace(
                    '#include <begin_vertex>',
                    `#include <begin_vertex>\n${VERTEX_WP_ASSIGN}`
                );
            }

            // ── Fragment shader: declare varying + prepend uniforms/helpers ────────
            if (!shader.fragmentShader.includes(VARYING_DECL)) {
                shader.fragmentShader = FRAGMENT_PREAMBLE + shader.fragmentShader;
            }


            if (!shader.fragmentShader.includes(GLINT_SHADER_MARKER)) {
                shader.fragmentShader = shader.fragmentShader.replace(
                    '#include <opaque_fragment>',
                    GLINT_REPLACEMENT
                );
            }
        };


        const prevKey = mat.customProgramCacheKey.bind(mat);
        mat.customProgramCacheKey = () => prevKey() + '|glint=1';

        mat.needsUpdate = true;
        this._ensureClock();
        return true;
    }

    static removeGlints(mat: THREE.MeshStandardMaterial): boolean {
        if (!this._materials.has(mat)) return false;

        const prev = this._prev.get(mat);
        if (prev) {
            (mat as PatchedMaterial).onBeforeCompile = prev;
        } else {
            (mat as Partial<PatchedMaterial>).onBeforeCompile = () => { /* noop */ };
        }

        // Strip cache-key suffix.
        const prevKey = mat.customProgramCacheKey.bind(mat);
        mat.customProgramCacheKey = () => prevKey().replace('|glint=1', '');

        this._uniforms.delete(mat);
        this._materials.delete(mat);
        this._prev.delete(mat);

        mat.needsUpdate = true;
        this._stopClockIfEmpty();
        return true;
    }

    static hasGlints(mat: THREE.MeshStandardMaterial): boolean {
        return this._materials.has(mat);
    }

    // ── Per-uniform setters ────────────────────────────────────────────────────

    static setSpeed(mat: THREE.MeshStandardMaterial, v: number): boolean {
        const u = this._uniforms.get(mat);
        if (!u) return false;
        u.uGlt_speed.value = v;
        return true;
    }

    static setDensity(mat: THREE.MeshStandardMaterial, v: number): boolean {
        const u = this._uniforms.get(mat);
        if (!u) return false;
        u.uGlt_density.value = v;
        return true;
    }

    static setIntensity(mat: THREE.MeshStandardMaterial, v: number): boolean {
        const u = this._uniforms.get(mat);
        if (!u) return false;
        u.uGlt_intensity.value = v;
        return true;
    }

    static setTint(mat: THREE.MeshStandardMaterial, color: THREE.Color): boolean {
        const u = this._uniforms.get(mat);
        if (!u) return false;
        u.uGlt_tint.value.copy(color);
        return true;
    }

    static setTintCycleMix(mat: THREE.MeshStandardMaterial, v: number): boolean {
        const u = this._uniforms.get(mat);
        if (!u) return false;
        u.uGlt_tintCycleMix.value = v;
        return true;
    }

    // ── Clock management ───────────────────────────────────────────────────────

    private static _ensureClock(): void {
        if (this._rafId !== null) return;
        this._clock.start();

        const loop = () => {
            this._tick = this._clock.getElapsedTime();
            // Push time into every tracked material's uniform.
            // WeakMap doesn't enumerate, so we maintain a shadow Set for iteration.
            for (const u of this._activeUniforms) {
                u.uGlt_time.value = this._tick;
            }
            this._rafId = requestAnimationFrame(loop);
        };
        this._rafId = requestAnimationFrame(loop);
    }

    private static _stopClockIfEmpty(): void {
        if (this._activeUniforms.size === 0 && this._rafId !== null) {
            cancelAnimationFrame(this._rafId);
            this._rafId = null;
            this._clock.stop();
        }
    }

    // Shadow iterable set of live uniform blocks (mirrors _uniforms WeakMap).
    private static _activeUniforms = new Set<GlintUniforms>();

    // Override applyGlints / removeGlints to maintain _activeUniforms.
    static {
        const origApply = MeshGlintService.applyGlints.bind(MeshGlintService);
        const origRemove = MeshGlintService.removeGlints.bind(MeshGlintService);

        MeshGlintService.applyGlints = function (mat, spec = {}) {
            const result = origApply(mat, spec);
            if (result) {
                const u = MeshGlintService._uniforms.get(mat);
                if (u) MeshGlintService._activeUniforms.add(u);
            }
            return result;
        };

        MeshGlintService.removeGlints = function (mat) {
            const u = MeshGlintService._uniforms.get(mat);
            const result = origRemove(mat);
            if (result && u) MeshGlintService._activeUniforms.delete(u);
            return result;
        };
    }
}
