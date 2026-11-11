// build-characters.mjs — node games/mob/tools/build-characters.mjs (build-props.mjs runs it too)
//
// The card units' character models (library3d/packs-characters: the packs from Unity, glTF ones here), into
// public/mob/models/characters/, each a GLB with its texture inside, meshopt-compressed:
// - each character (CHARACTERS) simplified (a crowd draws many: about a third of the triangles), its texture cut to
//   128 px (the KayKit packs' textures are a palette of flat swatches: the game samples it into the vertices'
//   colours), its own animations dropped (none, but in case);
// - each rig's animations (RIGS: the clips the game plays, the rest dropped; the mesh dropped), shared by every character
//   on that rig. The game (CharacterView) loads a character only when a battle can spawn it.

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { meshopt, prune, simplify, weld } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../..');
const PACKS = path.join(REPO, 'library3d/packs-characters');
const OUT = path.join(REPO, 'public/mob/models/characters');

/** id: the game's name for it (CharacterView's LOOKS); `ratio`: the share of triangles kept. */
export const CHARACTERS = [
    { id: 'skeleton-minion', file: 'pack2/characters/gltf/Skeleton_Minion.glb', ratio: 0.32 },
    { id: 'skeleton-warrior', file: 'pack2/characters/gltf/Skeleton_Warrior.glb', ratio: 0.4 },
];
/** The rigs' animations: the clips kept. */
const RIGS = [
    { id: 'rig-medium', file: 'pack2/Animations/gltf/Rig_Medium/Rig_Medium_MovementBasic.glb', clips: ['Running_A', 'Walking_A'] },
];

export async function buildCharacters() {
    if (!fs.existsSync(PACKS)) {
        console.log('characters: library3d/packs-characters missing, skipped');
        return false;
    }
    await MeshoptEncoder.ready;
    await MeshoptSimplifier.ready;
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
    fs.mkdirSync(OUT, { recursive: true });
    for (const { id, file, ratio } of CHARACTERS) {
        const document = await io.read(path.join(PACKS, file));
        const root = document.getRoot();
        for (const animation of root.listAnimations()) animation.dispose();
        for (const texture of root.listTextures()) {
            const image = texture.getImage();
            if (!image) continue;
            texture.setImage(await sharp(Buffer.from(image)).resize(128, 128, { fit: 'inside' }).png().toBuffer()).setMimeType('image/png');
        }
        await document.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.06 }), prune());
        await document.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
        await io.write(path.join(OUT, `${id}.glb`), document);
        console.log(`characters: ${id}`);
    }
    // The Unity FBX ones: baked into their poses here (bake-characters.mjs).
    const { bakeCharacters } = await import('./bake-characters.mjs');
    await bakeCharacters(PACKS, OUT);
    for (const { id, file, clips } of RIGS) {
        const document = await io.read(path.join(PACKS, file));
        const root = document.getRoot();
        for (const animation of root.listAnimations()) if (!clips.includes(animation.getName())) animation.dispose();
        // Just the bones and the clips: no mesh to draw.
        for (const node of root.listNodes()) {
            node.setMesh(null);
            node.setSkin(null);
        }
        await document.transform(prune());
        await document.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
        await io.write(path.join(OUT, `${id}.glb`), document);
        console.log(`characters: ${id} (${clips.join(', ')})`);
    }
    return true;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await buildCharacters();
