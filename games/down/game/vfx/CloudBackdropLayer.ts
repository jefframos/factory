// CloudBackdropLayer.ts

import * as THREE from 'three';

/** Vertical distance between consecutive clouds along the camera's up axis. */
const CLOUD_VERTICAL_SPACING = 4;

/** How many clouds make up the vertical list. */
const CLOUD_COUNT = 14;

/** Base sprite scale (world units) each cloud is sized to before CLOUD_SCALE_NOISE is applied. */
const CLOUD_BASE_SCALE = 8.5;

/** +/- fraction of CLOUD_BASE_SCALE randomly nudged per cloud. */
const CLOUD_SCALE_NOISE = 0.35;

/** Opacity applied to every cloud sprite. */
const CLOUD_ALPHA = 0.1;

/** Camera-relative Z depth the whole list sits at. */
const CLOUD_DISTANCE = 26;

/** How far left/right consecutive clouds are pushed. */
const CLOUD_HORIZONTAL_OFFSET = 5;

export type CloudBackdropLayoutMode = 'uniform' | 'bottom-heavy';

/**
 * Bottom-heavy clouds are larger toward the bottom and smaller toward
 * the top, while still keeping one cloud per position.
 */
const BOTTOM_HEAVY_BOTTOM_SCALE = 1.6;
const BOTTOM_HEAVY_TOP_SCALE = 0.75;

/**
 * Controls the spacing distribution.
 *
 * 1 = uniform spacing.
 * >1 = positions are compressed toward the bottom.
 *
 * 2.2 gives a noticeable bottom-heavy distribution without making
 * the clouds overlap heavily.
 */
const BOTTOM_HEAVY_DENSITY_POWER = 2.2;

export type CloudBackdropBuildConfig = {
    camera: THREE.Camera;

    /** One texture per cloud "kind". */
    textures: readonly THREE.Texture[];

    /** Opacity applied to every cloud sprite (0-1). */
    alpha?: number;

    /**
     * 'uniform':
     *   Clouds are evenly spaced.
     *
     * 'bottom-heavy':
     *   Clouds are closer together toward the bottom and progressively
     *   more spread out toward the top. Clouds also get larger toward
     *   the bottom.
     */
    layout?: CloudBackdropLayoutMode;
};

/**
 * Vertical stack of low-alpha cloud sprites parented to the camera.
 *
 * In bottom-heavy mode, the clouds retain their individual positions
 * rather than overlapping into a cloud bank. The lower positions are
 * simply closer together, while the upper positions spread apart.
 */
export default class CloudBackdropLayer {
    private group?: THREE.Group;
    private materialsByTexture?: Map<THREE.Texture, THREE.SpriteMaterial>;

    public build(config: CloudBackdropBuildConfig): void {
        this.destroy();

        if (config.textures.length === 0) {
            return;
        }

        const alpha = config.alpha ?? CLOUD_ALPHA;
        const layout = config.layout ?? 'uniform';

        // One shared material per texture.
        const materialsByTexture = new Map<THREE.Texture, THREE.SpriteMaterial>();

        const materialFor = (texture: THREE.Texture): THREE.SpriteMaterial => {
            let material = materialsByTexture.get(texture);

            if (!material) {
                material = new THREE.SpriteMaterial({
                    map: texture,
                    transparent: true,
                    opacity: alpha,
                    depthWrite: false,
                    depthTest: true,
                });

                materialsByTexture.set(texture, material);
            }

            return material;
        };

        const group = new THREE.Group();
        group.renderOrder = -995;

        const totalRange = (CLOUD_COUNT - 1) * CLOUD_VERTICAL_SPACING;
        const startY = -totalRange / 2;

        for (let i = 0; i < CLOUD_COUNT; i++) {
            const texture = config.textures[i % config.textures.length];
            const sprite = new THREE.Sprite(materialFor(texture));

            // Preserve each texture's aspect ratio.
            const image = texture.image as {
                width?: number;
                height?: number;
            } | undefined;

            const aspect = image?.width && image?.height
                ? image.width / image.height
                : 1;

            // 0 = bottom, 1 = top.
            const t = CLOUD_COUNT > 1
                ? i / (CLOUD_COUNT - 1)
                : 0;

            /**
             * Position:
             *
             * Uniform:
             *     0, 1, 2, 3, 4...
             *
             * Bottom-heavy:
             *     0, .005, .02, .05, .10, .18, .29, .42...
             *
             * This means the bottom clouds are closer together, but
             * each cloud still occupies its own position.
             */
            const placementT = layout === 'bottom-heavy'
                ? Math.pow(t, BOTTOM_HEAVY_DENSITY_POWER)
                : t;

            /**
             * Larger at the bottom, gradually shrinking toward the top.
             */
            const layoutScale = layout === 'bottom-heavy'
                ? BOTTOM_HEAVY_BOTTOM_SCALE +
                (BOTTOM_HEAVY_TOP_SCALE - BOTTOM_HEAVY_BOTTOM_SCALE) * t
                : 1;

            const noise =
                1 +
                (CloudBackdropLayer.hashNoise(i) * 2 - 1) *
                CLOUD_SCALE_NOISE;

            const scale =
                CLOUD_BASE_SCALE *
                noise *
                layoutScale;

            sprite.scale.set(
                scale * aspect,
                scale,
                1,
            );

            const side = i % 2 === 0 ? -1 : 1;

            sprite.position.set(
                side * CLOUD_HORIZONTAL_OFFSET,
                startY + placementT * totalRange,
                -CLOUD_DISTANCE,
            );

            sprite.renderOrder = -995;

            group.add(sprite);
        }

        config.camera.add(group);

        this.group = group;
        this.materialsByTexture = materialsByTexture;
    }

    public destroy(): void {
        if (!this.group) {
            return;
        }

        this.group.parent?.remove(this.group);

        for (const material of this.materialsByTexture?.values() ?? []) {
            material.dispose();
        }

        this.group = undefined;
        this.materialsByTexture = undefined;
    }

    /**
     * Deterministic pseudo-random 0..1 value per index.
     */
    private static hashNoise(i: number): number {
        const x = Math.sin(i * 12.9898) * 43758.5453;

        return x - Math.floor(x);
    }
}