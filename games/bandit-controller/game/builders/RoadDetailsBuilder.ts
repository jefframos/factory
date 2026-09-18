// RoadDetailsBuilder.ts
//
// Decorative street props (MODELS.World's ElectricityPoleSingle/LightSquare)
// alternating along both sides of a runner-style minigame's lane, at
// ROAD_SETTINGS.detailOffset past the lane's own edge, scaled by
// ROAD_SETTINGS.detailScale — purely visual, no collider, same
// fire-and-forget loading convention as CityBuilder.

import * as THREE from 'three';
import ModelLoaderManager from 'core/three/ModelLoaderManager';
import MODELS from '../../registry/assetsRegistry/modelsRegistry';
import { WorldBendService } from '../services/BendService';
import { ROAD_SETTINGS } from '../data/RoadSettings';

const modelUrl = (fullPath: string): string => `./${fullPath}`;

const DETAIL_MODELS = [MODELS.World.ElectricityPoleSingle, MODELS.World.LightSquare];

async function placeDetail(threeScene: THREE.Scene, fullPath: string, x: number, z: number, rotationY: number, bendService: WorldBendService): Promise<void> {
    const object = await ModelLoaderManager.instance.loadModel(modelUrl(fullPath));
    object.scale.setScalar(ROAD_SETTINGS.detailScale);

    const box = new THREE.Box3().setFromObject(object);
    object.position.set(x, -box.min.y, z);
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
}

/** One side's own row of alternating props. `side` is -1 or 1. */
async function buildSide(threeScene: THREE.Scene, side: number, laneLength: number, laneHalfWidth: number, laneDirectionZ: number, bendService: WorldBendService): Promise<void> {
    const x = side * (laneHalfWidth + ROAD_SETTINGS.detailOffset);
    // Faces the lane regardless of which side it's on — same convention as CityBuilder's own buildings.
    const rotationY = side < 0 ? Math.PI / 2 : -Math.PI / 2;

    const placements: Promise<void>[] = [];
    let index = 0;

    for (let distance = ROAD_SETTINGS.detailSpacing; distance < laneLength; distance += ROAD_SETTINGS.detailSpacing) {
        const model = DETAIL_MODELS[index % DETAIL_MODELS.length];
        const z = laneDirectionZ * distance;
        placements.push(placeDetail(threeScene, model.fullPath, x, z, rotationY, bendService));
        index++;
    }

    await Promise.all(placements);
}

/**
 * Places alternating electricity poles/street lights every
 * ROAD_SETTINGS.detailSpacing world units along BOTH sides of the lane,
 * from just past the start line out to `laneLength`. `laneHalfWidth` is
 * how far the scene's own play area (obstacles/lanes) actually extends
 * from the centerline.
 */
export async function buildRoadDetails(threeScene: THREE.Scene, laneLength: number, laneHalfWidth: number, laneDirectionZ: number, bendService: WorldBendService): Promise<void> {
    await Promise.all([-1, 1].map((side) => buildSide(threeScene, side, laneLength, laneHalfWidth, laneDirectionZ, bendService)));
}
