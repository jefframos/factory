// TowerStarSparkleController.ts

import * as THREE from 'three';
import StarSparkleLayer from '../game/vfx/StarSparkleLayer';
import { TextureBuilder } from '../game/builders/TextureBuilder';
import { resolveIslandImagePath } from '../game/world/IslandStorage';

/** Non-preload star sprite textures — see resolveIslandImagePath(). Both used interchangeably per-star (see StarSparkleLayer.build()) purely for visual variety. */
const STAR_IMAGE_PATHS = ['vfx/star_06.webp', 'vfx/star_07.webp'];

/**
 * Thin wrapper around StarSparkleLayer — resolves/loads the shared star
 * textures and builds the sprite field against the camera, then drives its
 * per-frame drift. Unlike TowerCloudBackdropController (fully static once
 * built), this one genuinely animates every frame, so it needs the same
 * update(delta) forwarding TowerSkyController uses.
 */
export class TowerStarSparkleController {
    private readonly stars = new StarSparkleLayer();
    private built = false;

    public isBuilt(): boolean {
        return this.built;
    }

    public async build(camera: THREE.PerspectiveCamera): Promise<void> {
        const textures = await Promise.all(
            STAR_IMAGE_PATHS.map(path => TextureBuilder.load(resolveIslandImagePath(path))),
        );

        this.stars.build({ camera, textures });
        this.built = true;
    }

    public update(delta: number): void {
        if (!this.built) {
            return;
        }

        this.stars.update(delta);
    }

    public destroy(): void {
        this.stars.destroy();
        this.built = false;
    }
}
