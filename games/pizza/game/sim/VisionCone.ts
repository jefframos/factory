import * as THREE from "three";

// An entity can only actually reach/notice a target if the target sits
// roughly in front of it — PlayerEntity.eatPosition is a point offset ahead
// of an entity along whatever direction it's currently facing, so
// `eatPosition - position` is its facing direction. Dotting that against the
// direction to a candidate tells us whether the candidate sits inside its
// forward bite arc. Shared by BotController's threat perception (fleeing/
// sniping decisions) and EntityEating's actual kill resolution, so both
// "can this bot see me" and "can this head actually bite me" agree.
export const FACING_CONE_HALF_ANGLE = Math.PI / 3; // 60° each side = 120° total forward arc

export function isFacingTarget(observerPos: THREE.Vector3, observerEatPos: THREE.Vector3, targetPos: THREE.Vector3): boolean {
    const facing = observerEatPos.clone().sub(observerPos);
    if (facing.lengthSq() < 1e-6) return true; // no discernible facing — assume worst case
    facing.normalize();

    const toTarget = targetPos.clone().sub(observerPos);
    if (toTarget.lengthSq() < 1e-6) return true; // exactly overlapping

    toTarget.normalize();
    return facing.dot(toTarget) >= Math.cos(FACING_CONE_HALF_ANGLE);
}
