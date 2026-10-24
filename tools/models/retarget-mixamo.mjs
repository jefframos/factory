import * as THREE from 'three';

const FPS = 30;

function toRigName(mixamoName) {
    if (!mixamoName.startsWith('mixamorig')) return null;
    return mixamoName.slice(9).replace('Spine2', 'UpperChest').replace('Spine1', 'Chest').replace('ToeBase', 'Toes');
}

const worldQuat = (bone) => bone.getWorldQuaternion(new THREE.Quaternion());

/**
 * Retargets Mixamo clips onto a differently-oriented rig (both in a T-pose at rest):
 * each bone's world-space rotation delta from rest is applied to the rig bone's own
 * rest orientation, then converted back to a local rotation. Rotation tracks only.
 */
export function retargetMixamoClips(mixamoRoot, clips, rigRoot) {
    mixamoRoot.updateMatrixWorld(true);
    rigRoot.updateMatrixWorld(true);

    const mixamoBones = new Map();
    mixamoRoot.traverse((o) => { if (o.isBone) mixamoBones.set(o.name, o); });
    const rigBones = new Map();
    rigRoot.traverse((o) => { if (o.isBone) rigBones.set(o.name, o); });

    const pairs = [];
    for (const [name, bone] of mixamoBones) {
        const rigBone = rigBones.get(toRigName(name) ?? '');
        if (rigBone) pairs.push({ mixamo: bone, rig: rigBone });
    }
    const byRig = new Map(pairs.map((p) => [p.rig, p]));
    for (const pair of pairs) {
        pair.mixamoRest = worldQuat(pair.mixamo);
        pair.rigRest = worldQuat(pair.rig);
        pair.restDeltaInv = pair.mixamoRest.clone().invert();
    }
    // Parents must be solved before children.
    const depth = (o) => { let d = 0; for (let p = o.parent; p; p = p.parent) d++; return d; };
    pairs.sort((a, b) => depth(a.rig) - depth(b.rig));

    return clips.map((clip) => {
        const mixer = new THREE.AnimationMixer(mixamoRoot);
        mixer.clipAction(clip).play();
        const frames = Math.max(1, Math.ceil(clip.duration * FPS));
        const times = [];
        const values = new Map(pairs.map((p) => [p, []]));

        for (let f = 0; f <= frames; f++) {
            const t = Math.min(clip.duration, f / FPS);
            times.push(t);
            mixer.setTime(t);
            mixamoRoot.updateMatrixWorld(true);

            const rigWorld = new Map();
            for (const pair of pairs) {
                const delta = worldQuat(pair.mixamo).multiply(pair.restDeltaInv);
                rigWorld.set(pair, delta.multiply(pair.rigRest));
                const parent = pair.rig.parent;
                const parentPair = parent ? byRig.get(parent) : undefined;
                const parentWorld = parentPair ? rigWorld.get(parentPair) : (parent ? worldQuat(parent) : new THREE.Quaternion());
                const local = parentWorld.clone().invert().multiply(rigWorld.get(pair));
                const list = values.get(pair);
                if (list.length >= 4) {
                    const prev = new THREE.Quaternion().fromArray(list, list.length - 4);
                    if (prev.dot(local) < 0) local.set(-local.x, -local.y, -local.z, -local.w);
                }
                list.push(local.x, local.y, local.z, local.w);
            }
        }
        mixer.stopAllAction();

        const tracks = pairs.map((p) => new THREE.QuaternionKeyframeTrack(`${p.rig.name}.quaternion`, times, values.get(p)));
        return new THREE.AnimationClip(clip.name, clip.duration, tracks);
    });
}
