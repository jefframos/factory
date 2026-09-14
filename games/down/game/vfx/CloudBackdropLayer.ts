// CloudBackdropLayer.ts

import * as THREE from 'three';

/** Vertical distance between consecutive clouds along the camera's up axis. */
const CLOUD_VERTICAL_SPACING = 4;
/** How many clouds make up the vertical list. */
const CLOUD_COUNT = 14;
/** Base sprite scale (world units) each cloud is sized to before CLOUD_SCALE_NOISE is applied. */
const CLOUD_BASE_SCALE = 8.5;
/** +/- fraction of CLOUD_BASE_SCALE randomly nudged per cloud (via hashNoise()) so the stack doesn't read as one uniformly-sized repeating tile. */
const CLOUD_SCALE_NOISE = 0.35;
/** Opacity applied to every cloud sprite — kept faint so the layer reads as atmosphere, not foreground content. */
const CLOUD_ALPHA = 0.1;
/** Camera-relative Z depth the whole list sits at — between the sky gradient (-30) and gameplay, so it reads behind everything else. */
const CLOUD_DISTANCE = 26;
/** How far left/right consecutive clouds are pushed, alternating sides — see build()'s intercalation — so the list reads as a loose zigzag instead of one straight column. */
const CLOUD_HORIZONTAL_OFFSET = 5;

export type CloudBackdropBuildConfig = {
    camera: THREE.Camera;
    texture: THREE.Texture;
};

/**
 * Vertical stack of low-alpha cloud sprites parented to the camera, sitting
 * behind gameplay in front of the four-corners sky gradient — a cheap
 * "distant clouds" backdrop layer replacing the old StarfieldBackground.
 * Sprites alternate left/right (see CLOUD_HORIZONTAL_OFFSET) so the list
 * doesn't read as one straight column, and each one's scale is nudged by a
 * small deterministic per-index noise (see hashNoise()) so the repeating
 * texture doesn't look perfectly uniform. Always billboards toward the
 * camera for free — THREE.Sprite, not a plane — so there's no per-frame
 * facing update needed.
 */
export default class CloudBackdropLayer {
    private group?: THREE.Group;
    private material?: THREE.SpriteMaterial;

    public build(config: CloudBackdropBuildConfig): void {
        this.destroy();

        const material = new THREE.SpriteMaterial({
            map: config.texture,
            transparent: true,
            opacity: CLOUD_ALPHA,
            depthWrite: false,
            // true (unlike the sky gradient's depthTest:false trick) because
            // clouds are a TRANSPARENT material — THREE always draws the
            // transparent pass after the whole opaque pass, so without depth
            // testing every cloud would paint over the (already-drawn)
            // opaque tower/pieces regardless of which is actually nearer the
            // camera. With it on, clouds behind opaque geometry (the normal
            // case, since they sit at CLOUD_DISTANCE) are correctly
            // occluded — same convention as the old StarfieldBackground.
            depthTest: true,
        });

        // Preserve the source texture's own aspect ratio — a uniform (1:1)
        // sprite scale would stretch/squash a non-square cloud image.
        const image = config.texture.image as { width?: number; height?: number } | undefined;
        const aspect = image?.width && image?.height ? image.width / image.height : 1;

        const group = new THREE.Group();
        group.renderOrder = -995;

        const startY = -((CLOUD_COUNT - 1) * CLOUD_VERTICAL_SPACING) / 2;

        for (let i = 0; i < CLOUD_COUNT; i++) {
            const sprite = new THREE.Sprite(material);
            const noise = 1 + (CloudBackdropLayer.hashNoise(i) * 2 - 1) * CLOUD_SCALE_NOISE;
            const scale = CLOUD_BASE_SCALE * noise;
            sprite.scale.set(scale * aspect, scale, 1);

            const side = i % 2 === 0 ? -1 : 1;
            sprite.position.set(
                side * CLOUD_HORIZONTAL_OFFSET,
                startY + i * CLOUD_VERTICAL_SPACING,
                -CLOUD_DISTANCE,
            );
            sprite.renderOrder = -995;

            group.add(sprite);
        }

        config.camera.add(group);
        this.group = group;
        this.material = material;
    }

    public destroy(): void {
        if (!this.group) {
            return;
        }

        this.group.parent?.remove(this.group);
        this.material?.dispose();
        this.group = undefined;
        this.material = undefined;
    }

    /** Deterministic pseudo-random 0..1 value per index — same cloud always gets the same scale nudge, no per-run flicker. */
    private static hashNoise(i: number): number {
        const x = Math.sin(i * 12.9898) * 43758.5453;
        return x - Math.floor(x);
    }
}
