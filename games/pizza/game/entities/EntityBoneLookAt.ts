// EntityBoneLookAt.ts
//
// Reusable "make this bone look at a moving world point" helper — set up once with WHICH bone to
// override and a reference bone that defines its own rest "forward" direction (e.g. a "Neck"
// bone aimed via its child "Head" bone), then fed a target (or undefined) once per frame.
// Smoothly eases toward the target, or back to the bone's own rest pose when there's nothing to
// look at.
//
// THE BUG THIS FIXES (see NpcEntity.ts's own first attempt, which called
// `neckBone.quaternion.slerp(desired, t)` directly): THREE.AnimationMixer resets EVERY bone
// track it owns — Neck included, even if the current clip barely animates it — back to the
// clip-sampled pose on EVERY `mixer.update()` call, unconditionally, with zero memory of any
// manual change made outside its own tracked properties the previous frame. Slerping the bone's
// OWN quaternion each frame therefore always starts from "freshly reset to the animated pose,"
// never from "wherever this left it last frame" — so the result never actually converges toward
// the target, it just recomputes the exact same tiny partial-slerp-from-rest offset every single
// frame (reads as the rotation being stuck/reset, not smoothly animating).
//
// The fix: keep the smoothed rotation as THIS CLASS's own persistent state (`currentLocalQuaternion`
// below) — slerp THAT toward the desired rotation every call (immune to whatever the mixer does,
// since it's never read back off the bone), then simply COPY it onto the bone. As long as
// update() is called from a lateUpdate() — i.e. strictly AFTER the owning CharacterBody's
// AnimatorController/AnimationMixer has already run its own update() this same frame (see
// Entity.lateUpdate()'s own doc) — that copy wins for rendering, and correctly becomes next
// frame's slerp baseline since it's tracked here rather than read off the bone.
//
// Bind-pose-agnostic, but NOT position-difference-based (an earlier version of this file used
// "direction from `bone` toward a child bone's position," e.g. Neck -> Head — WRONG: that's
// mostly the bone-chain's own "up the spine" axis, not the direction the face actually points,
// so aiming it at a target pitched the whole head down to point its TOP at the target instead of
// its face). The correct reference is an actual ORIENTATION, not a position difference: pass
// `aimObject` (an Object3D whose rest-pose world rotation is meaningful — typically the same
// "Head" bone, or the head cube mesh itself) plus `aimLocalForward`, the specific local axis of
// `aimObject` that really points where its "face" looks. For this project's own head cubes, that
// axis is a KNOWN, self-imposed convention — see CubeBuilder.buildFaceDecal(), which places the
// face decal at `position.z = size/2 + ...` with zero rotation, i.e. the decal (and therefore the
// whole head, since the cube/holder add no extra rotation of their own) always faces local +Z —
// so callers aiming a Neck bone via its Head bone should pass `new THREE.Vector3(0, 0, 1)`.
// Captured once, at construction, as a WORLD-space direction (`aimLocalForward` transformed by
// `aimObject`'s rest-pose world rotation) — this sidesteps ever needing to know NECK's own
// bind-pose axis convention (which varies per rig/exporter and can't be verified without
// visually testing the actual asset): whatever rotation is needed to carry that captured
// rest-world direction to the desired one is exactly the rotation this class applies to `bone`.
//
// `horizontalOnly` (default true — a "look at" almost always means "turn toward," not "tilt up/
// down at") flattens BOTH the rest-forward direction and the per-frame desired direction onto the
// world XZ plane (Y zeroed, renormalized) before computing the rotation between them — since both
// vectors then live in the same horizontal plane, the resulting rotation is a pure YAW around the
// world Y axis, same as a 2D top-down rotation, with zero pitch/roll however far above or below
// `bone`'s own height the target sits. Pass false for a bone whose look genuinely needs to tilt
// (e.g. a turret elevating, not a head turning).

import * as THREE from 'three';

/** Zeroes Y and renormalizes — the "same plane" projection horizontalOnly relies on. Returns undefined (rather than a NaN'd vector) if the result is degenerate (the input was purely vertical). */
function flattenHorizontal(v: THREE.Vector3): THREE.Vector3 | undefined {
    const flat = new THREE.Vector3(v.x, 0, v.z);
    return flat.lengthSq() > 1e-8 ? flat.normalize() : undefined;
}

export default class EntityBoneLookAt {
    private readonly bone: THREE.Object3D;
    private readonly restLocalQuaternion: THREE.Quaternion;
    private readonly restForwardWorld: THREE.Vector3;
    private readonly smoothingRate: number;
    private readonly horizontalOnly: boolean;

    /**
     * This class's OWN persistent smoothed rotation — NEVER read back from `bone.quaternion`
     * (see this file's own doc for why that's the whole bug). Starts at the bone's rest pose.
     */
    private readonly currentLocalQuaternion: THREE.Quaternion;

    private readonly scratchParentWorldQuat = new THREE.Quaternion();
    private readonly scratchBoneWorldPos = new THREE.Vector3();
    private readonly scratchDeltaWorld = new THREE.Quaternion();

    /**
     * `bone` is whichever Object3D should have its rotation overridden (e.g. a "Neck" bone).
     * `aimObject` is whatever object's rest-pose world ORIENTATION defines "forward" for `bone`
     * (typically its own "Head" child bone) and `aimLocalForward` is which of `aimObject`'s OWN
     * local axes actually points that way (see this file's own top doc — e.g. (0,0,1) for this
     * project's own head cubes). Captured ONCE, so both objects must already be in their final
     * rest-pose world transform (mesh loaded, container in its final position/scale) when this
     * is constructed.
     */
    public constructor(bone: THREE.Object3D, aimObject: THREE.Object3D, aimLocalForward: THREE.Vector3, smoothingRate = 8, horizontalOnly = true) {
        this.bone = bone;
        this.smoothingRate = smoothingRate;
        this.horizontalOnly = horizontalOnly;

        aimObject.updateWorldMatrix(true, false);
        const aimWorldQuat = new THREE.Quaternion();
        aimObject.getWorldQuaternion(aimWorldQuat);

        this.restLocalQuaternion = bone.quaternion.clone();
        const restForwardWorld = aimLocalForward.clone().applyQuaternion(aimWorldQuat).normalize();
        this.restForwardWorld = (horizontalOnly ? flattenHorizontal(restForwardWorld) : undefined) ?? restForwardWorld;
        this.currentLocalQuaternion = bone.quaternion.clone();
    }

    /**
     * Call once per frame, from a lateUpdate() — strictly AFTER this bone's owning
     * AnimationMixer.update() has already run this frame (see this file's own top doc for why
     * order matters). `targetWorldPos` undefined eases back toward the bone's own rest pose.
     */
    public update(targetWorldPos: THREE.Vector3 | undefined, delta: number): void {
        const parent = this.bone.parent;
        if (!parent) {
            return;
        }

        let desiredLocalQuat: THREE.Quaternion;
        if (targetWorldPos) {
            parent.updateWorldMatrix(true, false);
            parent.getWorldQuaternion(this.scratchParentWorldQuat);

            this.bone.getWorldPosition(this.scratchBoneWorldPos);
            const rawDesiredForwardWorld = targetWorldPos.clone().sub(this.scratchBoneWorldPos).normalize();
            const desiredForwardWorld = (this.horizontalOnly ? flattenHorizontal(rawDesiredForwardWorld) : undefined) ?? rawDesiredForwardWorld;

            // deltaWorld: the world-space rotation that takes the rest-pose aim direction to the
            // desired one. restWorldQuat: the neck's rest pose, expressed in world space, to
            // apply deltaWorld on top of. newWorldQuat: deltaWorld * restWorldQuat — the rest
            // orientation additionally rotated by deltaWorld, in world space.
            this.scratchDeltaWorld.setFromUnitVectors(this.restForwardWorld, desiredForwardWorld);
            const restWorldQuat = this.scratchParentWorldQuat.clone().multiply(this.restLocalQuaternion);
            const newWorldQuat = this.scratchDeltaWorld.multiply(restWorldQuat);
            // Bones rotate in PARENT-local space, same as any Object3D — convert back down.
            desiredLocalQuat = this.scratchParentWorldQuat.clone().invert().multiply(newWorldQuat);
        } else {
            desiredLocalQuat = this.restLocalQuaternion;
        }

        const t = 1 - Math.exp(-this.smoothingRate * delta);
        this.currentLocalQuaternion.slerp(desiredLocalQuat, t);
        this.bone.quaternion.copy(this.currentLocalQuaternion);
    }
}
