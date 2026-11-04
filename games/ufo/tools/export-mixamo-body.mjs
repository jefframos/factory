// export-mixamo-body.mjs — node games/ufo/tools/export-mixamo-body.mjs
//
// The characters Fun kit's body as Mixamo's auto-rigger wants it: a plain mesh with no skeleton, in a true T-pose (arms
// straight out along X, legs straight down), as an OBJ with its material and texture, in games/ufo/mixamo/. It poses the
// kit's own skeleton and bakes the skinning, so proportions stay exactly the kit's. Zip the three files to upload them.

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import * as THREE from 'three';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { kitSkeleton, poseTPose } from './kit-skeleton.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const KIT = path.resolve(HERE, '../../../library3d/files/characters-Fun');
const OUT = path.resolve(HERE, '../mixamo');
const NAME = 'Body_TPose';

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const document = await io.read(path.join(KIT, 'Body_010.glb'));
const root = document.getRoot();
const skin = root.listSkins()[0];
const joints = skin.listJoints();
const primitives = root.listNodes().find((node) => node.getMesh()).getMesh().listPrimitives();

const skeleton = kitSkeleton(document);
poseTPose(skeleton);

// Skinning baked at that pose.
const inverseBind = skin.getInverseBindMatrices();
const skinMatrices = joints.map((joint, i) => {
    const bind = new THREE.Matrix4().fromArray(inverseBind.getElement(i, []));
    return new THREE.Matrix4().multiplyMatrices(skeleton.objects.get(joint).matrixWorld, bind);
});
const lines = [`mtllib ${NAME}.mtl`, `o ${NAME}`];
const faces = [];
let offset = 0;
for (const primitive of primitives) {
    const position = primitive.getAttribute('POSITION');
    const normal = primitive.getAttribute('NORMAL');
    const uv = primitive.getAttribute('TEXCOORD_0');
    const jointIndex = primitive.getAttribute('JOINTS_0');
    const weight = primitive.getAttribute('WEIGHTS_0');
    const blended = new THREE.Matrix4();
    const normalMatrix = new THREE.Matrix3();
    for (let i = 0; i < position.getCount(); i++) {
        const ji = jointIndex.getElement(i, []);
        const wi = weight.getElement(i, []);
        const elements = new Array(16).fill(0);
        wi.forEach((w, k) => skinMatrices[ji[k]].elements.forEach((value, n) => { elements[n] += value * w; }));
        blended.fromArray(elements);
        const p = new THREE.Vector3().fromArray(position.getElement(i, [])).applyMatrix4(blended);
        const n = new THREE.Vector3().fromArray(normal.getElement(i, [])).applyMatrix3(normalMatrix.getNormalMatrix(blended)).normalize();
        const [u, v] = uv.getElement(i, []);
        lines.push(`v ${p.x.toFixed(5)} ${p.y.toFixed(5)} ${p.z.toFixed(5)}`, `vn ${n.x.toFixed(4)} ${n.y.toFixed(4)} ${n.z.toFixed(4)}`, `vt ${u.toFixed(5)} ${(1 - v).toFixed(5)}`);
    }
    const indices = primitive.getIndices();
    for (let i = 0; i + 2 < indices.getCount(); i += 3) {
        const [a, b, c] = [0, 1, 2].map((k) => offset + indices.getScalar(i + k) + 1);
        faces.push(`f ${a}/${a}/${a} ${b}/${b}/${b} ${c}/${c}/${c}`);
    }
    offset += position.getCount();
}

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, `${NAME}.obj`), [...lines, 'usemtl Color', ...faces, ''].join('\n'));
fs.writeFileSync(path.join(OUT, `${NAME}.mtl`), 'newmtl Color\nKd 1 1 1\nmap_Kd Textures_4.png\n');
fs.copyFileSync(path.join(KIT, 'Textures_4.png'), path.join(OUT, 'Textures_4.png'));
console.log(`${NAME}: ${offset} vertices, ${faces.length} triangles`);
