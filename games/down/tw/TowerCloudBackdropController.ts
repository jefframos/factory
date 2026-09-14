// TowerCloudBackdropController.ts

import * as THREE from 'three';
import CloudBackdropLayer from '../game/vfx/CloudBackdropLayer';
import { TextureBuilder } from '../game/builders/TextureBuilder';
import { resolveIslandImagePath } from '../game/world/IslandStorage';

/** Non-preload cloud sprite texture — see resolveIslandImagePath(). */
const CLOUD_IMAGE_PATH = 'vfx/cloud.webp';

/**
 * Thin wrapper around CloudBackdropLayer — resolves/loads the shared cloud
 * texture and builds the sprite list against the camera. Static once built
 * (no per-frame driving, unlike TowerSkyController/the old
 * TowerStarfieldController): the clouds are camera-parented billboards, so
 * they need no resize or per-frame update of their own.
 */
export class TowerCloudBackdropController {
    private readonly clouds = new CloudBackdropLayer();
    private built = false;

    public isBuilt(): boolean {
        return this.built;
    }

    public async build(camera: THREE.PerspectiveCamera): Promise<void> {
        const texture = await TextureBuilder.load(resolveIslandImagePath(CLOUD_IMAGE_PATH));
        this.clouds.build({ camera, texture });
        this.built = true;
    }

    public destroy(): void {
        this.clouds.destroy();
        this.built = false;
    }
}
