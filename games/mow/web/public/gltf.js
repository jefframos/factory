// gltf.js
//
// The editor's GLTFLoaders, made in one place so they read what the model build publishes: GLBs may be
// meshopt-compressed (tools/models/shrink-textures.mjs; the game's own loaders: core/three/GLTFLoaders.ts).

import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

/** A GLTFLoader that can decode meshopt-compressed models. */
export function createGLTFLoader() {
    return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
}
