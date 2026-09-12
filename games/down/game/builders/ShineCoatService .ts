/**
 * ShineCoatService.ts
 *
 * REAL FIXES (do not revert):
 *
 * Fix 1 – File-scope uniform prepend:
 *   Uniforms are prepended to the very top of fragmentShader BEFORE any
 *   #include token. Three.js resolves #includes *after* onBeforeCompile
 *   returns, so a top-of-file declaration is guaranteed to be present in
 *   the final source even when BendService (or any other patch) also wraps
 *   onBeforeCompile. Inserting inside an `#include <common>` replacement
 *   was fragile because the chained handler could re-replace that block.
 *
 * Fix 2 – customProgramCacheKey bump:
 *   Three.js caches compiled WebGL programs by cache key. Without bumping
 *   the key, a program compiled before applyCoat() was called can be
 *   returned from cache even though onBeforeCompile fires and patches the
 *   source — the driver never sees the patched source. Suffixing
 *   "|shineCoat=1" forces a unique program entry.
 */

import * as THREE from 'three';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CoatSpec {
    intensity?: number;   // 0..1,  default 0.85
    rimColor?: number;    // hex,    default 0xffffff
    sheen?: number;       // 0..1,  default 0.5
    ior?: number;         //        default 1.7
    roughness?: number;   // 0..1,  default 0.18
    fresnelExponent?: number; //    default 3.0
}

interface CoatUniforms {
    uSC_Intensity: THREE.IUniform<number>;
    uSC_Rim: THREE.IUniform<THREE.Color>;
    uSC_Sheen: THREE.IUniform<number>;
    uSC_Ior: THREE.IUniform<number>;
    uSC_Roughness: THREE.IUniform<number>;
    uSC_FresnelExp: THREE.IUniform<number>;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const SENTINEL = 'uniform float uSC_Intensity;';
const CACHE_SUFFIX = '|shineCoat=1';

const UNIFORM_BLOCK = /* glsl */`
uniform float uSC_Intensity;
uniform vec3  uSC_Rim;
uniform float uSC_Sheen;
uniform float uSC_Ior;
uniform float uSC_Roughness;
uniform float uSC_FresnelExp;
`;

// ─── Service ─────────────────────────────────────────────────────────────────

export class ShineCoatService {

    // Captures the onBeforeCompile hook that existed BEFORE we patched it.
    private static readonly _prev = new WeakMap<
        THREE.Material,
        ((shader: THREE.WebGLProgramParametersWithUniforms, renderer: THREE.WebGLRenderer) => void) | null
    >();

    // Live uniform objects shared between the WeakMap and shader.uniforms refs.
    private static readonly _uniforms = new WeakMap<THREE.Material, CoatUniforms>();

    // ── Public API ─────────────────────────────────────────────────────────────

    /**
     * Apply a clearcoat-style shine to a MeshStandardMaterial (or subclass).
     * Returns true when the coat is active, false when the material type is
     * incompatible (e.g. MeshBasicMaterial).
     */
    static applyCoat(
        material: THREE.Material,
        spec: CoatSpec = {},
    ): boolean {
        if (!ShineCoatService._isSupported(material)) {
            console.warn(
                '[ShineCoatService] Skipping unsupported material type:',
                material.type,
                '— vNormal/vViewPosition are absent in this shader.',
            );
            return false;
        }

        // ── Idempotent: coat already present → just update uniforms ──────────────
        if (ShineCoatService._uniforms.has(material)) {
            ShineCoatService._applySpecToUniforms(
                ShineCoatService._uniforms.get(material)!,
                spec,
            );
            return true;
        }

        // ── Build live uniform objects ────────────────────────────────────────────
        const u: CoatUniforms = {
            uSC_Intensity: { value: ShineCoatService._clamp01(spec.intensity ?? 0.85) },
            uSC_Rim: { value: new THREE.Color(spec.rimColor ?? 0xffffff) },
            uSC_Sheen: { value: ShineCoatService._clamp01(spec.sheen ?? 0.5) },
            uSC_Ior: { value: spec.ior ?? 1.7 },
            uSC_Roughness: { value: ShineCoatService._clamp01(spec.roughness ?? 0.18) },
            uSC_FresnelExp: { value: spec.fresnelExponent ?? 3.0 },
        };
        ShineCoatService._uniforms.set(material, u);

        // ── Capture any pre-existing onBeforeCompile (e.g. BendService) ──────────
        const prevHook = (material as THREE.MeshStandardMaterial).onBeforeCompile ?? null;
        ShineCoatService._prev.set(material, prevHook);

        // ── Patch onBeforeCompile ─────────────────────────────────────────────────
        (material as THREE.MeshStandardMaterial).onBeforeCompile = (
            shader: THREE.WebGLProgramParametersWithUniforms,
            renderer: THREE.WebGLRenderer,
        ) => {
            // Chain safety: call previous hook first (BendService etc.)
            prevHook?.(shader, renderer);

            // Fix 1: prepend at file scope if not already present
            if (!shader.fragmentShader.includes(SENTINEL)) {
                shader.fragmentShader = UNIFORM_BLOCK + '\n' + shader.fragmentShader;
            }

            // Patch roughness: soften roughness by coat amount
            shader.fragmentShader = shader.fragmentShader.replace(
                /\/\*\s*#include\s+<roughnessmap_fragment>\s*\*\/|#include\s+<roughnessmap_fragment>/,
        /* glsl */`
#include <roughnessmap_fragment>
roughnessFactor *= mix(1.0, 1.0 - uSC_Roughness, uSC_Intensity);
`,
            );

            // Patch dithering_fragment: inject Fresnel + specular rim just before
            // dithering so it applies after tone-mapping but inside gl_FragColor
            shader.fragmentShader = shader.fragmentShader.replace(
                /\/\*\s*#include\s+<dithering_fragment>\s*\*\/|#include\s+<dithering_fragment>/,
        /* glsl */`
{
  vec3  _scN    = normalize(vNormal);
  vec3  _scV    = normalize(vViewPosition);
  float _scNdV  = max(dot(_scN, _scV), 0.0);
  float _scFres = pow(1.0 - _scNdV, uSC_FresnelExp);
  float _scSpec = pow(_scNdV, 1.0 / max(uSC_Ior, 1e-3));
  gl_FragColor.rgb += uSC_Rim
    * (_scFres * 0.55 + _scSpec * 0.45)
    * uSC_Intensity;
}
#include <dithering_fragment>
`,
            );

            // Fix 10: wire uniform references explicitly (not Object.assign)
            shader.uniforms.uSC_Intensity = u.uSC_Intensity;
            shader.uniforms.uSC_Rim = u.uSC_Rim;
            shader.uniforms.uSC_Sheen = u.uSC_Sheen;
            shader.uniforms.uSC_Ior = u.uSC_Ior;
            shader.uniforms.uSC_Roughness = u.uSC_Roughness;
            shader.uniforms.uSC_FresnelExp = u.uSC_FresnelExp;
        };

        // Fix 2: bump cache key so Three.js does not serve a pre-coat program
        const originalCacheKey = material.customProgramCacheKey.bind(material);
        material.customProgramCacheKey = () =>
            originalCacheKey() + CACHE_SUFFIX;

        material.needsUpdate = true;
        return true;
    }

    /**
     * Remove the coat from a material and restore any prior onBeforeCompile.
     * Returns true if coat was removed, false if material had no coat.
     */
    static removeCoat(material: THREE.Material): boolean {
        if (!ShineCoatService._uniforms.has(material)) return false;

        const prev = ShineCoatService._prev.get(material) ?? undefined;
        (material as THREE.MeshStandardMaterial).onBeforeCompile =
            prev as typeof material.onBeforeCompile;

        // Restore cache key: strip ONLY our suffix
        const restoredBase = material.customProgramCacheKey.bind(material);
        material.customProgramCacheKey = () =>
            restoredBase().replace(CACHE_SUFFIX, '');

        ShineCoatService._uniforms.delete(material);
        ShineCoatService._prev.delete(material);

        material.needsUpdate = true;
        return true;
    }

    /** True when this material currently has a coat. */
    static hasCoat(material: THREE.Material): boolean {
        return ShineCoatService._uniforms.has(material);
    }

    /**
     * Update intensity at runtime without recompile.
     * Returns false if the material has no coat.
     */
    static setIntensity(material: THREE.Material, intensity: number): boolean {
        const u = ShineCoatService._uniforms.get(material);
        if (!u) return false;
        u.uSC_Intensity.value = ShineCoatService._clamp01(intensity);
        return true;
    }

    /**
     * Returns the current coat intensity, or null if material has no coat.
     */
    static getCoatStrength(material: THREE.Material): number | null {
        return ShineCoatService._uniforms.get(material)?.uSC_Intensity.value ?? null;
    }

    // ── Private helpers ────────────────────────────────────────────────────────

    private static _isSupported(m: THREE.Material): boolean {
        // MeshBasicMaterial lacks vNormal / vViewPosition in its shader
        return !(m instanceof THREE.MeshBasicMaterial);
    }

    private static _clamp01(v: number): number {
        return Math.min(1, Math.max(0, v));
    }

    private static _applySpecToUniforms(u: CoatUniforms, spec: CoatSpec): void {
        if (spec.intensity !== undefined) u.uSC_Intensity.value = ShineCoatService._clamp01(spec.intensity);
        if (spec.rimColor !== undefined) u.uSC_Rim.value.setHex(spec.rimColor);
        if (spec.sheen !== undefined) u.uSC_Sheen.value = ShineCoatService._clamp01(spec.sheen);
        if (spec.ior !== undefined) u.uSC_Ior.value = spec.ior;
        if (spec.roughness !== undefined) u.uSC_Roughness.value = ShineCoatService._clamp01(spec.roughness);
        if (spec.fresnelExponent !== undefined) u.uSC_FresnelExp.value = spec.fresnelExponent;
    }
}
