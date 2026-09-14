// StarSparkleLayer.ts

import * as THREE from 'three';

/** How many stars are alive at once — deliberately sparse, an accent over the clouds, not a dense starfield. */
const STAR_COUNT = 35;
/** Average vertical gap (world units) a star occupies — used only to size the total bottom-to-top drift range (STAR_COUNT * this, see build()), not a fixed per-star slot any more: every star shares the SAME bottom/top of that range now (see respawn()/update()'s own docs for why). Bigger = a taller range, so a full lap up the screen takes longer. */
const STAR_VERTICAL_SPACING = 5;
/** Base sprite scale (world units) before STAR_SCALE_MIN/MAX is applied per star. */
const STAR_BASE_SCALE = 1;
/** Per-star scale range, as a multiple of STAR_BASE_SCALE — each star picks one value in this range on spawn/respawn, so the drift reads as a mix of near/far sparkles rather than a uniform repeating size. */
const STAR_SCALE_MIN = 0.6;
const STAR_SCALE_MAX = 1.6;
/** Per-star upward drift speed range, world units/second — paired with STAR_SCALE_MIN/MAX (bigger stars default to the faster end — see respawn()) so the size/speed pairing itself reads as a cheap parallax cue, not just random noise. */
const STAR_SPEED_MIN = 0.6;
const STAR_SPEED_MAX = 1.2;
/** How far left/right of center a star can spawn — plain uniform random per star, unlike the clouds' deterministic left/right alternation, since stars respawn continuously and a fixed pattern would read as mechanical. */
const STAR_HORIZONTAL_SPREAD = 5;
/** Opacity applied to every star sprite. */
const STAR_ALPHA = 0.75;
/** Tint multiplied over the star texture's own color — 0xffffff leaves it untouched. */
const STAR_TINT = 0xfdf138;
/** Camera-relative Z depth — between the sky gradient (-30) and the cloud backdrop (-26, see CloudBackdropLayer), so sparkles read as sitting just in front of the clouds. */
const STAR_DISTANCE = 18;
/**
 * Hard cap (seconds) on the delta a single update() call is allowed to move
 * stars by. A backgrounded tab regaining focus (or a platform-pause resume)
 * can hand the NEXT frame a multi-second (sometimes multi-minute) delta —
 * Game.deltaTime is NOT clamped for this (only the fixed-update accumulator
 * is, in core/Game.ts) — so without this cap every star would jump/teleport
 * that whole distance in one frame the instant the tab refocuses, reading
 * as a glitch. Capped at roughly 3 normal frames' worth at 60fps rather
 * than a single frame, so a genuine brief stutter still looks like motion,
 * not a freeze.
 */
const MAX_DELTA_SECONDS = 0.05;

export type StarSparkleBuildConfig = {
    camera: THREE.Camera;
    /** One texture per star "kind" (e.g. star_06/star_07) — each star instance picks one at random on build, purely for visual variety. */
    textures: readonly THREE.Texture[];
};

interface StarInstance {
    sprite: THREE.Sprite;
    speed: number;
    /** Shared World-Y every star resets to once it drifts past topY — the actual bottom of the screen/range, same value for all stars (see build()) — not a per-star slot any more. */
    bottomY: number;
    /** Shared World-Y that triggers the reset — same for every star. */
    topY: number;
}

/**
 * Sparse field of upward-drifting star sprites, camera-parented at
 * STAR_DISTANCE — sits just in front of the cloud backdrop (see
 * CloudBackdropLayer). Every star spawns/respawns at the SAME point at the
 * bottom of the range and drifts straight up, picking its own fresh
 * scale/speed/texture/X each time (see respawn()) so the field never reads
 * as a mechanical repeating pattern — no per-frame allocation once built,
 * a looping star is repositioned in place, not destroyed/recreated.
 *
 * build() "pre-warms" the field — see its own doc — so the very first
 * frame already looks like the layer has been running for a while, instead
 * of every star visibly starting clustered at the bottom edge.
 */
export default class StarSparkleLayer {
    private group?: THREE.Group;
    private materialsByTexture?: Map<THREE.Texture, THREE.SpriteMaterial>;
    private stars: StarInstance[] = [];

    /**
     * `textures` is empty until loaded, and pre-warming here (rather than
     * leaving the field to fill up naturally over the first several seconds
     * of real playtime) means the scene never opens on an empty-looking
     * backdrop — see the per-star pre-warm comment inside the build loop.
     */
    public build(config: StarSparkleBuildConfig): void {
        this.destroy();

        if (config.textures.length === 0) {
            return;
        }

        // One shared material per texture (not per star) — cached by
        // texture so STAR_COUNT stars sharing a handful of textures still
        // only cost a few draw calls, same sharing convention
        // CloudBackdropLayer uses.
        const materialsByTexture = new Map<THREE.Texture, THREE.SpriteMaterial>();
        const materialFor = (texture: THREE.Texture): THREE.SpriteMaterial => {
            let material = materialsByTexture.get(texture);

            if (!material) {
                material = new THREE.SpriteMaterial({
                    map: texture,
                    color: STAR_TINT,
                    transparent: true,
                    opacity: STAR_ALPHA,
                    depthWrite: false,
                    // See CloudBackdropLayer's own doc for why this is true
                    // (not the sky gradient's depthTest:false trick) — a
                    // transparent material always draws after the whole
                    // opaque pass, so without depth testing every star would
                    // paint over already-drawn opaque geometry regardless of
                    // which is actually nearer the camera.
                    depthTest: true,
                });
                materialsByTexture.set(texture, material);
            }

            return material;
        };

        const group = new THREE.Group();
        group.renderOrder = -994;

        const totalRange = STAR_COUNT * STAR_VERTICAL_SPACING;
        const bottomY = -totalRange / 2;
        const topY = totalRange / 2;

        const stars: StarInstance[] = [];

        for (let i = 0; i < STAR_COUNT; i++) {
            const texture = config.textures[i % config.textures.length];
            const sprite = new THREE.Sprite(materialFor(texture));
            sprite.renderOrder = -994;

            const star: StarInstance = { sprite, speed: 0, bottomY, topY };
            StarSparkleLayer.respawn(star);

            // Pre-warm: every star's TRUE spawn point is bottomY (see
            // update()'s wrap), but starting the whole field there on
            // frame one would leave the screen looking empty until each
            // star had drifted all the way up at least once. Instead, fast
            // -forward each star by a random fraction of its own
            // bottom-to-top travel time — exactly as if the layer had
            // already been running for a while before the player ever saw
            // it — so the field opens already spread across the range.
            const travelTime = (topY - bottomY) / star.speed;
            const elapsed = Math.random() * travelTime;
            sprite.position.y = bottomY + elapsed * star.speed;

            group.add(sprite);
            stars.push(star);
        }

        config.camera.add(group);
        this.group = group;
        this.materialsByTexture = materialsByTexture;
        this.stars = stars;
    }

    /** Call once per frame while built. See MAX_DELTA_SECONDS's own doc for why `delta` is clamped internally rather than trusting the caller's raw frame delta. */
    public update(delta: number): void {
        if (this.stars.length === 0) {
            return;
        }

        const clampedDelta = Math.min(Math.max(delta, 0), MAX_DELTA_SECONDS);

        for (const star of this.stars) {
            star.sprite.position.y += star.speed * clampedDelta;

            if (star.sprite.position.y > star.topY) {
                // Back to the shared bottom of the range — every star
                // reads as rising up from the bottom of the screen, not
                // wherever it happened to overshoot to.
                star.sprite.position.y = star.bottomY;
                StarSparkleLayer.respawn(star);
            }
        }
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
        this.stars = [];
    }

    /** Rolls a fresh scale/speed/X for `star` — called on initial build and every time it wraps back to the bottom of its range, so a looping star doesn't look identical lap after lap. Never touches Y — the caller owns that. */
    private static respawn(star: StarInstance): void {
        const scaleT = Math.random();
        const scale = STAR_BASE_SCALE * (STAR_SCALE_MIN + (STAR_SCALE_MAX - STAR_SCALE_MIN) * scaleT);
        star.sprite.scale.set(scale, scale, 1);

        // Bigger stars drift faster — reuses the SAME random draw (scaleT)
        // that picked the scale, so the size/speed pairing STAR_SPEED_MIN/
        // MAX's own doc describes stays consistent rather than two
        // independent rolls that could contradict it.
        star.speed = STAR_SPEED_MIN + (STAR_SPEED_MAX - STAR_SPEED_MIN) * scaleT;

        star.sprite.position.x = (Math.random() * 2 - 1) * STAR_HORIZONTAL_SPREAD;
        star.sprite.position.z = -STAR_DISTANCE;
    }
}
