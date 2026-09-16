// ZoneRevealEffect.ts
//
// The visual half of a zone reveal — a ring that expands outward from `origin` (wherever the
// player was standing when the zone unlocked — see WorldManager.revealNextZone()), sharing the
// exact same ZONE_REVEAL_CONFIG.waveSpeed the newly-visible objects' own rise delay uses (see
// ZoneVisibilityManager.revealZone()), so the ring visually lines up with whatever's popping up
// as it sweeps past. Purely decorative — nothing about the actual reveal (visibility, walkability,
// materialization) depends on this ever running; it's fire-and-forget per call.
//
// One big flat circle, built once at ZONE_REVEAL_CONFIG.shockwaveMaxRadius (see
// ZoneRevealShockwaveMaterial.ts's own doc for why animating a uRadius uniform instead of
// resizing geometry every frame), tweened via gsap same as every other one-shot VFX in this
// codebase (ResourceNode.playSpawnIn(), etc.), then torn down and disposed once the tween
// finishes — nothing lingers in the scene between reveals.

import * as THREE from 'three';
import gsap from 'gsap';
import { createZoneRevealShockwaveMaterial } from '../services/ZoneRevealShockwaveMaterial';
import { ZONE_REVEAL_CONFIG } from './FogOfWarConfig';

/** Small lift above the ground so the ring doesn't z-fight with terrain/water. */
const RING_Y_OFFSET = 0.15;

export function playZoneRevealShockwave(threeScene: THREE.Scene, origin: THREE.Vector3): void {
    const material = createZoneRevealShockwaveMaterial();
    material.uniforms.uBandWidth.value = ZONE_REVEAL_CONFIG.shockwaveBandWidth;

    const geometry = new THREE.CircleGeometry(ZONE_REVEAL_CONFIG.shockwaveMaxRadius, 128);
    geometry.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(origin.x, RING_Y_OFFSET, origin.z);
    mesh.frustumCulled = false;
    threeScene.add(mesh);

    const durationSec = ZONE_REVEAL_CONFIG.shockwaveMaxRadius / ZONE_REVEAL_CONFIG.waveSpeed;
    gsap.to(material.uniforms.uRadius, {
        value: ZONE_REVEAL_CONFIG.shockwaveMaxRadius,
        duration: durationSec,
        ease: 'none',
        onComplete: () => {
            threeScene.remove(mesh);
            geometry.dispose();
            material.dispose();
        },
    });
}
