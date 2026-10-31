// fbx-mesh-to-glb.mjs
//
// Re-packs a character/prop FBX (one with a mesh) as a GLB for publishing: three's FBXLoader reads it, and
// GLTFExporter writes the same scene — bone names, hierarchy and skin binding unchanged, so animations keep binding
// by name. Smaller on the way:
// - identical vertices merged (FBX stores one vertex per triangle corner: often a third of the count),
// - attributes the game doesn't use dropped (`dropAttributes`, e.g. 'color' when the game swaps the material),
// - materials and textures kept only if `keepMaterials` (a game that replaces the material doesn't need them).
// The raw FBX is untouched; build-models.mjs publishes the GLB in its place when a game opts in
// (raw-assets/models-optimize.json "fbxToGlb": true).

import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** GLTFExporter reads its own Blobs back through FileReader, which Node doesn't have. */
function ensureFileReader() {
    if (typeof globalThis.FileReader !== 'undefined') return;
    globalThis.FileReader = class {
        readAsArrayBuffer(blob) {
            blob.arrayBuffer().then((buffer) => {
                this.result = buffer;
                this.onloadend?.();
                this.onload?.({ target: this });
            });
        }
        readAsDataURL(blob) {
            blob.arrayBuffer().then((buffer) => {
                this.result = `data:${blob.type || 'application/octet-stream'};base64,${Buffer.from(buffer).toString('base64')}`;
                this.onloadend?.();
                this.onload?.({ target: this });
            });
        }
    };
}

/**
 * The GLB bytes for an FBX holding a mesh, or null when it has none (an animation-only FBX: fbx-anim-to-glb.mjs).
 * Returns { glb, before, after } with vertex counts.
 */
export async function convertFbxMeshToGlb(buffer, { dropAttributes = ['color'], keepMaterials = false } = {}) {
    ensureFileReader();
    const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    // FBXLoader warns about every unsupported property; not useful here.
    const warn = console.warn;
    console.warn = () => {};
    let root;
    try {
        root = new FBXLoader().parse(arrayBuffer, '');
    } finally {
        console.warn = warn;
    }
    const meshes = [];
    root.traverse((child) => {
        if (child.isMesh) meshes.push(child);
    });
    if (!meshes.length) return null;

    let before = 0;
    let after = 0;
    const plain = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0, roughness: 1 });
    for (const mesh of meshes) {
        let geometry = mesh.geometry;
        before += geometry.attributes.position.count;
        for (const name of dropAttributes) geometry.deleteAttribute(name);
        // FBX groups (multi-material) survive merging; the index is rebuilt over the welded vertices.
        geometry = mergeVertices(geometry, 1e-5);
        after += geometry.attributes.position.count;
        mesh.geometry = geometry;
        if (!keepMaterials) {
            const count = Array.isArray(mesh.material) ? mesh.material.length : 1;
            mesh.material = count > 1 ? new Array(count).fill(plain) : plain;
        }
    }
    // FBXLoader leaves its import bookkeeping in userData (transform data per node), which GLTFExporter would write
    // as JSON extras on every node: most of the file.
    root.traverse((child) => {
        child.userData = {};
    });
    // Skinned meshes need their skeletons' bones in the exported scene: export the whole root.
    const exporter = new GLTFExporter();
    const glb = await exporter.parseAsync(root, { binary: true, onlyVisible: false, animations: root.animations ?? [] });
    return { glb: Buffer.from(glb), before, after };
}
