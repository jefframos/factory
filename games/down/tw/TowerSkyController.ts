// TowerSkyController.ts

import * as THREE from 'three';
import FourCornersGradientBuilder from '../game/vfx/FourCornersGradientBuilder';
import { parseHexColor } from '../game/world/IslandStorage';
import { SKY_CYCLE_COLORS } from './TowerIslandProgression';

/**
 * How fast the four corner colors orbit each other — see
 * FourCornersGradientBuilder's 'four-way' mode uTime speed. Noticeably
 * quicker than the old SkyBackground's 0.05 (a ~140s cycle) since
 * SKY_CYCLE_COLORS are all close-hue blues — a slow drift barely reads as
 * motion when the colors themselves are this similar.
 */
const ROTATION_SPEED = 0.15;
/**
 * Tighter than FourCornersGradientBuilder's own 1.25 default — a smaller
 * radius shrinks each corner's falloff, giving the blend more contrast so
 * the orbit is visible instead of just a gentle overall tint shift.
 */
const ROTATION_RADIUS = 0.85;

/**
 * Four-corners sky (see FourCornersGradientBuilder's 'four-way' mode) with
 * one fixed corner per SKY_CYCLE_COLORS entry, continuously rotating via the
 * shader's own uTime-driven corner-weight animation. Unlike the old
 * per-zone-transitioning sky, this palette is set once at build() and never
 * changes again — the "cycling" the player sees is entirely the shader's
 * rotation, not a level/zone-driven color swap, so the background's overall
 * color mix stays constant across the whole run.
 */
export class TowerSkyController {
    private readonly gradient = new FourCornersGradientBuilder();
    private built = false;

    public isBuilt(): boolean {
        return this.built;
    }

    public build(camera: THREE.PerspectiveCamera): void {
        const [top, left, bottom, right] = SKY_CYCLE_COLORS.map(parseHexColor);

        this.gradient.build({
            camera,
            mode: 'four-way',
            distance: 30,
            fourWay: {
                topColor: top,
                leftColor: left,
                bottomColor: bottom,
                rightColor: right,
                speed: ROTATION_SPEED,
                radius: ROTATION_RADIUS,
            },
        });

        this.built = true;
    }

    public update(delta: number): void {
        if (!this.built) {
            return;
        }

        this.gradient.update(delta);
    }

    public resize(): void {
        this.gradient.resize();
    }

    public destroy(): void {
        this.gradient.destroy();
        this.built = false;
    }
}
