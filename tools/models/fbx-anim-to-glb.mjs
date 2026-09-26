import { Document, NodeIO } from '@gltf-transform/core';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

const io = new NodeIO();

const TRACK_PATHS = { quaternion: 'rotation', position: 'translation', scale: 'scale' };

/**
 * Parses an FBX file. Returns its animation clips, or null if the file
 * contains any mesh (i.e. it's a character/prop model, not an animation-only
 * file) so the caller keeps it as a plain FBX.
 */
function parseAnimationOnlyFbx(buffer) {
    const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    const object = new FBXLoader().parse(arrayBuffer, '');

    let hasMesh = false;
    object.traverse((child) => { if (child.isMesh) hasMesh = true; });
    if (hasMesh || object.animations.length === 0) return null;
    return object.animations;
}

/**
 * Mixamo-style animation FBX files carry only a few KB of real keyframe data,
 * wrapped in hundreds of KB of FBX node/property overhead. This re-packs the
 * same THREE.AnimationClips (as FBXLoader produces them, pre-rotations
 * already baked in) into a GLB holding one node per animated bone and nothing
 * else. GLTFLoader names the resulting tracks after those nodes, so the clips
 * bind to the FBX character's bones exactly as before.
 *
 * Returns the GLB bytes, or null if `buffer` isn't an animation-only FBX.
 */
export async function convertFbxAnimationToGlb(buffer) {
    const clips = parseAnimationOnlyFbx(buffer);
    if (!clips) return null;

    const doc = new Document();
    const gltfBuffer = doc.createBuffer();
    const scene = doc.createScene();
    const nodes = new Map();
    const getNode = (name) => {
        if (!nodes.has(name)) {
            const node = doc.createNode(name);
            scene.addChild(node);
            nodes.set(name, node);
        }
        return nodes.get(name);
    };

    for (const clip of clips) {
        const animation = doc.createAnimation(clip.name);
        // Most tracks in a clip share the same key times — one accessor each.
        const timeAccessors = new Map();

        for (const track of clip.tracks) {
            const dot = track.name.lastIndexOf('.');
            const nodeName = track.name.slice(0, dot);
            const targetPath = TRACK_PATHS[track.name.slice(dot + 1)];
            if (!targetPath) continue;

            // Drops keys that are identical to both neighbours (constant spans).
            track.optimize();

            const timesKey = Array.from(track.times).join(',');
            let input = timeAccessors.get(timesKey);
            if (!input) {
                input = doc.createAccessor()
                    .setType('SCALAR')
                    .setArray(new Float32Array(track.times))
                    .setBuffer(gltfBuffer);
                timeAccessors.set(timesKey, input);
            }

            const output = doc.createAccessor()
                .setType(targetPath === 'rotation' ? 'VEC4' : 'VEC3')
                .setArray(new Float32Array(track.values))
                .setBuffer(gltfBuffer);

            const sampler = doc.createAnimationSampler()
                .setInput(input)
                .setOutput(output)
                .setInterpolation('LINEAR');
            const channel = doc.createAnimationChannel()
                .setTargetNode(getNode(nodeName))
                .setTargetPath(targetPath)
                .setSampler(sampler);
            animation.addSampler(sampler).addChannel(channel);
        }
    }

    return io.writeBinary(doc);
}
