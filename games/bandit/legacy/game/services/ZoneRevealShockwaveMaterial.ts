import * as THREE from 'three';
import { BendService } from './BendService';

/**
 * Standalone ShaderMaterial for the zone-reveal shockwave ring (see ZoneRevealEffect.ts, the
 * one caller) — same "hand-write the vertex shader, bake BendService's bend math in directly"
 * approach FogOfWarMaterial.ts uses, for the exact same reason: this mesh has no other visual
 * job, so BendService.applyBend()'s own onBeforeCompile chunk-replace (which targets
 * `#include <project_vertex>`, a chunk this shader's hand-written main() never includes) has
 * nothing to patch. Baking it in directly keeps the ring sitting flush with the curved ground
 * it's sweeping across instead of floating above/below it at any real distance from the bend
 * origin.
 *
 * The mesh itself is one large flat circle (see ZoneRevealEffect.ts) built ONCE at
 * ZONE_REVEAL_CONFIG.shockwaveMaxRadius — this shader animates uRadius (0 -> that max) to
 * expand the visible ring rather than rebuilding geometry every frame, and discards every
 * fragment outside a thin band around uRadius so the rest of that big circle stays invisible.
 */
export function createZoneRevealShockwaveMaterial(): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        uniforms: {
            uBendOrigin: BendService.uniforms.uBendOrigin,
            uBendStrength: BendService.uniforms.uBendStrength,
            uRadius: { value: 0 },
            uBandWidth: { value: 3 },
            uColor: { value: new THREE.Color('#bfe9ff') },
        },
        vertexShader: `
            uniform vec3 uBendOrigin;
            uniform float uBendStrength;
            varying vec2 vLocalXZ;

            void main() {
                vec4 worldPos = modelMatrix * vec4(position, 1.0);

                // Same radial world-bend math as BendService.applyBend() — see this file's
                // own doc for why it's baked in directly rather than patched in.
                float dx = worldPos.x - uBendOrigin.x;
                float dz = worldPos.z - uBendOrigin.z;
                worldPos.y -= (dx * dx + dz * dz) * uBendStrength;

                // Local-to-the-ring-center XZ, BEFORE the mesh's own world translation —
                // position is already centered on the ring's own origin (see
                // ZoneRevealEffect.ts's geometry), so this is exactly the distance-from-center
                // the fragment shader needs, with no extra uOrigin uniform required.
                vLocalXZ = position.xz;
                gl_Position = projectionMatrix * viewMatrix * worldPos;
            }
        `,
        fragmentShader: `
            uniform float uRadius;
            uniform float uBandWidth;
            uniform vec3 uColor;
            varying vec2 vLocalXZ;

            void main() {
                float dist = length(vLocalXZ);
                float intensity = smoothstep(uBandWidth, 0.0, abs(dist - uRadius));
                if (intensity <= 0.01) {
                    discard;
                }
                gl_FragColor = vec4(uColor, intensity);
            }
        `,
    });
}
