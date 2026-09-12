// TowerStarfieldController.ts

import * as THREE from 'three';
import StarfieldBackground from '../game/vfx/StarfieldBackground';

/** World-Z the star plane sits at, camera-relative — matches StarfieldBackground's own default position so its built-in sizing assumptions (star speed, shooting-star bounds) stay valid. */
const DISTANCE = 25;

/**
 * Thin wrapper around StarfieldBackground driving its visibility from the
 * level/island progression, the same way TowerSkyController drives the sky
 * gradient — except continuously (every frame, from actual climb height)
 * rather than in per-zone steps, since "how visible the stars are" reads
 * naturally as a smooth fade rather than a stepped cross-fade the way a sky
 * COLOR does. Built lazily the first time an island defines BOTH
 * starfieldWeightMin/Max (see IslandViewScene.applyZoneIsland()) — an
 * island that omits either just never gets a starfield.
 */
export class TowerStarfieldController {
    private readonly starfield = new StarfieldBackground();
    private built = false;

    private weightMin = 0;
    private weightMax = 0;

    public isBuilt(): boolean {
        return this.built;
    }

    public build(camera: THREE.PerspectiveCamera): void {
        this.built = true;

        const { width, height } = TowerStarfieldController.visibleBounds(camera);

        this.starfield.build({
            target: camera,
            position: { x: 0, y: 0, z: -DISTANCE },
            bounds: { width, height },
        });
    }

    /** Sets the 0..1 bounds this island's climb progress interpolates between — see updateProgress(). Takes effect on the NEXT updateProgress() call, not retroactively. */
    public setWeightBounds(min: number, max: number): void {
        this.weightMin = min;
        this.weightMax = max;
    }

    /** `t` is 0..1 progress through the CURRENT level's zones (see IslandViewScene.update()) — maps to `weightMin`..`weightMax` and pushes it straight to the shader, so the fade is exactly as smooth as the underlying height climb, no separate easing needed. No-op before build(). */
    public updateProgress(t: number): void {
        if (!this.built) {
            return;
        }

        const clampedT = Math.max(0, Math.min(1, t));
        this.starfield.setVisibility(this.weightMin + (this.weightMax - this.weightMin) * clampedT);
    }

    public update(delta: number): void {
        if (!this.built) {
            return;
        }

        this.starfield.update(delta);
    }

    public resize(camera: THREE.PerspectiveCamera): void {
        if (!this.built) {
            return;
        }

        const { width, height } = TowerStarfieldController.visibleBounds(camera);
        this.starfield.setBounds(width, height);
    }

    public destroy(): void {
        this.starfield.destroy();
        this.built = false;
    }

    /** Same fit-to-FOV math as FourCornersGradientBuilder.resize() — sized off the SAME camera at the SAME distance convention, so the star plane always covers the full visible frustum. */
    private static visibleBounds(camera: THREE.PerspectiveCamera): { width: number; height: number } {
        const fovRad = THREE.MathUtils.degToRad(camera.getEffectiveFOV());
        const height = 2 * Math.tan(fovRad / 2) * DISTANCE;
        const width = height * camera.aspect;

        return { width, height };
    }
}
