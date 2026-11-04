// BeamLight.ts
//
// The pool of light the tractor beam throws: straight down, so it falls across whatever's under the saucer, roofs and
// cars included, rather than lying on the ground. Every bent material draws it (Bend.ts), and so does the sea (Water.ts);
// TractorBeam.ts moves it. A soft disc as wide as what the saucer can eat, a faint brighter edge there, and the beam's
// spiral carrying on across it.

import * as THREE from 'three';

export const beamLight = {
    /** Where it is (x, z), how wide, and how high up it reaches. */
    uBeamPool: { value: new THREE.Vector4(0, 0, 1, 1) },
    uBeamColor: { value: new THREE.Color() },
    uBeamStrength: { value: 0 },
    /** The beam's spiral (0..1), so the two turn together. */
    uBeamPhase: { value: 0 },
};

/**
 * `beamLightAt(world)`: how much of the light falls on that point (unbent world position), 0..1. `at` is 1 at the pool's
 * edge. Round the disc there are two arms, as on the cone, meeting its bottom edge where the cone's do.
 */
export const beamLightGlsl = `
uniform vec4 uBeamPool;
uniform vec3 uBeamColor;
uniform float uBeamStrength;
uniform float uBeamPhase;
float beamLightAt(vec3 world) {
    vec2 away = world.xz - uBeamPool.xy + 1e-4;
    float at = length(away) / uBeamPool.z;
    if (at > 1.3) return 0.0;
    float pool = 1.0 - smoothstep(0.6, 1.25, at);
    float rim = (at - 0.96) / 0.14;
    rim = exp(-rim * rim);
    float arm = 0.5 + 0.5 * cos(2.0 * atan(away.x, away.y) + 6.2832 * (0.8 * (1.0 - at) - uBeamPhase) - 3.1416);
    float spiral = arm * smoothstep(0.05, 0.5, at);
    float below = 1.0 - smoothstep(0.85, 1.0, world.y / uBeamPool.w);
    return min(0.85, (pool * (0.34 + 0.2 * spiral) + rim * 0.16) * below * uBeamStrength);
}
`;
