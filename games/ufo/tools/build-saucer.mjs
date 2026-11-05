// build-saucer.mjs — node games/ufo/tools/build-saucer.mjs, then npm run models and npm run image.
//
// The UFO from Unity (games/ufo/mixamo/ufo: Meshes/UFO.fbx, Textures/*) for the game:
//
// - raw-assets/models/saucer{m}/saucer.glb: simplified, in two parts: `saucer` (the ship: a Body and a Glass primitive) and
//   `guns` (the side and bottom guns, so a style can leave them off). It's sized so its disc's radius is 1 and the guns'
//   lowest point at y 0, facing +Z, so the game scales it by the saucer's radius and hangs it from there. No textures in
//   it: any skin can go on it.
// - raw-assets/non-preload/saucer/: the textures, small and in the form three.js wants. Every BaseColor*.png in the source
//   folder becomes a skin (saucer.skins in ui/ufo.json lists the ones in the game), and they share the other maps.
//   Unity's mask is metallic (R), occlusion (G) and smoothness (A); three reads occlusion (R), roughness (G), metalness (B).
//
// (The model pipeline caps every image in the models folder at 256px, too little for something this big on screen, so
// the textures go through the images pipeline instead.)

import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, simplify, weld } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = path.resolve(HERE, '../mixamo/ufo');
const MODEL_OUT = path.resolve(HERE, '../raw-assets/models/saucer{m}');
const TEXTURE_OUT = path.resolve(HERE, '../raw-assets/non-preload/saucer');

/** The mesh sized to this: the ship's disc (without the side guns, which stick out past it). */
const DISC_MESH = 'Ship';
/** How much of the triangles stay (the bottom gun alone is 14,830 of them), and the most the shape may change. */
const SIMPLIFY = { ratio: 0.4, error: 0.002 };
const TEXTURE_SIZE = { base: 1024, normal: 1024, emissive: 512, orm: 512 };
/** How many times bigger the guns are than in the source, to change the ship's shape. */
const GUN_SCALE = 2.2;
/**
 * Skins recoloured from one of the source's: its green hull, its grey panels and its red details each become a colour,
 * keeping their light and dark. `shade` is the brightness in the source that comes out as the colour itself.
 */
const RECOLOURED = [
    { name: 'saucer-blue', from: 'BaseColor1.png', hull: [0.05, 0.42, 1], panels: [0.55, 0.85, 1], details: [1, 1, 1], shade: 0.43 },
    { name: 'saucer-classic', from: 'BaseColor1.png', hull: [0.1, 1, 0.3], panels: [0.9, 0.95, 1], details: [1, 0.3, 0.3], shade: 0.43 },
    { name: 'saucer-steel', from: 'BaseColor1.png', hull: [0.55, 0.72, 1], panels: [1, 0.75, 0.1], details: [1, 0.3, 0.3], shade: 0.43 },
    { name: 'saucer-rust', from: 'BaseColor1.png', hull: [1, 0.42, 0.08], panels: [1, 0.9, 0.6], details: [0.2, 0.9, 1], shade: 0.43 },
    { name: 'saucer-purple-yellow', from: 'BaseColor1.png', hull: [0.62, 0.25, 1], panels: [1, 0.82, 0.1], details: [1, 0.5, 0.8], shade: 0.43 },
    { name: 'saucer-crimson-gold', from: 'BaseColor1.png', hull: [1, 0.16, 0.2], panels: [1, 0.82, 0.12], details: [1, 1, 0.85], shade: 0.43 },
    { name: 'saucer-ocean-coral', from: 'BaseColor1.png', hull: [0.08, 0.52, 1], panels: [1, 0.6, 0.42], details: [1, 1, 0.85], shade: 0.43 },
    { name: 'saucer-teal-cream', from: 'BaseColor1.png', hull: [0.05, 0.85, 0.8], panels: [1, 0.96, 0.8], details: [1, 0.4, 0.3], shade: 0.43 },
    { name: 'saucer-pink-mint', from: 'BaseColor1.png', hull: [1, 0.35, 0.68], panels: [0.55, 1, 0.85], details: [1, 1, 1], shade: 0.43 },
    { name: 'saucer-orange-navy', from: 'BaseColor1.png', hull: [1, 0.55, 0.05], panels: [0.18, 0.3, 0.85], details: [1, 1, 0.85], shade: 0.43 },
    { name: 'saucer-lime-purple', from: 'BaseColor1.png', hull: [0.55, 1, 0.12], panels: [0.6, 0.25, 1], details: [1, 1, 0.5], shade: 0.43 },
    { name: 'saucer-black-neon', from: 'BaseColor1.png', hull: [0.16, 0.16, 0.26], panels: [0.2, 1, 0.65], details: [1, 0.3, 0.8], shade: 0.43 },
    { name: 'saucer-white-blue', from: 'BaseColor1.png', hull: [0.97, 0.98, 1], panels: [0.15, 0.5, 1], details: [1, 0.3, 0.3], shade: 0.43 },
    { name: 'saucer-gold-black', from: 'BaseColor1.png', hull: [1, 0.8, 0.12], panels: [0.2, 0.18, 0.3], details: [1, 1, 1], shade: 0.43 },
    { name: 'saucer-violet-pink', from: 'BaseColor1.png', hull: [0.5, 0.25, 1], panels: [1, 0.5, 0.8], details: [0.6, 1, 1], shade: 0.43 },
    { name: 'saucer-sky-sun', from: 'BaseColor1.png', hull: [0.35, 0.8, 1], panels: [1, 0.86, 0.15], details: [1, 1, 1], shade: 0.43 },
    { name: 'saucer-forest-sand', from: 'BaseColor1.png', hull: [0.1, 0.85, 0.4], panels: [1, 0.85, 0.5], details: [1, 0.45, 0.2], shade: 0.43 },
    { name: 'saucer-rose-grey', from: 'BaseColor1.png', hull: [1, 0.25, 0.5], panels: [0.85, 0.9, 1], details: [1, 0.9, 0.5], shade: 0.43 },
    { name: 'saucer-magma', from: 'BaseColor1.png', hull: [0.3, 0.1, 0.14], panels: [1, 0.45, 0.05], details: [1, 0.9, 0.2], shade: 0.43 },
    { name: 'saucer-ice', from: 'BaseColor1.png', hull: [0.7, 0.95, 1], panels: [1, 1, 1], details: [0.15, 0.55, 1], shade: 0.43 },
    { name: 'saucer-candy', from: 'BaseColor1.png', hull: [1, 0.65, 0.85], panels: [0.6, 0.9, 1], details: [1, 0.97, 0.5], shade: 0.43 },
];

function loadFbx() {
    const bytes = fs.readFileSync(path.join(SOURCE, 'Meshes/UFO.fbx'));
    const warn = console.warn;
    console.warn = () => {}; // FBXLoader warns about everything it doesn't read.
    const object = new FBXLoader().parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
    console.warn = warn;
    object.updateMatrixWorld(true);
    return object;
}

async function buildModel() {
    const fbx = loadFbx();
    const ship = fbx.getObjectByName(DISC_MESH);
    if (!ship) throw new Error(`No mesh ${DISC_MESH}`);
    // The file's root turn (a -90° on X from its exporter) comes off: in the ship's own axes Y is up and +Z its front.
    const undoTurn = new THREE.Matrix4().makeRotationFromQuaternion(ship.getWorldQuaternion(new THREE.Quaternion())).invert();

    /** By part (`saucer`, `guns`), then by material. */
    const parts = { saucer: new Map(), guns: new Map() };
    const pileFor = (part, name) => {
        if (!parts[part].has(name)) parts[part].set(name, { positions: [], normals: [], uvs: [], indices: [] });
        return parts[part].get(name);
    };
    const matrix = new THREE.Matrix4();
    const normalMatrix = new THREE.Matrix3();
    const p = new THREE.Vector3();
    const n = new THREE.Vector3();
    const low = new THREE.Vector3(Infinity, Infinity, Infinity);
    const high = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
    let discRadius = 0;
    // A gun and its holder grow together, from where they meet the ship: a side set from its inner end, the one underneath
    // from its top. So each set stays on the ship and in one piece.
    const gunSet = (name) => name.replace(/Gun.*$/i, '');
    const gunBounds = new Map();
    fbx.traverse((mesh) => {
        if (!mesh.isMesh || !/gun/i.test(mesh.name)) return;
        const position = mesh.geometry.getAttribute('position');
        matrix.multiplyMatrices(undoTurn, mesh.matrixWorld);
        const bounds = gunBounds.get(gunSet(mesh.name)) ?? new THREE.Box3();
        for (let v = 0; v < position.count; v++) bounds.expandByPoint(p.fromBufferAttribute(position, v).applyMatrix4(matrix));
        gunBounds.set(gunSet(mesh.name), bounds);
    });
    const gunAnchors = new Map([...gunBounds].map(([name, bounds]) => {
        const anchor = bounds.getCenter(new THREE.Vector3());
        if (Math.abs(anchor.x) > bounds.getSize(n).x) anchor.x = anchor.x > 0 ? bounds.min.x : bounds.max.x;
        else anchor.y = bounds.max.y;
        console.log(`${name} guns: grown from ${anchor.toArray().map((c) => c.toFixed(1))}, size ${bounds.getSize(n).toArray().map((c) => c.toFixed(1))}`);
        return [name, anchor];
    }));
    fbx.traverse((mesh) => {
        if (!mesh.isMesh) return;
        const { geometry } = mesh;
        const position = geometry.getAttribute('position');
        const normal = geometry.getAttribute('normal');
        const uv = geometry.getAttribute('uv');
        matrix.multiplyMatrices(undoTurn, mesh.matrixWorld);
        normalMatrix.getNormalMatrix(matrix);
        const materials = [mesh.material].flat();
        const part = /gun/i.test(mesh.name) ? 'guns' : 'saucer';
        const anchor = part === 'guns' ? gunAnchors.get(gunSet(mesh.name)) : null;
        const groups = geometry.groups.length ? geometry.groups : [{ start: 0, count: position.count, materialIndex: 0 }];
        for (const group of groups) {
            const pile = pileFor(part, materials[group.materialIndex ?? 0].name);
            for (let i = group.start; i < group.start + group.count; i++) {
                const v = geometry.index ? geometry.index.getX(i) : i;
                p.fromBufferAttribute(position, v).applyMatrix4(matrix);
                n.fromBufferAttribute(normal, v).applyMatrix3(normalMatrix).normalize();
                pile.indices.push(pile.positions.length / 3);
                // The ship's size and height stay as they were (`low`, `high` below): the guns just reach further.
                low.min(p);
                high.max(p);
                if (mesh === ship) discRadius = Math.max(discRadius, Math.hypot(p.x, p.z));
                if (anchor) p.sub(anchor).multiplyScalar(GUN_SCALE).add(anchor);
                pile.positions.push(p.x, p.y, p.z);
                pile.normals.push(n.x, n.y, n.z);
                // glTF's V runs down the image.
                pile.uvs.push(uv.getX(v), 1 - uv.getY(v));
            }
        }
    });

    // Disc radius 1, centred, lowest point at 0.
    const scale = 1 / discRadius;
    const document = new Document();
    const buffer = document.createBuffer();
    const accessor = (type, array) => document.createAccessor().setType(type).setArray(array).setBuffer(buffer);
    // One material of a name, shared by the parts: a skin goes on the ship and its guns together.
    const materials = new Map();
    const materialFor = (name) => {
        if (!materials.has(name)) materials.set(name, document.createMaterial(name));
        return materials.get(name);
    };
    const scene = document.createScene('saucer');
    const meshes = [];
    for (const [part, piles] of Object.entries(parts)) {
        const mesh = document.createMesh(part);
        for (const [name, pile] of piles) {
            const positions = Float32Array.from(pile.positions);
            for (let i = 0; i < positions.length; i += 3) {
                positions[i] *= scale;
                positions[i + 1] = (positions[i + 1] - low.y) * scale;
                positions[i + 2] *= scale;
            }
            mesh.addPrimitive(document.createPrimitive()
                .setMaterial(materialFor(name))
                .setIndices(accessor('SCALAR', new Uint32Array(pile.indices)))
                .setAttribute('POSITION', accessor('VEC3', positions))
                .setAttribute('NORMAL', accessor('VEC3', new Float32Array(pile.normals)))
                .setAttribute('TEXCOORD_0', accessor('VEC2', new Float32Array(pile.uvs))));
        }
        scene.addChild(document.createNode(part).setMesh(mesh));
        meshes.push(mesh);
    }
    const triangles = (of) => of.listPrimitives().reduce((sum, primitive) => sum + primitive.getIndices().getCount() / 3, 0);
    const before = meshes.map(triangles);
    // (Its UVs stay though nothing uses them yet: the game puts the textures on.)
    await document.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ...SIMPLIFY }), prune({ keepAttributes: true }));
    fs.mkdirSync(MODEL_OUT, { recursive: true });
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
    await io.write(path.join(MODEL_OUT, 'saucer.glb'), document);
    meshes.forEach((mesh, i) => console.log(`${mesh.getName()}: ${before[i]} -> ${triangles(mesh)} triangles`));
    console.log(`disc radius ${discRadius.toFixed(2)}; in the game its top is ${((high.y - low.y) * scale).toFixed(3)} radii up, wide ${(Math.max(high.x, -low.x) * scale).toFixed(3)}`);
}

/** A skin's pixels from its source's, by each pixel's hue and how grey it is. */
async function recolour(dir, { name, from, hull, panels, details, shade }) {
    const size = TEXTURE_SIZE.base;
    const { data } = await sharp(path.join(dir, from)).resize(size, size, { kernel: 'lanczos3' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const out = Buffer.alloc(size * size * 3);
    for (let i = 0; i < size * size; i++) {
        const [r, g, b] = [data[i * 3] / 255, data[i * 3 + 1] / 255, data[i * 3 + 2] / 255];
        const max = Math.max(r, g, b);
        const range = max - Math.min(r, g, b);
        const saturation = max > 0 ? range / max : 0;
        let hue = 0;
        if (range > 0) {
            if (max === r) hue = ((g - b) / range + 6) % 6;
            else if (max === g) hue = (b - r) / range + 2;
            else hue = (r - g) / range + 4;
        }
        hue *= 60;
        const colour = saturation < 0.1 ? panels : hue > 50 && hue < 190 ? hull : saturation > 0.3 ? details : panels;
        const light = Math.min(1.5, max / shade);
        for (let c = 0; c < 3; c++) out[i * 3 + c] = Math.min(255, Math.round(colour[c] * light * 255));
    }
    return { image: sharp(out, { raw: { width: size, height: size, channels: 3 } }), name };
}

async function buildTextures() {
    const dir = path.join(SOURCE, 'Textures');
    fs.mkdirSync(TEXTURE_OUT, { recursive: true });
    const small = (file, size) => sharp(path.join(dir, file)).resize(size, size, { kernel: 'lanczos3' });
    const write = async (image, name) => {
        const target = path.join(TEXTURE_OUT, `${name}.png`);
        await image.png({ compressionLevel: 9 }).toFile(target);
        console.log(`${name}.png: ${(fs.statSync(target).size / 1024) | 0} KB`);
    };
    for (const file of fs.readdirSync(dir).filter((name) => /^BaseColor.*\.png$/i.test(name))) {
        await write(small(file, TEXTURE_SIZE.base).removeAlpha(), `saucer-${file.replace(/\.png$/i, '').toLowerCase()}`);
    }
    for (const skin of RECOLOURED) {
        const { image, name } = await recolour(dir, skin);
        await write(image, name);
    }
    await write(small('Normal_OpenGL.png', TEXTURE_SIZE.normal).removeAlpha(), 'saucer-normal');
    await write(small('Emissive.png', TEXTURE_SIZE.emissive).removeAlpha(), 'saucer-emissive');

    const size = TEXTURE_SIZE.orm;
    const mask = await small('Mask.png', size).ensureAlpha().raw().toBuffer();
    const occlusion = await small('AO.png', size).toColourspace('b-w').raw().toBuffer({ resolveWithObject: true });
    const out = Buffer.alloc(size * size * 3);
    for (let i = 0; i < size * size; i++) {
        out[i * 3] = occlusion.data[i * occlusion.info.channels];
        out[i * 3 + 1] = 255 - mask[i * 4 + 3];
        out[i * 3 + 2] = mask[i * 4];
    }
    await write(sharp(out, { raw: { width: size, height: size, channels: 3 } }), 'saucer-orm');
}

await MeshoptSimplifier.ready;
await buildModel();
await buildTextures();
