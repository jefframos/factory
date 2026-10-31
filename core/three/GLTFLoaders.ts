// GLTFLoaders.ts
//
// Every GLTFLoader the games make comes from here, so they all read what the model build publishes: GLBs may be
// meshopt-compressed (EXT_meshopt_compression, opt-in per game in raw-assets/models-optimize.json — see
// tools/models/shrink-textures.mjs). The decoder is three's own (a small WebAssembly module, set up once).

import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

/** A GLTFLoader that can decode meshopt-compressed models. */
export function createGLTFLoader(): GLTFLoader {
    return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
}
