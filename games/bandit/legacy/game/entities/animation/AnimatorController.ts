// AnimatorController.ts
//
// Ported as-is from another game's character controller (see
// ThirdPersonCharacter.ts's header) — this half had no engine-specific
// dependencies to begin with (just three.js's own FBX/GLTF loaders), so it
// drops in unchanged.

import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import AnimatorBoard from './AnimationBoard';
import { loadCompressedFile, releaseObjectURL } from '../../utils/GzipLoader';
import { filterClipToBones, UPPER_BODY_BONES } from './BoneMask';

/** Per-animation playback speed configuration. */
export interface AnimationSettings {
    setSpeed(speed: number): void;
}

/**
 * Manages loading/caching animation clips and controlling playback against a single
 * THREE.AnimationMixer, across two independent layers — same shape as a Unity Animator
 * with a masked override layer on top of a base layer:
 *
 *   - BASE layer (play()/mix()/pause()/stop(), driven by animatorBoard — idle/run/jump):
 *     always full-body, exactly as before this layering was added.
 *   - ACTION layer (playActionLayer()/stopActionLayer() — chop/mine/pick): plays a clip
 *     that's been filtered down to just the upper-body bones (see BoneMask.ts), as a
 *     SECOND, concurrent AnimationAction rather than replacing the base layer's. It never
 *     even has values for Hips/leg tracks, so the base layer keeps driving those
 *     untouched (the player keeps walking normally while chopping) — and for the
 *     spine/arm tracks the two layers DO share, the action layer wins outright without
 *     any manual per-track weighting: three.js's PropertyMixer applies a weight-1
 *     contribution as a direct overwrite of whatever a same-weight action already wrote
 *     that frame (see PropertyMixer.accumulate() — weight === 1 skips blending
 *     entirely), and the action layer is always activated (played) after the base
 *     layer already has been, so it's evaluated later within the frame. That overwrite
 *     is exactly "top layer overrides the base layer, masked to certain bones."
 */
export default class AnimatorController {
    // Cache loaded animation clips by URL
    static animationCache: { [url: string]: THREE.AnimationClip } = {};
    private mixer!: THREE.AnimationMixer;
    // Registered animations mapped by custom id
    private animations: { [id: string]: THREE.AnimationClip } = {};
    // Per-animation playback speed settings — persists across play()/playActionLayer() calls
    private animationSpeeds: { [id: string]: number } = {};
    private currentAction: THREE.AnimationAction | null = null;
    // Save the id of the current animation playing
    private currentAnimationId: string | null = null;

    /** Upper-body-only clips, lazily built from `animations` and cached by id — see filterClipToBones(). */
    private maskedAnimations: { [id: string]: THREE.AnimationClip } = {};
    /** The action layer's currently-playing AnimationAction, if any — see playActionLayer()/stopActionLayer(). Entirely separate from currentAction (the base layer). */
    private actionLayerAction: THREE.AnimationAction | null = null;
    private actionLayerId: string | null = null;

    public animatorBoard?: AnimatorBoard;
    constructor() { }

    public setMixer(mixer: THREE.AnimationMixer) {
        this.mixer = mixer;
    }

    async registerAnimation(id: string, animationUrl: string): Promise<void> {
        if (AnimatorController.animationCache[animationUrl]) {
            this.animations[id] = AnimatorController.animationCache[animationUrl];
            return;
        }

        // Decompress if needed (.gz files)
        const resolvedUrl = await loadCompressedFile(animationUrl);

        try {
            // Determine the loader based on the file extension (before .gz if present)
            const baseUrl = animationUrl.replace(/\.gz$/, '');
            const extension = baseUrl.split('.').pop()?.toLowerCase();
            let clip: THREE.AnimationClip | undefined;

            try {
                if (extension === 'fbx') {
                    const fbxLoader = new FBXLoader();
                    const animObject = await fbxLoader.loadAsync(resolvedUrl);
                    if (animObject.animations.length === 0) {
                        console.error('No animations found in the FBX file.');
                        return;
                    }
                    clip = animObject.animations[0];
                } else if (extension === 'glb' || extension === 'gltf') {
                    const gltfLoader = new GLTFLoader();
                    const gltf = await gltfLoader.loadAsync(resolvedUrl);
                    if (!gltf.animations || gltf.animations.length === 0) {
                        console.error('No animations found in the GLTF file.');
                        return;
                    }
                    // Use the first animation
                    clip = gltf.animations[0];
                } else {
                    console.error('Unsupported file extension for animation.');
                    return;
                }

                if (clip) {
                    AnimatorController.animationCache[animationUrl] = clip;
                    this.animations[id] = clip;
                }
            } catch (err) {
                console.error('Error loading animation:', err);
            }
        } finally {
            // Clean up the blob URL if it was created for a .gz file
            releaseObjectURL(resolvedUrl);
        }
    }
    registerAnimatorBoard(initialState: string) {
        this.animatorBoard = new AnimatorBoard(initialState, this);
    }

    /**
     * The registered clip's own native duration in seconds (at timeScale 1), straight from
     * the loaded THREE.AnimationClip — the real source of truth for "how long is this
     * animation," instead of a hand-maintained duplicate number in some other config.
     * Returns undefined if `id` hasn't been registered (or failed to load) yet.
     */
    public getClipDuration(id: string): number | undefined {
        return this.animations[id]?.duration;
    }

    /**
     * Get animation settings for a registered animation ID. Use this to configure
     * per-animation playback speeds that persist across play() calls.
     * Example: animator.getAnimation('chop').setSpeed(1.5);
     */
    public getAnimation(id: string): AnimationSettings {
        return {
            setSpeed: (speed: number) => {
                this.animationSpeeds[id] = speed;
                // If this animation is currently playing, apply the speed immediately
                if (this.currentAnimationId === id && this.currentAction) {
                    this.currentAction.timeScale = speed;
                }
            },
        };
    }

    // Play an animation registered with the given id.
    // The optional allowRestart flag lets the animation restart if it's already playing.
    public play(id: string, allowRestart: boolean = false, loop: boolean = true): void {
        // If the requested animation is already playing and restart isn't allowed, do nothing.
        if (this.currentAnimationId === id && !allowRestart) {
            return;
        }

        const clip = this.animations[id];
        if (!clip || !this.mixer) return;
        const action = this.mixer.clipAction(clip);
        action.reset();

        // Set looping behavior based on the parameter.
        if (!loop) {
            action.setLoop(THREE.LoopOnce, 0);
            action.clampWhenFinished = true;
        } else {
            action.setLoop(THREE.LoopRepeat, Infinity);
        }

        action.play();

        // Apply per-animation speed if one was configured
        const speed = this.animationSpeeds[id];
        if (speed !== undefined) {
            action.timeScale = speed;
        }

        this.currentAction = action;
        this.currentAnimationId = id;
    }


    // Pause the currently playing animation
    pause(): void {
        if (this.currentAction) {
            this.currentAction.paused = true;
        }
    }

    // Resume the paused animation
    resume(): void {
        if (this.currentAction) {
            this.currentAction.paused = false;
        }
    }

    // Stop the currently playing animation
    stop(): void {
        if (this.currentAction) {
            this.currentAction.stop();
            this.currentAnimationId = null;
        }
    }

    public mix(id: string, weight: number = 1.0, duration: number = 0.5, loop: boolean = true): void {
        const clip = this.animations[id];
        if (!clip || !this.mixer) return;

        const newAction = this.mixer.clipAction(clip);
        newAction.reset();

        // Set looping behavior based on the loop flag.
        if (!loop) {
            newAction.setLoop(THREE.LoopOnce, 0);
            newAction.clampWhenFinished = true;
        } else {
            newAction.setLoop(THREE.LoopRepeat, Infinity);
        }

        newAction.setEffectiveWeight(weight);

        // Apply per-animation speed if one was configured
        const speed = this.animationSpeeds[id];
        if (speed !== undefined) {
            newAction.timeScale = speed;
        }

        newAction.play();

        // If there is an existing action that's different, cross-fade from it.
        if (this.currentAction && this.currentAction !== newAction) {
            newAction.crossFadeFrom(this.currentAction, duration, false);
        }

        this.currentAction = newAction;
        this.currentAnimationId = id;
    }

    /** Lazily builds (and caches) the upper-body-only version of a registered clip — see BoneMask.ts. Undefined if `id` hasn't been registered (or failed to load). */
    private getMaskedClip(id: string): THREE.AnimationClip | undefined {
        if (this.maskedAnimations[id]) {
            return this.maskedAnimations[id];
        }

        const clip = this.animations[id];
        if (!clip) {
            return undefined;
        }

        const masked = filterClipToBones(clip, UPPER_BODY_BONES);
        this.maskedAnimations[id] = masked;
        return masked;
    }

    /**
     * Starts the ACTION layer playing `id`'s upper-body-only clip (see this class's own
     * doc) — runs concurrently with whatever the base layer (animatorBoard) is doing,
     * rather than replacing it. Switching directly from one action to another (e.g.
     * chop -> mine without an intervening stopActionLayer()) crossfades between them,
     * same as the base layer's mix(). No-op if `id` hasn't been registered (or failed to
     * load) — same "silently does nothing" fallback play()/mix() already have.
     */
    public playActionLayer(id: string, fadeSec: number = 0.15): void {
        const maskedClip = this.getMaskedClip(id);
        if (!maskedClip || !this.mixer) return;

        const newAction = this.mixer.clipAction(maskedClip);
        newAction.reset();
        newAction.setLoop(THREE.LoopRepeat, Infinity);
        newAction.setEffectiveWeight(1);

        const speed = this.animationSpeeds[id];
        if (speed !== undefined) {
            newAction.timeScale = speed;
        }

        newAction.play();

        if (this.actionLayerAction && this.actionLayerAction !== newAction) {
            newAction.crossFadeFrom(this.actionLayerAction, fadeSec, false);
        } else {
            newAction.fadeIn(fadeSec);
        }

        this.actionLayerAction = newAction;
        this.actionLayerId = id;
    }

    /** Fades the ACTION layer back out to nothing, leaving the base layer (idle/run/jump) as the sole driver of every bone again. No-op if no action layer clip is playing. */
    public stopActionLayer(fadeSec: number = 0.25): void {
        if (!this.actionLayerAction) {
            return;
        }

        this.actionLayerAction.fadeOut(fadeSec);
        this.actionLayerAction = null;
        this.actionLayerId = null;
    }

    /** Which action-layer clip id is currently playing, if any — undefined once stopActionLayer() has faded it out. */
    public getActionLayerId(): string | null {
        return this.actionLayerId;
    }

    // Update the mixer; call this in your render loop
    update(delta: number): void {
        this.animatorBoard?.update(delta)
        if (this.mixer) {
            this.mixer.update(delta);
        }
    }
}
