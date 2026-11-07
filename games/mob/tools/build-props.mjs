// build-props.mjs — node games/mob/tools/build-props.mjs
//
// The game pieces' models, into public/mob/models/props/ (each a GLB with its texture inside, meshopt-compressed):
// - buildings (library3d KayKit City Builder Bits, medieval, FBX): the blue home (giant house), the blue barracks (truck
//   garage), the yellow home (the gold saucer house), the red barracks (the enemy's main base) and the red tower (a
//   smaller fort). All the meshes merged into one, centred on X/Z with its base at y 0, in the file's own units (the
//   game scales each to the footprint it stands on).
// - the space truck (KayKit Space Base Bits, glTF): its orange panels moved to the palette's blue (the texture is a grid
//   of colour swatches, so a UV shift recolours a part).
// - the saucer (games/ufo's, built by its build-saucer.mjs) with the gold-and-black skin.
// - the car (library3d City2 Car_23): its textures cut to 256 px.
// - the viking hat (an attack barrier's: library3d's stylized hats pack, its Viking_Hat_0 alone): its texture cut to
//   256 px. The crowd puts it on the mobs' heads (CrowdView), at the helmet's place.
// - the desert theme's plants (library3d 3D Desert Plants Pack) into public/mob/models/desert/: their textures cut to
//   128 px, their meshes simplified hard (props at the field's edge) and their metal map dropped (megabytes each otherwise).

import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { meshopt, prune, simplify, weld } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../..');
const OUT = path.join(REPO, 'public/mob/models/props');
const CITY = path.join(REPO, 'library3d/files/KayKit_City_Builder_Bits_1.0_FREE/Assets/medi/buildings');
const SPACE = path.join(REPO, 'library3d/files/KayKit_Bits_Bundle1_1.1/Space Base Bits/Assets/gltf');
const SAUCER = path.join(REPO, 'games/ufo/raw-assets/models/saucer{m}/saucer.glb');
const SAUCER_SKIN = path.join(REPO, 'games/ufo/raw-assets/non-preload/saucer/saucer-gold-black.png');

const BUILDINGS = [
    { out: 'home-blue', file: 'blue/building_home_A_blue.fbx' },
    { out: 'barracks-blue', file: 'blue/building_barracks_blue.fbx' },
    { out: 'home-yellow', file: 'yellow/building_home_B_yellow.fbx' },
    { out: 'barracks-red', file: 'red/building_barracks_red.fbx' },
    { out: 'tower-red', file: 'red/building_tower_A_red.fbx' },
];

await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

/** Writes a model meshopt-compressed (the game's GLTFLoader has the decoder: core/three/GLTFLoaders.ts), a fraction of the size. */
async function write(file, document) {
    await document.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
    await io.write(file, document);
}
// FBXLoader tries to load the FBX's textures, which needs a DOM: an empty texture will do (the atlas goes in below).
THREE.TextureLoader.prototype.load = () => new THREE.Texture();

function parseFbx(file) {
    const bytes = fs.readFileSync(file);
    const warn = console.warn;
    console.warn = () => {}; // FBXLoader warns about everything it doesn't read (textures it can't load in Node).
    const object = new FBXLoader().parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
    console.warn = warn;
    object.updateMatrixWorld(true);
    return object;
}

async function buildBuilding({ out, file }) {
    const source = path.join(CITY, file);
    const fbx = parseFbx(source);
    const positions = [];
    const normals = [];
    const uvs = [];
    const p = new THREE.Vector3();
    const n = new THREE.Vector3();
    const normalMatrix = new THREE.Matrix3();
    fbx.traverse((mesh) => {
        if (!mesh.isMesh) return;
        const { geometry } = mesh;
        const position = geometry.getAttribute('position');
        const normal = geometry.getAttribute('normal');
        const uv = geometry.getAttribute('uv');
        normalMatrix.getNormalMatrix(mesh.matrixWorld);
        const count = geometry.index ? geometry.index.count : position.count;
        for (let i = 0; i < count; i++) {
            const v = geometry.index ? geometry.index.getX(i) : i;
            p.fromBufferAttribute(position, v).applyMatrix4(mesh.matrixWorld);
            n.fromBufferAttribute(normal, v).applyMatrix3(normalMatrix).normalize();
            positions.push(p.x, p.y, p.z);
            normals.push(n.x, n.y, n.z);
            uvs.push(uv ? uv.getX(v) : 0, uv ? 1 - uv.getY(v) : 0);
        }
    });
    // Centred on X/Z, base at 0.
    const box = new THREE.Box3();
    for (let i = 0; i < positions.length; i += 3) box.expandByPoint(p.set(positions[i], positions[i + 1], positions[i + 2]));
    const centre = box.getCenter(new THREE.Vector3());
    for (let i = 0; i < positions.length; i += 3) {
        positions[i] -= centre.x;
        positions[i + 1] -= box.min.y;
        positions[i + 2] -= centre.z;
    }
    const document = new Document();
    const buffer = document.createBuffer();
    const accessor = (type, array) => document.createAccessor().setType(type).setArray(array).setBuffer(buffer);
    const image = await sharp(path.join(path.dirname(source), 'hexagons_medieval.png')).resize(512, 512, { fit: 'inside' }).png().toBuffer();
    const texture = document.createTexture('atlas').setImage(image).setMimeType('image/png');
    const material = document.createMaterial(out).setBaseColorTexture(texture).setRoughnessFactor(0.85).setMetallicFactor(0);
    const mesh = document.createMesh(out).addPrimitive(document.createPrimitive()
        .setMaterial(material)
        .setAttribute('POSITION', accessor('VEC3', Float32Array.from(positions)))
        .setAttribute('NORMAL', accessor('VEC3', Float32Array.from(normals)))
        .setAttribute('TEXCOORD_0', accessor('VEC2', Float32Array.from(uvs))));
    document.createScene(out).addChild(document.createNode(out).setMesh(mesh));
    await document.transform(weld(), prune());
    await write(path.join(OUT, `${out}.glb`), document);
    const size = box.getSize(new THREE.Vector3());
    console.log(`${out}: ${positions.length / 9} triangles, size ${size.toArray().map((c) => c.toFixed(2)).join(' x ')}`);
}

/** The space truck, its orange swatches moved to the blue one (the atlas is 8 x 4 swatches). */
async function buildTruck() {
    const document = await io.read(path.join(SPACE, 'spacetruck.gltf'));
    const CELLS = { cols: 8, rows: 4 };
    // [col, row] of the orange / red / brown swatches -> the blue one (col 1, row 1) or the light blue (col 0, row 1).
    // The white and light grey body panels too (the dark ones — tyres, trim — stay).
    const remap = new Map([['7,0', [1, 1]], ['7,1', [1, 1]], ['6,2', [1, 1]], ['6,0', [0, 1]], ['3,1', [0, 1]], ['1,3', [0, 1]], ['4,1', [1, 1]], ['7,2', [0, 1]], ['1,0', [1, 1]], ['2,0', [2, 1]], ['5,0', [0, 1]], ['4,2', [1, 1]], ['5,2', [0, 1]]]);
    let moved = 0;
    for (const mesh of document.getRoot().listMeshes()) {
        for (const primitive of mesh.listPrimitives()) {
            const uv = primitive.getAttribute('TEXCOORD_0');
            if (!uv) continue;
            const array = uv.getArray().slice();
            for (let i = 0; i < array.length; i += 2) {
                const col = Math.min(CELLS.cols - 1, Math.floor(array[i] * CELLS.cols));
                const row = Math.min(CELLS.rows - 1, Math.floor(array[i + 1] * CELLS.rows));
                const to = remap.get(`${col},${row}`);
                if (!to) continue;
                array[i] += (to[0] - col) / CELLS.cols;
                array[i + 1] += (to[1] - row) / CELLS.rows;
                moved++;
            }
            uv.setArray(array);
        }
    }
    await document.transform(prune());
    await write(path.join(OUT, 'truck.glb'), document);
    console.log(`truck: ${moved} UVs moved to blue`);
}

/** The UFO game's saucer with its gold skin (the glass a light cyan). */
async function buildSaucer() {
    const document = await io.read(SAUCER);
    const image = await sharp(SAUCER_SKIN).resize(512, 512, { fit: 'inside' }).png().toBuffer();
    const texture = document.createTexture('gold').setImage(image).setMimeType('image/png');
    for (const material of document.getRoot().listMaterials()) {
        if (/glass/i.test(material.getName())) {
            material.setBaseColorFactor([0.6, 0.95, 1, 0.75]).setAlphaMode('BLEND').setRoughnessFactor(0.15).setMetallicFactor(0);
        } else {
            material.setBaseColorTexture(texture).setBaseColorFactor([1, 1, 1, 1]).setRoughnessFactor(0.4).setMetallicFactor(0.5);
        }
    }
    await write(path.join(OUT, 'saucer.glb'), document);
    console.log(`saucer: materials ${document.getRoot().listMaterials().map((m) => m.getName()).join(', ')}`);
}

const DESERT = path.join(REPO, 'library3d/files/3D_desert_plants_pack_lowpoly/3D_Desert_Plants_Pack_LowPoly/models');
const DESERT_OUT = path.join(REPO, 'public/mob/models/desert');
const DESERT_PLANTS = ['01_saguaro_cactus', '02_golden_barrel_cactus', '03_prickly_pear_cactus', '04_organ_pipe_cactus', '05_joshua_tree', '06_century_plant_agave', '08_ocotillo', '12_date_palm', '15_creosote_bush', '21_dead_desert_snag', '39_saguaro_skeleton'];

async function buildCar() {
    const document = await io.read(path.join(REPO, 'library3d/files/City2/Car_23.glb'));
    for (const texture of document.getRoot().listTextures()) {
        const image = texture.getImage();
        if (image) texture.setImage(await sharp(Buffer.from(image)).resize(256, 256, { fit: 'inside' }).png().toBuffer()).setMimeType('image/png');
    }
    await document.transform(prune());
    await write(path.join(OUT, 'car.glb'), document);
    console.log(`car: ${Math.round(fs.statSync(path.join(OUT, 'car.glb')).size / 1024)} KB`);
}

async function buildViking() {
    const document = await io.read(path.join(REPO, 'library3d/files/hats/3d_props_stylized_hats_pack.glb'));
    // The pack's 18 hats, one per node: all but the viking's go (their meshes and textures with them, by prune).
    for (const node of document.getRoot().listNodes()) {
        if (/(_Hat_\d+|^Crown_\d+)$/.test(node.getName()) && node.getName() !== 'Viking_Hat_0') node.dispose();
    }
    await document.transform(prune());
    for (const texture of document.getRoot().listTextures()) {
        const image = texture.getImage();
        if (image) texture.setImage(await sharp(Buffer.from(image)).resize(256, 256, { fit: 'inside' }).png().toBuffer()).setMimeType('image/png');
    }
    await write(path.join(OUT, 'viking.glb'), document);
    console.log(`viking: ${Math.round(fs.statSync(path.join(OUT, 'viking.glb')).size / 1024)} KB`);
}

async function buildDesert() {
    fs.mkdirSync(DESERT_OUT, { recursive: true });
    for (const file of DESERT_PLANTS) {
        const document = await io.read(path.join(DESERT, `${file}.glb`));
        for (const material of document.getRoot().listMaterials()) {
            material.setMetallicRoughnessTexture(null).setMetallicFactor(0).setRoughnessFactor(0.9);
        }
        for (const texture of document.getRoot().listTextures()) {
            const image = texture.getImage();
            if (!image) continue;
            texture.setImage(await sharp(Buffer.from(image)).resize(128, 128, { fit: 'inside' }).png().toBuffer()).setMimeType('image/png');
        }
        // Their meshes carry many unused vertices: weld + simplify compacts them (and halves the triangles).
        await document.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio: 0.15, error: 0.04 }), prune());
        const name = file.replace(/^[0-9]+_/, '').replace(/_/g, '-');
        await write(path.join(DESERT_OUT, `${name}.glb`), document);
        console.log(`desert/${name}: ${Math.round(fs.statSync(path.join(DESERT_OUT, `${name}.glb`)).size / 1024)} KB`);
    }
}

fs.mkdirSync(OUT, { recursive: true });
for (const building of BUILDINGS) await buildBuilding(building);
await buildTruck();
await buildSaucer();
await buildCar();
await buildViking();
if (!process.argv.includes('--no-desert')) await buildDesert();
