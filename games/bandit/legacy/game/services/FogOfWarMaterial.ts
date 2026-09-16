import * as THREE from 'three';
import { BendService } from './BendService';

/**
 * Standalone ShaderMaterial for the fog-of-war boxes — unlike BendService's OWN methods
 * (which patch an EXISTING material's compiled chunks via onBeforeCompile — see that file's
 * own doc), this mesh has no other visual job, so it's simpler as its own self-contained
 * vertex+fragment pair. That does mean BendService.applyBend() itself doesn't work here: it
 * string-replaces `#include <project_vertex>`, a chunk this shader's own hand-written main()
 * never includes. Instead this bakes the SAME world-bend formula straight into its vertex
 * shader, reading BendService's shared uBendOrigin/uBendStrength uniforms directly (passed in
 * by reference below) so toggling BendService.setEnabled() still turns this off too.
 *
 * One InstancedMesh (see FogOfWarManager.ts) uses this material — a THREE.BoxGeometry per
 * unrevealed ground cell, not a flat plane, so the fog actually reads as a solid volume
 * sitting over the map rather than a decal. transparent=false / depthWrite=true: this is
 * meant to fully occlude whatever is under it, not fade over it.
 */
export function createFogOfWarMaterial(): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
        transparent: false,
        depthWrite: true,
        uniforms: {
            uBendOrigin: BendService.uniforms.uBendOrigin,
            uBendStrength: BendService.uniforms.uBendStrength,
            uTime: { value: 0 },
            uCloudColorDark: { value: new THREE.Color('#aebfcd') },
            uCloudColorLight: { value: new THREE.Color('#f4f8fb') },
        },
        vertexShader: `
            uniform vec3 uBendOrigin;
            uniform float uBendStrength;
            varying vec2 vWorldXZ;
            varying vec3 vNormal;

            void main() {
                vec4 instancePos = instanceMatrix * vec4(position, 1.0);
                vec4 worldPos = modelMatrix * instancePos;

                // Same radial world-bend math as BendService.applyBend() — baked in directly
                // since this shader has no <project_vertex> chunk for that method to patch.
                // Applied uniformly across the whole box (not just its base) so it sinks in
                // lockstep with the land tile it sits on, same curvature, same amount.
                float dx = worldPos.x - uBendOrigin.x;
                float dz = worldPos.z - uBendOrigin.z;
                worldPos.y -= (dx * dx + dz * dz) * uBendStrength;

                vWorldXZ = worldPos.xz;
                // Box isn't rotated/non-uniformly scaled per instance, so the object-space
                // normal doubles as the world-facing one — good enough for the simple
                // top-vs-side shading below.
                vNormal = normal;
                gl_Position = projectionMatrix * viewMatrix * worldPos;
            }
        `,
        fragmentShader: `
            uniform float uTime;
            uniform vec3 uCloudColorDark;
            uniform vec3 uCloudColorLight;
            varying vec2 vWorldXZ;
            varying vec3 vNormal;

            // Cheap value-noise stand-in — two octaves of sine hash, panned in opposite
            // directions per octave so the result reads as drifting cloud cover rather than a
            // static tiled pattern.
            float hashNoise(vec2 p) {
                return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
            }

            float valueNoise(vec2 p) {
                vec2 i = floor(p);
                vec2 f = fract(p);
                float a = hashNoise(i);
                float b = hashNoise(i + vec2(1.0, 0.0));
                float c = hashNoise(i + vec2(0.0, 1.0));
                float d = hashNoise(i + vec2(1.0, 1.0));
                vec2 u = f * f * (3.0 - 2.0 * f);
                return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
            }

            float cloudPattern(vec2 worldXZ) {
                vec2 p1 = worldXZ * 0.15 + vec2(uTime * 0.05, uTime * 0.02);
                vec2 p2 = worldXZ * 0.35 - vec2(uTime * 0.03, uTime * 0.06);
                return valueNoise(p1) * 0.65 + valueNoise(p2) * 0.35;
            }

            void main() {
                float cloud = cloudPattern(vWorldXZ);
                vec3 cloudColor = mix(uCloudColorDark, uCloudColorLight, smoothstep(0.2, 0.8, cloud));

                // Flat "boxed" shading: the top face reads brighter than the four side faces,
                // which is what actually sells this as a volume instead of a flat sheet.
                float upFacing = smoothstep(-0.1, 0.85, dot(normalize(vNormal), vec3(0.0, 1.0, 0.0)));
                float shade = mix(0.62, 1.0, upFacing);

                gl_FragColor = vec4(cloudColor * shade, 1.0);
            }
        `,
    });
}
