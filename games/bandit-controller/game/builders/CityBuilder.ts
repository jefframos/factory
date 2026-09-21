// CityBuilder.ts
//
// Decorative low-detail city buildings lining both sides of a runner-style
// minigame's lane (MODELS.World's LowDetailBuilding* set) — purely visual,
// no collider. Uses the scene's own bendService so distant buildings
// curve/sink together with the track instead of standing rigidly straight
// while everything else around them bends.
//
// Every building is scaled by the SAME flat CITY_SETTINGS.scale multiplier
// (not normalized to a common height — see CitySettings.ts's own doc), but
// the source models still aren't all modeled at the same native footprint,
// so each one is still MEASURED (THREE.Box3, after scaling) right after
// loading rather than placed by a single blind spacing number:
//   - its own (scaled) half-width is what pushes it out from the lane —
//     so its NEAR edge, not its pivot, ends up exactly CITY_SETTINGS.padding
//     past the lane's own edge, regardless of how wide that particular
//     model turned out to be;
//   - its own (scaled) half-depth is what advances the placement cursor
//     along the lane — so the next building starts right after THIS one's
//     actual footprint (+ CITY_SETTINGS.gap), never overlapping it or
//     leaving a gap sized for a different building.
//
// Loading is fire-and-forget async, same as MainPlayer's own character
// load — the minigame's own `ready` (WorldEnvironment.playerReady) never
// waits on this, so these simply pop in shortly after the scene starts
// rather than delaying the player's own transition-reveal. Each side's own
// row is placed sequentially (building N's position depends on knowing
// building N-1's actual measured depth), but the two sides run
// concurrently with each other.

import * as THREE from 'three';
import ModelLoaderManager from 'core/three/ModelLoaderManager';
import MODELS from '../../registry/assetsRegistry/modelsRegistry';
import { WorldBendService } from 'core/services/BendService';
import { CITY_SETTINGS } from '../data/CitySettings';

const modelUrl = (fullPath: string): string => `./${fullPath}`;

const LOW_DETAIL_BUILDINGS = [
    MODELS.World.LowDetailBuildingA,
    MODELS.World.LowDetailBuildingB,
    MODELS.World.LowDetailBuildingC,
    MODELS.World.LowDetailBuildingD,
    MODELS.World.LowDetailBuildingE,
    MODELS.World.LowDetailBuildingF,
    MODELS.World.LowDetailBuildingG,
    MODELS.World.LowDetailBuildingH,
    MODELS.World.LowDetailBuildingI,
    MODELS.World.LowDetailBuildingJ,
    MODELS.World.LowDetailBuildingK,
    MODELS.World.LowDetailBuildingL,
    MODELS.World.LowDetailBuildingM,
    MODELS.World.LowDetailBuildingN,
    MODELS.World.LowDetailBuildingWideA,
    MODELS.World.LowDetailBuildingWideB,
];

function randomBuilding(): typeof LOW_DETAIL_BUILDINGS[number] {
    return LOW_DETAIL_BUILDINGS[Math.floor(Math.random() * LOW_DETAIL_BUILDINGS.length)];
}

/**
 * Loads one building and applies CITY_SETTINGS.scale — returns it alongside
 * its now-scaled half-width/half-depth and its base-to-pivot offset (so
 * whoever positions it can sit its actual base on the ground regardless of
 * where this particular model's own pivot happens to be).
 */
async function loadScaledBuilding(): Promise<{ object: THREE.Object3D; halfWidth: number; halfDepth: number; baseOffset: number }> {
    const object = await ModelLoaderManager.instance.loadModel(modelUrl(randomBuilding().fullPath));

    const nativeBox = new THREE.Box3().setFromObject(object);
    const nativeHalfWidth = (nativeBox.max.x - nativeBox.min.x) / 2;
    const nativeHalfDepth = (nativeBox.max.z - nativeBox.min.z) / 2;

    const scale = CITY_SETTINGS.scale;
    object.scale.setScalar(scale);

    return {
        object,
        halfWidth: nativeHalfWidth * scale,
        halfDepth: nativeHalfDepth * scale,
        baseOffset: -nativeBox.min.y * scale,
    };
}

/** One side's own row — sequential, since each building's own placement depends on knowing how wide/deep the previous one actually measured. `side` is -1 or 1. */
async function buildSide(threeScene: THREE.Scene, side: number, laneLength: number, laneHalfWidth: number, laneDirectionZ: number, bendService: WorldBendService): Promise<void> {
    // Buildings face the lane regardless of which side they're on.
    const rotationY = side < 0 ? Math.PI / 2 : -Math.PI / 2;
    let edge = CITY_SETTINGS.startOffset;

    while (edge < laneLength) {
        // eslint-disable-next-line no-await-in-loop -- deliberately sequential, see this file's own doc.
        const { object, halfWidth, halfDepth, baseOffset } = await loadScaledBuilding();

        const centerDistance = edge + halfDepth;
        const x = side * (laneHalfWidth + CITY_SETTINGS.padding + halfWidth);
        const z = laneDirectionZ * centerDistance;

        object.position.set(x, baseOffset + CITY_SETTINGS.baseHeight, z);
        object.rotation.y = rotationY;

        object.traverse((child) => {
            if (!(child instanceof THREE.Mesh)) {
                return;
            }
            const materials = Array.isArray(child.material) ? child.material : [child.material];
            for (const material of materials) {
                bendService.applyBend(material);
            }
        });

        threeScene.add(object);

        edge = centerDistance + halfDepth + CITY_SETTINGS.gap;
    }
}

/**
 * Places low-detail buildings packed edge-to-edge (plus CITY_SETTINGS.gap)
 * along BOTH sides of the lane, from just past the start line out to
 * `laneLength` — `laneHalfWidth` is how far the scene's own play area
 * (obstacles/lanes) actually extends from the centerline, so buildings
 * clear it by CITY_SETTINGS.padding rather than a number picked without
 * knowing either side's real dimensions.
 */
export async function buildCityRow(threeScene: THREE.Scene, laneLength: number, laneHalfWidth: number, laneDirectionZ: number, bendService: WorldBendService): Promise<void> {
    await Promise.all([-1, 1].map((side) => buildSide(threeScene, side, laneLength, laneHalfWidth, laneDirectionZ, bendService)));
}
