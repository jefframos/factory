// TractorDress.ts
//
// Puts skins (TractorSkins) on the ridden mowers' tractor. A paint is a tile over the body: the model has no texture of
// its own, so its body gets texture coordinates here (wrapBody(): laid on from the side, the top or the front, whichever
// way a face looks, in the tractor's frame at its base height), and the tile is its map. A part is its pieces as one mesh
// (two with some that glow), placed in that same frame.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import ModelLoaderManager from 'core/three/ModelLoaderManager';
import { buildPiece, freePiece } from 'core/pieces/Pieces';
import { MOW, ToolDef, toolPaint } from '../data/MowConfig';
import { TractorLook, TractorPaint, TractorPart, tractorPaint, tractorPart } from '../data/TractorSkins';
import { isBodyMaterial } from '../utils/Paint';

const TILE_BASE = './mow/images/non-preload/tractor/';
/** Pieces glowing this much are drawn in their own colour, unlit. */
const GLOWS_FROM = 0.3;
const GREY = 0x8c8c8c;

const loader = new THREE.TextureLoader();
const tiles = new Map<string, Promise<THREE.Texture | undefined>>();

/** A paint's tile, ready to be a body's map (undefined if it can't load). */
export function paintTile(paint: TractorPaint): Promise<THREE.Texture | undefined> {
    let tile = tiles.get(paint.id);
    if (!tile) {
        tile = loader.loadAsync(`${TILE_BASE}${paint.id}.webp`).then((texture) => {
            texture.colorSpace = THREE.SRGBColorSpace;
            texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
            texture.repeat.setScalar(1 / paint.scale);
            texture.anisotropy = 4;
            return texture;
        }).catch(() => {
            // Tried again the next time it's asked for.
            tiles.delete(paint.id);
            return undefined;
        });
        tiles.set(paint.id, tile);
    }
    return tile;
}

/**
 * Texture coordinates for a tractor's body (its own geometry from here on). `model` must be in the tractor's frame: fitted
 * to the base height, its wheels on the ground, not in anything else.
 */
export function wrapBody(model: THREE.Object3D): void {
    model.updateMatrixWorld(true);
    const at = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    const normal = new THREE.Vector3();
    const edge = new THREE.Vector3();
    model.traverse((child) => {
        if (!(child instanceof THREE.Mesh) || ![child.material].flat().some(isBodyMaterial)) return;
        const geometry = child.geometry.index ? child.geometry.toNonIndexed() : child.geometry.clone();
        const position = geometry.getAttribute('position');
        const uv = new Float32Array(position.count * 2);
        for (let i = 0; i + 2 < position.count; i += 3) {
            at.forEach((point, k) => point.fromBufferAttribute(position, i + k).applyMatrix4(child.matrixWorld));
            normal.subVectors(at[1], at[0]).cross(edge.subVectors(at[2], at[0]));
            const x = Math.abs(normal.x);
            const y = Math.abs(normal.y);
            const z = Math.abs(normal.z);
            at.forEach((point, k) => {
                // Sides and top alike: along the tractor is across the tile, so a pattern runs over the edges.
                const u = z > x && z > y ? point.x : point.z;
                const v = y >= x && y >= z ? point.x : point.y;
                uv.set([u, v], (i + k) * 2);
            });
        }
        geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
        geometry.userData.own = true;
        child.geometry = geometry;
    });
}

/** A part as one object, in the tractor's frame; `prepare` gets each of its materials (the world's bend). */
export async function buildPart(part: TractorPart, prepare: (material: THREE.Material) => void = () => undefined): Promise<THREE.Group> {
    const solid: THREE.BufferGeometry[] = [];
    const glowing: THREE.BufferGeometry[] = [];
    for (const piece of part.pieces) {
        const mesh = await buildPiece(piece, () => Promise.reject(new Error('a tractor part has no models')));
        if (!(mesh instanceof THREE.Mesh)) continue;
        mesh.updateMatrix();
        const geometry = (mesh.geometry as THREE.BufferGeometry).clone().applyMatrix4(mesh.matrix);
        geometry.deleteAttribute('uv');
        const color = new THREE.Color(piece.color ?? '#ffffff');
        const colors = new Float32Array(geometry.getAttribute('position').count * 3);
        for (let i = 0; i < colors.length; i += 3) color.toArray(colors, i);
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        ((piece.glow ?? 0) >= GLOWS_FROM ? glowing : solid).push(geometry);
        freePiece(mesh, piece);
    }
    const group = new THREE.Group();
    const add = (list: THREE.BufferGeometry[], material: THREE.Material) => {
        const merged = list.length ? mergeGeometries(list) : null;
        list.forEach((geometry) => geometry.dispose());
        if (!merged) return;
        merged.userData.own = true;
        prepare(material);
        group.add(new THREE.Mesh(merged, material));
    };
    add(solid, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 }));
    add(glowing, new THREE.MeshBasicMaterial({ vertexColors: true }));
    return group;
}

/** Frees what buildPart() made. */
export function freePart(part: THREE.Object3D): void {
    part.removeFromParent();
    part.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return;
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
    });
}

/** Frees the geometry a dressedTractor() has to itself (the model's other parts are shared). */
export function freeDressed(tractor: THREE.Object3D): void {
    tractor.traverse((child) => {
        if (child instanceof THREE.Mesh && child.geometry.userData.own) child.geometry.dispose();
    });
}

/** Puts a tractor model at its base height, its wheels on the ground (the frame parts and tiles are in). */
export function fitTractor(model: THREE.Object3D): void {
    const config = MOW.tractor;
    const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
    if (size.y > 1e-4) model.scale.multiplyScalar(config.height / size.y);
    model.rotation.y = config.rotationY;
    model.updateMatrixWorld(true);
    model.position.y = -new THREE.Box3().setFromObject(model).min.y;
    model.updateMatrixWorld(true);
}

/**
 * A tractor of its own in `tool`'s colour wearing `look`, its nose toward +z: for a picture, or (`prepare` gets each of its
 * materials, its own then: the world's bend) to stand in the world.
 */
export async function dressedTractor(tool: ToolDef, look: TractorLook, prepare?: (material: THREE.Material) => void): Promise<THREE.Object3D> {
    const paint = tractorPaint(look.paints);
    const part = tractorPart(look.parts);
    const [model, tile, extra] = await Promise.all([
        ModelLoaderManager.instance.loadModel(`./mow/models/${MOW.tractor.model}`), paint && paintTile(paint), part && buildPart(part, prepare),
    ]);
    fitTractor(model);
    wrapBody(model);
    const tint = toolPaint(tool);
    model.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return;
        const dressed = [child.material].flat().map((source: THREE.Material) => {
            if (!prepare && !isBodyMaterial(source)) return source;
            const material = source.clone();
            prepare?.(material);
            if (!isBodyMaterial(material)) return material;
            material.map = tile ?? null;
            if (tile) material.color.set(0xffffff);
            else if (tint) material.color.set(tint === 'grey' ? GREY : tint);
            return material;
        });
        child.material = dressed.length === 1 ? dressed[0] : dressed;
    });
    const holder = new THREE.Group();
    holder.add(model);
    if (extra) holder.add(extra);
    return holder;
}
