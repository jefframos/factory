// AnimatorController.ts
//
// Loads/caches FBX/GLB animation clips and controls playback against a single
// THREE.AnimationMixer, driven by an AnimatorBoard (idle/walk/run/jump/roll).

import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import AnimatorBoard from './AnimationBoard';
import { loadCompressedFile, releaseObjectURL } from '../../utils/GzipLoader';

export default class AnimatorController {
    static animationCache: { [url: string]: THREE.AnimationClip } = {};
    private mixer!: THREE.AnimationMixer;
    private animations: { [id: string]: THREE.AnimationClip } = {};
    private currentAction: THREE.AnimationAction | null = null;
    private currentAnimationId: string | null = null;
    private stateMachineSuspended = false;

    public animatorBoard?: AnimatorBoard;

    public setMixer(mixer: THREE.AnimationMixer): void {
        this.mixer = mixer;
    }

    public async registerAnimation(id: string, animationUrl: string): Promise<void> {
        if (AnimatorController.animationCache[animationUrl]) {
            this.animations[id] = AnimatorController.animationCache[animationUrl];
            return;
        }

        const resolvedUrl = await loadCompressedFile(animationUrl);
        try {
            const extension = animationUrl.replace(/\.gz$/, '').split('.').pop()?.toLowerCase();
            let clip: THREE.AnimationClip | undefined;

            if (extension === 'fbx') {
                const animObject = await new FBXLoader().loadAsync(resolvedUrl);
                clip = animObject.animations[0];
            } else if (extension === 'glb' || extension === 'gltf') {
                const gltf = await new GLTFLoader().loadAsync(resolvedUrl);
                clip = gltf.animations[0];
            } else {
                console.error(`AnimatorController: unsupported animation format "${extension}" in "${animationUrl}"`);
                return;
            }

            if (!clip) {
                console.error(`AnimatorController: no animations found in "${animationUrl}"`);
                return;
            }

            AnimatorController.animationCache[animationUrl] = clip;
            this.animations[id] = clip;
        } catch (err) {
            console.error(`AnimatorController: error loading animation "${animationUrl}"`, err);
        } finally {
            releaseObjectURL(resolvedUrl);
        }
    }

    public registerAnimatorBoard(initialState: string): void {
        this.animatorBoard = new AnimatorBoard(initialState, this);
    }

    /** Play an animation registered with the given id, replacing whatever's playing with no crossfade. */
    public play(id: string, allowRestart: boolean = false, loop: boolean = true): void {
        if (this.currentAnimationId === id && !allowRestart) {
            return;
        }

        const clip = this.animations[id];
        if (!clip || !this.mixer) return;

        const action = this.mixer.clipAction(clip);
        action.reset();
        action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 0);
        action.clampWhenFinished = !loop;
        action.play();

        this.currentAction = action;
        this.currentAnimationId = id;
    }

    /** Crossfades from whatever's currently playing into `id` over `duration` seconds. */
    public mix(id: string, weight: number = 1.0, duration: number = 0.5, loop: boolean = true): void {
        const clip = this.animations[id];
        if (!clip || !this.mixer) return;

        const newAction = this.mixer.clipAction(clip);

        // Two different state ids can resolve to the SAME underlying clip (e.g. a
        // placeholder clip registered under both 'falling' and 'landing' until real art
        // exists for each) — three.js's AnimationMixer caches one AnimationAction per clip,
        // so newAction here would already be the exact action currently playing. Resetting
        // and crossfading it from itself would just snap it back to frame 0 — a visible
        // restart glitch for something that should keep playing uninterrupted through the
        // "transition." Just update the bookkeeping id and leave it alone.
        if (newAction === this.currentAction) {
            this.currentAnimationId = id;
            return;
        }

        newAction.reset();
        newAction.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 0);
        newAction.clampWhenFinished = !loop;
        newAction.setEffectiveWeight(weight);
        newAction.play();

        if (this.currentAction) {
            newAction.crossFadeFrom(this.currentAction, duration, false);
        }

        this.currentAction = newAction;
        this.currentAnimationId = id;
    }

    /** Crossfades to a manually selected pose and stops locomotion transitions from taking it over. */
    public playExclusive(id: string, duration: number = 0.2, loop: boolean = false): void {
        this.stateMachineSuspended = true;
        this.mix(id, 1, duration, loop);
    }

    /** Update the mixer; call this once per frame. */
    public update(delta: number): void {
        if (!this.stateMachineSuspended) {
            this.animatorBoard?.update(delta);
        }
        if (this.mixer) {
            this.mixer.update(delta);
        }
    }
}
