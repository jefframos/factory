// Rim.ts
//
// A soft light round the edges of what's in hand (the tool, the boxing gloves), facing away from the eyes: a fresnel in the colour
// of how far the tool's been made better (its grade: WallConfig.gradeColor). One setting for every material that has it.

import * as THREE from 'three';

const RIM = {
    strength: { value: 0 },
    color: { value: new THREE.Color() },
    /** How tight to the edge it is. */
    power: { value: 2.2 },
};

let strength = 0;

/** How strong, and its colour. */
export function setRim(next: number, color: THREE.ColorRepresentation): void {
    strength = next;
    RIM.color.value.set(color);
}

/** Bright for a moment, fading back (a grade just went up). */
export function flashRim(): void {
    flashAt = performance.now();
}

let flashAt = -Infinity;
/** The flash: how much brighter, and how long it fades (ms). */
const FLASH = { more: 2.2, ms: 900 };

/** It breathes, slowly (call each frame). */
export function updateRim(time: number): void {
    const flash = Math.max(0, 1 - (performance.now() - flashAt) / FLASH.ms);
    RIM.strength.value = strength * (0.75 + 0.25 * Math.sin(time * 2.4)) * (1 + FLASH.more * flash * flash);
}

/** Gives a standard material the rim (once). */
export function withRim(material: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
    if (material.userData.rim) return material;
    material.userData.rim = true;
    material.onBeforeCompile = (shader) => {
        shader.uniforms.uRimStrength = RIM.strength;
        shader.uniforms.uRimColor = RIM.color;
        shader.uniforms.uRimPower = RIM.power;
        shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', '#include <common>\nuniform float uRimStrength;\nuniform vec3 uRimColor;\nuniform float uRimPower;')
            .replace(
                '#include <emissivemap_fragment>',
                '#include <emissivemap_fragment>\nfloat rimEdge = 1.0 - abs(dot(normalize(normal), normalize(vViewPosition)));\ntotalEmissiveRadiance += uRimColor * uRimStrength * pow(rimEdge, uRimPower);',
            );
    };
    material.customProgramCacheKey = () => 'wall-rim';
    material.needsUpdate = true;
    return material;
}
