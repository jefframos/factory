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

/** Manages loading/caching animation clips and controlling playback (play/mix/pause/stop) against a single THREE.AnimationMixer. */
export default class AnimatorController {
    // Cache loaded animation clips by URL
    static animationCache: { [url: string]: THREE.AnimationClip } = {};
    private mixer!: THREE.AnimationMixer;
    // Registered animations mapped by custom id
    private animations: { [id: string]: THREE.AnimationClip } = {};
    private currentAction: THREE.AnimationAction | null = null;
    // Save the id of the current animation playing
    private currentAnimationId: string | null = null;

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

        // Determine the loader based on the file extension.
        const extension = animationUrl.split('.').pop()?.toLowerCase();
        let clip: THREE.AnimationClip | undefined;

        try {
            if (extension === 'fbx') {
                const fbxLoader = new FBXLoader();
                const animObject = await fbxLoader.loadAsync(animationUrl);
                if (animObject.animations.length === 0) {
                    console.error('No animations found in the FBX file.');
                    return;
                }
                clip = animObject.animations[0];
            } else if (extension === 'glb' || extension === 'gltf') {
                const gltfLoader = new GLTFLoader();
                const gltf = await gltfLoader.loadAsync(animationUrl);
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
    }
    registerAnimatorBoard(initialState: string) {
        this.animatorBoard = new AnimatorBoard(initialState, this);
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
        newAction.play();

        // If there is an existing action that's different, cross-fade from it.
        if (this.currentAction && this.currentAction !== newAction) {
            newAction.crossFadeFrom(this.currentAction, duration, false);
        }

        this.currentAction = newAction;
        this.currentAnimationId = id;
    }



    // Update the mixer; call this in your render loop
    update(delta: number): void {
        this.animatorBoard?.update(delta)
        if (this.mixer) {
            this.mixer.update(delta);
        }
    }
}
