// TractorDress.ts
//
// Dresses the tractor (TractorSkins). Its model is one palette texture all over: its body (the gold hood and roof) and its
// frame (the blue-grey cab and fenders) are split off into materials of their own (wrapBody()), which take a colour each, or a
// paint: a tile over both, laid on from the side, the top or the front, whichever way a face looks. The model's own bucket is off (the blades are in its place). A part
// is its pieces as one mesh (two with some that glow), placed in the tractor's frame (at its base height).

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import ModelLoaderManager from 'core/three/ModelLoaderManager';
import { buildPiece, freePiece } from 'core/pieces/Pieces';
import { DIG } from '../data/DigConfig';
import { TractorLook, TractorPaint, TractorPart, tractorColor, tractorPaint, tractorPart } from '../data/TractorSkins';
import { BodyRegion, isBodyMaterial, regionOf } from '../utils/Paint';

const TILE_BASE = './dig/images/non-preload/tractor/';
/** Pieces glowing this much are drawn in their own colour, unlit. */
const GLOWS_FROM = 0.3;
/** The model's own bucket. */
const BUCKET = 'shovel';

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

/** A texture's pixels (each texture's read once). */
const pixels = new WeakMap<object, ImageData>();
function pixelsOf(texture: THREE.Texture): ImageData | undefined {
    const image = texture.image as (CanvasImageSource & { width: number; height: number }) | undefined;
    if (!image?.width) return undefined;
    let data = pixels.get(image as object);
    if (!data) {
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext('2d', { willReadFrequently: true })!;
        context.drawImage(image, 0, 0);
        data = context.getImageData(0, 0, canvas.width, canvas.height);
        pixels.set(image as object, data);
    }
    return data;
}

/**
 * Splits a tractor's bodywork off (its meshes get geometry of their own): the body's faces, then the frame's, each in a
 * material without a texture (isBodyMaterial; their shades kept in the vertices, texture coordinates for a paint's tile),
 * then the rest as they were. `model` must be in the tractor's frame: fitted to the base height, its wheels on the ground, not in
 * anything else; and its own materials still on it (cloned after).
 */
export function wrapBody(model: THREE.Object3D): void {
    model.updateMatrixWorld(true);
    const at = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    const normal = new THREE.Vector3();
    const edge = new THREE.Vector3();
    const uv = new THREE.Vector2();
    model.traverse((child) => {
        if (!(child instanceof THREE.Mesh) || Array.isArray(child.material) || isWheel(child)) return;
        const material = child.material as THREE.MeshStandardMaterial;
        const image = material.map && pixelsOf(material.map);
        if (!image) return;
        const map = material.map!;
        if (map.matrixAutoUpdate) map.updateMatrix();
        const source = child.geometry.index ? child.geometry.toNonIndexed() : child.geometry;
        const position = source.getAttribute('position');
        const normals = source.getAttribute('normal');
        const uvs = source.getAttribute('uv');
        const faces: Record<BodyRegion | 'rest', number[]> = { body: [], frame: [], rest: [] };
        const shades: Record<BodyRegion, number[]> = { body: [], frame: [] };
        for (let i = 0; i + 2 < position.count; i += 3) {
            let u = 0;
            let v = 0;
            for (let k = 0; k < 3; k++) {
                uv.fromBufferAttribute(uvs as THREE.BufferAttribute, i + k).applyMatrix3(map.matrix);
                u += uv.x / 3;
                v += uv.y / 3;
            }
            const x = Math.min(image.width - 1, Math.floor((u - Math.floor(u)) * image.width));
            const y = Math.min(image.height - 1, Math.floor((v - Math.floor(v)) * image.height));
            const [r, g, b] = image.data.subarray((y * image.width + x) * 4);
            const region = regionOf(r, g, b);
            faces[region ?? 'rest'].push(i);
            if (region) shades[region].push((r + g + b) / 3);
        }
        const painted = [...faces.body, ...faces.frame];
        if (!painted.length) return;
        // Each face's shade, against its region's.
        const shade = (['body', 'frame'] as BodyRegion[]).flatMap((region) => {
            const mean = shades[region].reduce((sum, own) => sum + own, 0) / Math.max(1, shades[region].length);
            return shades[region].map((own) => Math.pow(own / mean, 1.6));
        });
        const order = [...painted, ...faces.rest];
        const count = order.length * 3;
        const made = { position: new Float32Array(count * 3), normal: new Float32Array(count * 3), uv: new Float32Array(count * 2), color: new Float32Array(count * 3).fill(1) };
        order.forEach((from, n) => {
            at.forEach((point, k) => {
                point.fromBufferAttribute(position, from + k);
                point.toArray(made.position, (n * 3 + k) * 3);
                normal.fromBufferAttribute(normals, from + k).toArray(made.normal, (n * 3 + k) * 3);
            });
            if (n >= painted.length) {
                for (let k = 0; k < 3; k++) uv.fromBufferAttribute(uvs as THREE.BufferAttribute, from + k).toArray(made.uv, (n * 3 + k) * 2);
                return;
            }
            made.color.fill(shade[n], n * 9, n * 9 + 9);
            at.forEach((point) => point.applyMatrix4(child.matrixWorld));
            normal.subVectors(at[1], at[0]).cross(edge.subVectors(at[2], at[0]));
            const x = Math.abs(normal.x);
            const y = Math.abs(normal.y);
            const z = Math.abs(normal.z);
            // Sides and top alike: along the tractor is across the tile, so a pattern runs over the edges.
            at.forEach((point, k) => made.uv.set([z > x && z > y ? point.x : point.z, y >= x && y >= z ? point.x : point.y], (n * 3 + k) * 2));
        });
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(made.position, 3));
        geometry.setAttribute('normal', new THREE.BufferAttribute(made.normal, 3));
        geometry.setAttribute('uv', new THREE.BufferAttribute(made.uv, 2));
        geometry.setAttribute('color', new THREE.BufferAttribute(made.color, 3));
        geometry.addGroup(0, faces.body.length * 3, 0);
        geometry.addGroup(faces.body.length * 3, faces.frame.length * 3, 1);
        geometry.addGroup(painted.length * 3, faces.rest.length * 3, 2);
        geometry.userData.own = true;
        const paintable = (region: BodyRegion) => {
            const made = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 });
            made.userData.region = region;
            return made;
        };
        child.geometry = geometry;
        child.material = [paintable('body'), paintable('frame'), material];
    });
}

/** A bodywork material's colour in a look's plain colours. */
export const regionColor = (material: THREE.Material, look: TractorLook): string => tractorColor(look.colors)[material.userData.region as BodyRegion];

/** One of the model's wheels (they turn; they're never painted). */
export const isWheel = (object: THREE.Object3D): boolean => /wheel/i.test(object.name);

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
    const place = part.at ?? DIG.tractor.partsAt;
    group.position.set(place.x, place.y, place.z);
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

/** Puts a tractor model at its base height, its wheels on the ground (the frame parts and tiles are in), its bucket off. */
export function fitTractor(model: THREE.Object3D): void {
    const config = DIG.tractor;
    const buckets: THREE.Object3D[] = [];
    model.traverse((child) => {
        if (child instanceof THREE.Mesh && child.name === BUCKET) buckets.push(child);
    });
    buckets.forEach((bucket) => bucket.removeFromParent());
    const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
    if (size.y > 1e-4) model.scale.multiplyScalar(config.height / size.y);
    model.rotation.y = config.rotationY;
    model.updateMatrixWorld(true);
    model.position.y = -new THREE.Box3().setFromObject(model).min.y;
    model.updateMatrixWorld(true);
}

/**
 * A tractor of its own wearing `look`, its nose toward +z: for a picture, or (`prepare` gets each of its
 * materials, its own then: the world's bend) to stand in the world.
 */
export async function dressedTractor(look: TractorLook, prepare?: (material: THREE.Material) => void): Promise<THREE.Object3D> {
    const paint = tractorPaint(look.paints);
    const part = tractorPart(look.parts);
    const [model, tile, extra] = await Promise.all([
        ModelLoaderManager.instance.loadModel(`./dig/models/${DIG.tractor.model}`), paint && paintTile(paint), part && buildPart(part, prepare),
    ]);
    fitTractor(model);
    wrapBody(model);
    model.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return;
        const dressed = [child.material].flat().map((source: THREE.Material) => {
            if (!prepare && !isBodyMaterial(source)) return source;
            const material = source.clone();
            prepare?.(material);
            if (!isBodyMaterial(material)) return material;
            material.map = tile ?? null;
            material.color.set(tile ? 0xffffff : regionColor(material, look));
            return material;
        });
        child.material = dressed.length === 1 ? dressed[0] : dressed;
    });
    const holder = new THREE.Group();
    holder.add(model);
    if (extra) holder.add(extra);
    return holder;
}
