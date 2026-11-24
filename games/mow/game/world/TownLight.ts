// TownLight.ts
//
// The town's light: sky and ground fill, and the sun. What faces straight up (the lawns, the grass, the ground) is lit the
// same everywhere, so those are unlit materials in their colour times UP_LIGHT: the same look, for a fraction of the work.

import * as THREE from 'three';

const SKY = { sky: 0xffffff, ground: 0x5a7a4a, intensity: 1.6 };
const SUN = { intensity: 1.5, x: 6, y: 14, z: 8 };

export function addTownLights(threeScene: THREE.Scene): void {
    threeScene.add(new THREE.HemisphereLight(SKY.sky, SKY.ground, SKY.intensity));
    const sun = new THREE.DirectionalLight(0xffffff, SUN.intensity);
    sun.position.set(SUN.x, SUN.y, SUN.z);
    threeScene.add(sun);
}

/** What a lit matte surface facing up gives back of its colour (three's Lambert: light over pi; all of the sky's, the sun's by its height). */
export const UP_LIGHT = (SKY.intensity + (SUN.intensity * SUN.y) / Math.hypot(SUN.x, SUN.y, SUN.z)) / Math.PI;
