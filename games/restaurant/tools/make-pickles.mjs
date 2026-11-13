// make-pickles.mjs — node games/restaurant/tools/make-pickles.mjs, then npm run models.
//
// KayKit's Restaurant Bits has no pickles, so these two are made here, in its style (low poly, flat colours, no texture):
//   food_ingredient_pickle_slices — a few overlapping slices, as wide as its tomato slice (a burger topping, a pile);
//   food_ingredient_pickle        — a whole pickle (the market's crate, the shopping list's picture).
// Written as .gltf + .bin into raw-assets/models/kitchen{m}/, beside the kit's own.

import { Document, NodeIO } from '@gltf-transform/core';
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, '../raw-assets/models/kitchen{m}');

/** Colours (sRGB): the skin, the cut face, its seedy middle. */
const SKIN = '#4f7d24';
const FLESH = '#b5cf62';
const SEEDS = '#e3e6a6';

const linear = (hex) => new THREE.Color(hex).toArray(); // three's Color parses sRGB hex into linear, as glTF wants.

/** Writes `parts` ({ geometry, color }[]) as one mesh, a primitive per colour. */
async function write(name, parts) {
    const document = new Document();
    const buffer = document.createBuffer();
    const scene = document.createScene();
    const mesh = document.createMesh(name);
    for (const { geometry, color } of parts) {
        const g = geometry.index ? geometry.toNonIndexed() : geometry;
        g.computeVertexNormals();
        const material = document.createMaterial(color).setBaseColorFactor([...linear(color), 1]).setRoughnessFactor(0.8).setMetallicFactor(0);
        const accessor = (type, array) => document.createAccessor().setType(type).setArray(array).setBuffer(buffer);
        mesh.addPrimitive(document.createPrimitive()
            .setMaterial(material)
            .setAttribute('POSITION', accessor('VEC3', new Float32Array(g.getAttribute('position').array)))
            .setAttribute('NORMAL', accessor('VEC3', new Float32Array(g.getAttribute('normal').array))));
    }
    scene.addChild(document.createNode(name).setMesh(mesh));
    buffer.setURI(`${name}.bin`);
    await new NodeIO().write(path.join(OUT, `${name}.gltf`), document);
    console.log(`${name}.gltf`);
}

/** A slice at (x, z), tilted a little: its green rim, its cut face, the seeds' ring on it. */
function slice(x, z, tiltX, tiltZ, y) {
    const radius = 0.15;
    const thick = 0.045;
    const place = (g) => g.rotateX(tiltX).rotateZ(tiltZ).translate(x, y, z);
    const rim = place(new THREE.CylinderGeometry(radius, radius, thick, 10, 1, true));
    const face = place(new THREE.CylinderGeometry(radius * 0.9, radius * 0.9, thick * 1.02, 10, 1, false));
    const seeds = place(new THREE.CylinderGeometry(radius * 0.45, radius * 0.45, thick * 1.08, 8, 1, false));
    return { rim, face, seeds };
}

const merge = (geometries) => {
    const flat = geometries.map((g) => g.toNonIndexed());
    const count = flat.reduce((n, g) => n + g.getAttribute('position').count, 0);
    const positions = new Float32Array(count * 3);
    let at = 0;
    for (const g of flat) {
        positions.set(g.getAttribute('position').array, at);
        at += g.getAttribute('position').array.length;
    }
    const merged = new THREE.BufferGeometry();
    merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return merged;
};

// Slices: five, overlapping, about as wide as the kit's tomato slice (0.65), its bottom at y 0.
const layout = [[-0.16, -0.1, 0.05, -0.04, 0.025], [0.15, -0.12, -0.04, 0.05, 0.03], [0.0, 0.14, 0.03, 0.03, 0.035], [-0.12, 0.13, -0.06, 0.02, 0.05], [0.13, 0.1, 0.06, -0.05, 0.055]];
const slices = layout.map(([x, z, tx, tz, y]) => slice(x, z, tx, tz, y));
await write('food_ingredient_pickle_slices', [
    { geometry: merge(slices.map((s) => s.rim)), color: SKIN },
    { geometry: merge(slices.map((s) => s.face)), color: FLESH },
    { geometry: merge(slices.map((s) => s.seeds)), color: SEEDS },
]);

// A whole pickle: a lumpy capsule lying along x, a little bent, its bottom at y 0.
const body = new THREE.CapsuleGeometry(0.13, 0.42, 4, 10);
body.rotateZ(Math.PI / 2);
const p = body.getAttribute('position');
for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    // Bumps round it, a gentle bend along it.
    const bump = 1 + 0.07 * Math.sin(x * 38) * Math.cos(Math.atan2(z, y) * 5);
    p.setXYZ(i, x, y * bump + 0.18 * x * x, z * bump);
}
body.translate(0, 0.13, 0);
await write('food_ingredient_pickle', [{ geometry: mergeVertices(body), color: SKIN }]);
