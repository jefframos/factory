// BoneMask.ts
//
// Splits a full-body AnimationClip down to just the bones an upper-body
// "action layer" should drive (chop/mine/pick) — the Unity-animator
// equivalent of a layer's avatar mask. Bone names come from the rig
// documented in modelsRegistry.ts's TestIdle entry: a standard humanoid
// hierarchy where Hips -> Spine -> Chest -> UpperChest -> Neck -> Head, with
// both arm chains branching off UpperChest and both leg chains off Hips.
// "Spine and everything under it" is exactly the arm/hand/head set below —
// Hips itself and both leg chains are deliberately left OUT so root motion
// and locomotion stay entirely on the base (idle/run) layer.

import * as THREE from 'three';

/** Every bone name AnimatorController.playActionLayer()'s masked clip is allowed to touch — see this file's own doc for why the split lands at Spine. */
export const UPPER_BODY_BONES = new Set([
    'Hips', 'Spine', 'Chest', 'UpperChest', 'Neck', 'Head', 'Head_end',
    'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand',
    'LeftHandIndex1', 'LeftHandIndex2', 'LeftHandIndex3', 'LeftHandIndex3_end',
    'LeftHandThumb1', 'LeftHandThumb2', 'LeftHandThumb2_end',
    'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand',
    'RightHandIndex1', 'RightHandIndex2', 'RightHandIndex3', 'RightHandIndex3_end',
    'RightHandThumb1', 'RightHandThumb2', 'RightHandThumb2_end',
]);

/**
 * Returns a new clip containing only `clip`'s tracks whose target bone is in `boneNames` —
 * everything else (Hips, legs, ...) is dropped so playing this clip as a second, concurrent
 * AnimationAction never touches those bones at all, leaving them entirely to whatever base
 * layer is already running. Track names are three.js's own `"boneName.property"` convention
 * (see THREE.PropertyBinding) — the bone is everything before the LAST dot, since a bone name
 * itself is never expected to contain one.
 */
export function filterClipToBones(clip: THREE.AnimationClip, boneNames: ReadonlySet<string>): THREE.AnimationClip {
    const tracks = clip.tracks.filter(track => {
        const boneName = track.name.slice(0, track.name.lastIndexOf('.'));
        return boneNames.has(boneName);
    });

    return new THREE.AnimationClip(`${clip.name}__masked`, clip.duration, tracks);
}
