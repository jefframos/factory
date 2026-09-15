// TowerCloudBackdropController.ts

import * as THREE from 'three';
import CloudBackdropLayer, { type CloudBackdropLayoutMode } from '../game/vfx/CloudBackdropLayer';
import { TextureBuilder } from '../game/builders/TextureBuilder';
import { resolveIslandImagePath } from '../game/world/IslandStorage';

/** Non-preload cloud sprite texture — see resolveIslandImagePath(). Default for the 'circle'/'cube' themes — see GameThemeStorage. */
const DEFAULT_CLOUD_IMAGE_PATHS = ['vfx/cloud.webp'];

/**
 * Thin wrapper around CloudBackdropLayer — resolves/loads the cloud
 * texture(s) and builds the sprite list against the camera. Static once
 * built (no per-frame driving, unlike TowerSkyController/the old
 * TowerStarfieldController): the clouds are camera-parented billboards, so
 * they need no resize or per-frame update of their own. Safe to call build()
 * again with a different `imagePaths` list to swap the backdrop at runtime
 * (see IslandViewScene's theme toggle) — CloudBackdropLayer.build() always
 * tears down its previous sprites/materials first.
 */
export class TowerCloudBackdropController {
    private readonly clouds = new CloudBackdropLayer();
    private built = false;

    public isBuilt(): boolean {
        return this.built;
    }

    public async build(
        camera: THREE.PerspectiveCamera,
        imagePaths: readonly string[] = DEFAULT_CLOUD_IMAGE_PATHS,
        alpha?: number,
        layout?: CloudBackdropLayoutMode,
    ): Promise<void> {
        const textures = await Promise.all(
            imagePaths.map(path => TextureBuilder.load(resolveIslandImagePath(path))),
        );

        this.clouds.build({ camera, textures, alpha, layout });
        this.built = true;
    }

    public destroy(): void {
        this.clouds.destroy();
        this.built = false;
    }
}
