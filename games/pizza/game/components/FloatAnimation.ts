// FloatAnimation.ts
//
// A small idle up/down bob, looped forever — makes a placed prop (a craft
// table's showcased tool/model, see CraftZone.ts) read as alive/interactive
// instead of a static plaster fixture. Not a Component of its own since it
// has nothing to tick or tear down beyond the one gsap tween — a caller
// just calls applyFloatAnimation() once the target mesh exists (synchronously
// for a BoxVisualComponent, or from GlbVisualComponent's `onReady` callback
// once its async model load resolves) and kills the returned tween in its
// own destroy().
//
// Animates `target`'s own LOCAL y position, relative to whatever it already
// is when this is called (its resting offset) — both BoxVisualComponent and
// GlbVisualComponent parent their mesh directly under `entity.transform`
// (see their own awake()), so bobbing the mesh's own position never moves
// the entity's transform itself (and whatever else — a trigger collider, a
// label anchor — is parented to THAT instead).

import gsap from 'gsap';
import * as THREE from 'three';

const FLOAT_AMPLITUDE = 0.12;
const FLOAT_DURATION_SEC = 1.6;

export function applyFloatAnimation(
    target: THREE.Object3D,
    amplitude: number = FLOAT_AMPLITUDE,
    durationSec: number = FLOAT_DURATION_SEC,
): gsap.core.Tween {
    const baseY = target.position.y;
    return gsap.to(target.position, {
        y: baseY + amplitude,
        duration: durationSec,
        ease: 'sine.inOut',
        yoyo: true,
        repeat: -1,
    });
}
