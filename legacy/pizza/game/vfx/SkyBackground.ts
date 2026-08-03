import * as THREE from 'three';
import FourCornersGradientBuilder from './FourCornersGradientBuilder';

/**
 * Animated night-sky gradient attached to the camera.
 * Requires scene.add(camera) before build() so the camera's child mesh
 * is included in the scene-graph traversal and rendered.
 */
export class SkyBackground {
    private gradient = new FourCornersGradientBuilder();

    build(camera: THREE.PerspectiveCamera): void {
        this.gradient.build({
            camera,
            mode: 'four-way',
            distance: 30,
            fourWay: {
                topColor: 0x74cff0, // bright Mario sky blue — zenith
                leftColor: 0x2288e8, // vivid azure — left
                bottomColor: 0x74cff0, // light horizon cyan — bottom
                rightColor: 0x74cff0, // deeper royal blue — right
                radius: 1.5,
                speed: 0.05,
            },
        });
    }

    update(delta: number): void {
        this.gradient.update(delta);
    }

    resize(): void {
        this.gradient.resize();
    }

    destroy(): void {
        this.gradient.destroy();
    }
}
