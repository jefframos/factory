// TowerStarSparkleController.ts

import * as THREE from 'three';
import StarSparkleLayer from '../game/vfx/StarSparkleLayer';
import { TextureBuilder } from '../game/builders/TextureBuilder';
import { resolveIslandImagePath } from '../game/world/IslandStorage';

/** Non-preload star sprite textures — see resolveIslandImagePath(). Both used interchangeably per-star (see StarSparkleLayer.build()) purely for visual variety. Default for the 'circle'/'cube' themes — see GameThemeStorage. */
const DEFAULT_STAR_IMAGE_PATHS = ['vfx/star_06.webp', 'vfx/star_07.webp'];

/**
 * Thin wrapper around StarSparkleLayer — resolves/loads the star texture(s)
 * and builds the sprite field against the camera, then drives its per-frame
 * drift. Unlike TowerCloudBackdropController (fully static once built), this
 * one genuinely animates every frame, so it needs the same update(delta)
 * forwarding TowerSkyController uses. Safe to call build() again with a
 * different `imagePaths`/`tint` to swap the particle look at runtime (see
 * IslandViewScene's theme toggle) — StarSparkleLayer.build() always tears
 * down its previous sprites/materials first.
 */
export class TowerStarSparkleController {
    private readonly stars = new StarSparkleLayer();
    private built = false;

    public isBuilt(): boolean {
        return this.built;
    }

    public async build(camera: THREE.PerspectiveCamera, imagePaths: readonly string[] = DEFAULT_STAR_IMAGE_PATHS, tint?: number): Promise<void> {
        const textures = await Promise.all(
            imagePaths.map(path => TextureBuilder.load(resolveIslandImagePath(path))),
        );

        this.stars.build({ camera, textures, tint });
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
