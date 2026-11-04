// kit-skeleton.mjs
//
// The characters Fun kit's skeleton as three.js objects, and the T-pose both the Mixamo upload (export-mixamo-body.mjs)
// and the animations' conversion (build-people.mjs) start from: the mesh Mixamo rigged was in this pose, so Mixamo's
// T-pose and this one are the same pose.

import * as THREE from 'three';

const RIGHT = new THREE.Vector3(1, 0, 0);
const LEFT = new THREE.Vector3(-1, 0, 0);
const DOWN = new THREE.Vector3(0, -1, 0);
/** Bone, the child it points at, and which way it should point. Parents come first. Left is +X in this model. */
const STRAIGHTEN = [
    ['LeftArm', 'LeftForeArm', RIGHT], ['LeftForeArm', 'LeftHand', RIGHT], ['LeftHand', 'LeftHandMiddle1', RIGHT],
    ['RightArm', 'RightForeArm', LEFT], ['RightForeArm', 'RightHand', LEFT], ['RightHand', 'RightHandMiddle1', LEFT],
    ['LeftUpLeg', 'LeftLeg', DOWN], ['LeftLeg', 'LeftFoot', DOWN],
    ['RightUpLeg', 'RightLeg', DOWN], ['RightLeg', 'RightFoot', DOWN],
];

/** A glTF document's skeleton: `top` (over its root), `objects` (glTF node to object), `byName`. In its bind pose. */
export function kitSkeleton(document) {
    const root = document.getRoot();
    const objects = new Map();
    for (const node of root.listNodes()) {
        if (node.getMesh()) continue;
        const object = new THREE.Object3D();
        object.name = node.getName();
        object.position.fromArray(node.getTranslation());
        object.quaternion.fromArray(node.getRotation());
        object.scale.fromArray(node.getScale());
        objects.set(node, object);
    }
    const top = new THREE.Object3D();
    for (const [node, object] of objects) {
        const parent = node.listParents().find((candidate) => objects.has(candidate));
        (parent ? objects.get(parent) : top).add(object);
    }
    top.updateMatrixWorld(true);
    const byName = (name) => {
        const found = top.getObjectByName(name);
        if (!found) throw new Error(`No bone ${name}`);
        return found;
    };
    return { top, objects, byName };
}

/** Puts a skeleton in the T-pose. */
export function poseTPose({ top, byName }) {
    for (const [boneName, childName, direction] of STRAIGHTEN) {
        const bone = byName(boneName);
        const at = bone.getWorldPosition(new THREE.Vector3());
        const now = byName(childName).getWorldPosition(new THREE.Vector3()).sub(at).normalize();
        const world = new THREE.Quaternion().setFromUnitVectors(now, direction).multiply(bone.getWorldQuaternion(new THREE.Quaternion()));
        bone.quaternion.copy(bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(world));
        top.updateMatrixWorld(true);
    }
}
