// AnimatorController.ts
//
// Loads/caches FBX animation clips and controls playback against a single
// THREE.AnimationMixer, driven by an AnimatorBoard (idle/walk/run/jump/roll).

import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader';
import AnimatorBoard from './AnimationBoard';
import { loadCompressedFile, releaseObjectURL } from '../../utils/GzipLoader';

export default class AnimatorController {
    static animationCache: { [url: string]: THREE.AnimationClip } = {};
    private mixer!: THREE.AnimationMixer;
    private animations: { [id: string]: THREE.AnimationClip } = {};
    private currentAction: THREE.AnimationAction | null = null;
    private currentAnimationId: string | null = null;

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
            const fbxLoader = new FBXLoader();
            const animObject = await fbxLoader.loadAsync(resolvedUrl);
            if (animObject.animations.length === 0) {
                console.error(`AnimatorController: no animations found in "${animationUrl}"`);
                return;
            }
            const clip = animObject.animations[0];
            AnimatorController.animationCache[animationUrl] = clip;
            this.animations[id] = clip;
        } catch (err) {
            console.error('AnimatorController: error loading animation', err);
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
        newAction.reset();
        newAction.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 0);
        newAction.clampWhenFinished = !loop;
        newAction.setEffectiveWeight(weight);
        newAction.play();

        if (this.currentAction && this.currentAction !== newAction) {
            newAction.crossFadeFrom(this.currentAction, duration, false);
        }

        this.currentAction = newAction;
        this.currentAnimationId = id;
    }

    /** Update the mixer; call this once per frame. */
    public update(delta: number): void {
        this.animatorBoard?.update(delta);
        if (this.mixer) {
            this.mixer.update(delta);
        }
    }
}
