// make-toppings.mjs — node games/restaurant/tools/make-toppings.mjs, then npm run models.
//
// The few pizza topping pieces no kit has (the whole broccoli, pineapple and fish are Kenney's Food Kit's, from the pizza
// game: models/library/food-kit), made here in KayKit's style (low poly, flat colours, no texture), as make-pickles.mjs
// makes the pickles:
//   food_ingredient_pineapple_chunks — one chunk of pineapple (scattered over a pizza: world/PizzaLook.ts);
//   food_ingredient_ham_cubes        — a cube of ham (scattered over a pizza; the kits have only a whole leg).
// Written as .gltf + .bin into raw-assets/models/kitchen{m}/, beside the kit's own. Each one's bottom at y 0.

import { Document, NodeIO } from '@gltf-transform/core';
import * as THREE from 'three';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, '../raw-assets/models/kitchen{m}');

const linear = (hex) => new THREE.Color(hex).toArray();

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

// A pineapple chunk: a wedge of the ring (yellow flesh, a thin rind on its outer side).
{
    const flesh = new THREE.CylinderGeometry(0.32, 0.32, 0.12, 6, 1, false, 0, Math.PI / 3);
    flesh.translate(-0.12, 0.06, -0.12);
    const rind = new THREE.CylinderGeometry(0.335, 0.335, 0.125, 6, 1, true, 0, Math.PI / 3);
    rind.translate(-0.12, 0.06, -0.12);
    await write('food_ingredient_pineapple_chunks', [
        { geometry: flesh, color: '#ffe26a' },
        { geometry: rind, color: '#d9a636' },
    ]);
}

// A cube of ham: pink, a paler fat stripe across its top.
{
    const meat = new THREE.BoxGeometry(0.2, 0.12, 0.2);
    meat.translate(0, 0.06, 0);
    const fat = new THREE.BoxGeometry(0.205, 0.035, 0.07);
    fat.translate(0, 0.1, 0.03);
    await write('food_ingredient_ham_cubes', [
        { geometry: meat, color: '#e88a8f' },
        { geometry: fat, color: '#f8d6d2' },
    ]);
}
