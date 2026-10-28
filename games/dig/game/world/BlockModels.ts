// BlockModels.ts
//
// Loads the mine's models (KayKit Block Bits / Resource Bits, see ui/dig.json and
// scripts/dig-import-models.mjs) and prepares them for VoxelTerrain's merged chunk meshes:
//  - every block model normalised to one cell (1 x blockHeight x 1, standing on y=0, centred), as raw
//    arrays, both whole and top-faces-only (a buried block only ever shows its top);
//  - "decor" pieces (nuggets and gems on ore tops, buried finds) the same way, each with its material;
//  - pickup models, ready to clone.
// All blocks share one texture (and so one material); decor comes from several packs (Resource Bits,
// Block Bits, Halloween Bits), so each decor model keeps its own.

import * as THREE from 'three';
import ModelLoaderManager from 'core/three/ModelLoaderManager';
import { BendService } from '../services/BendService';

const MODEL_BASE = './dig/models/';

/** Raw geometry ready to be copied (offset) into a merged chunk mesh. */
export interface MeshData {
    positions: Float32Array;
    normals: Float32Array;
    uvs: Float32Array;
    indices: Uint32Array;
}

export interface BlockModel {
    full: MeshData;
    top: MeshData;
}

export interface DecorModel {
    data: MeshData;
    material: THREE.MeshStandardMaterial;
}

/** First mesh's world-space geometry (non-shared copy) and material. */
function extract(object: THREE.Object3D): { geometry: THREE.BufferGeometry; material: THREE.Material } {
    object.updateMatrixWorld(true);
    let found: { geometry: THREE.BufferGeometry; material: THREE.Material } | undefined;
    object.traverse((child) => {
        if (!found && child instanceof THREE.Mesh) {
            const geometry = (child.geometry as THREE.BufferGeometry).clone();
            geometry.applyMatrix4(child.matrixWorld);
            found = { geometry, material: Array.isArray(child.material) ? child.material[0] : child.material };
        }
    });
    if (!found) throw new Error('BlockModels: model has no mesh');
    return found;
}

function toData(geometry: THREE.BufferGeometry, keepTriangle?: (normalY: number) => boolean): MeshData {
    const indexed = geometry.index ? geometry : geometry.setIndex([...Array(geometry.getAttribute('position').count).keys()]);
    const position = indexed.getAttribute('position');
    const normal = indexed.getAttribute('normal');
    const uv = indexed.getAttribute('uv');
    const source = indexed.index!.array;
    const indices: number[] = [];
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    for (let i = 0; i < source.length; i += 3) {
        if (keepTriangle) {
            a.fromBufferAttribute(position, source[i]);
            b.fromBufferAttribute(position, source[i + 1]);
            c.fromBufferAttribute(position, source[i + 2]);
            const faceNormal = b.sub(a).cross(c.sub(a)).normalize();
            if (!keepTriangle(faceNormal.y)) continue;
        }
        indices.push(source[i], source[i + 1], source[i + 2]);
    }
    // Read through the attribute getters: glTF attributes are often interleaved, so `.array` would be
    // the whole shared buffer rather than this attribute's values.
    const positions = new Float32Array(position.count * 3);
    const normals = new Float32Array(position.count * 3);
    const uvs = new Float32Array(position.count * 2);
    for (let i = 0; i < position.count; i++) {
        positions.set([position.getX(i), position.getY(i), position.getZ(i)], i * 3);
        normals.set([normal.getX(i), normal.getY(i), normal.getZ(i)], i * 3);
        if (uv) uvs.set([uv.getX(i), uv.getY(i)], i * 2);
    }
    return { positions, normals, uvs, indices: new Uint32Array(indices) };
}

/**
 * A plain 12-triangle box (1 x height x 1, standing on y=0) in `model`'s colours. KayKit blocks are
 * ~1,100 bevelled triangles each, textured from a palette atlas (each face is many thin strips, each
 * pointing at a swatch), so each box face takes one UV: the swatch covering the most area among the
 * model's triangles facing that way. Same colours at a hundredth of the cost; ore specks come back as
 * decor (ui/dig.json).
 */
function texturedBox(model: THREE.BufferGeometry, height: number): THREE.BufferGeometry {
    const box = new THREE.BoxGeometry(1, height, 1);
    box.translate(0, height / 2, 0);
    const indexed = model.index ? model : model.setIndex([...Array(model.getAttribute('position').count).keys()]);
    const position = indexed.getAttribute('position');
    const uv = indexed.getAttribute('uv');
    const index = indexed.index!.array;
    // Face directions in BoxGeometry order (+x, -x, +y, -y, +z, -z).
    const directions = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].map(([x, y, z]) => new THREE.Vector3(x, y, z));
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const cross = new THREE.Vector3();
    const boxUv = box.getAttribute('uv') as THREE.BufferAttribute;
    directions.forEach((direction, faceIndex) => {
        const areaByUv = new Map<string, { area: number; u: number; v: number }>();
        for (let i = 0; i < index.length; i += 3) {
            a.fromBufferAttribute(position, index[i]);
            b.fromBufferAttribute(position, index[i + 1]);
            c.fromBufferAttribute(position, index[i + 2]);
            cross.subVectors(b, a).cross(c.sub(a));
            const area = cross.length();
            if (area < 1e-9 || cross.dot(direction) / area < 0.95) continue;
            // The triangle's swatch: its UV centroid, rounded so neighbouring strips of one swatch pool.
            let u = 0;
            let v = 0;
            for (let k = 0; k < 3; k++) {
                u += uv.getX(index[i + k]) / 3;
                v += uv.getY(index[i + k]) / 3;
            }
            const key = `${Math.round(u * 200)},${Math.round(v * 200)}`;
            const entry = areaByUv.get(key) ?? { area: 0, u, v };
            entry.area += area;
            areaByUv.set(key, entry);
        }
        let best: { area: number; u: number; v: number } | undefined;
        for (const entry of areaByUv.values()) {
            if (!best || entry.area > best.area) best = entry;
        }
        if (!best) return;
        for (let k = 0; k < 4; k++) {
            boxUv.setXY(faceIndex * 4 + k, best.u, best.v);
        }
    });
    boxUv.needsUpdate = true;
    return box;
}

/** Scales/moves geometry so its bounds become `size` (x, y, z), standing on y=0, centred on x/z. */
function fit(geometry: THREE.BufferGeometry, size: THREE.Vector3): void {
    geometry.computeBoundingBox();
    const box = geometry.boundingBox!;
    const current = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    geometry.translate(-center.x, -box.min.y, -center.z);
    geometry.scale(size.x / current.x, size.y / current.y, size.z / current.z);
}

/** A material for merged meshes: the model's own texture, per-vertex brightness, world bend. */
function prepareMaterial(source: THREE.Material): THREE.MeshStandardMaterial {
    const original = source as THREE.MeshStandardMaterial;
    const material = new THREE.MeshStandardMaterial({ map: original.map ?? null, roughness: 0.85, metalness: 0, vertexColors: true });
    BendService.applyBend(material);
    return material;
}

export class BlockModels {
    public readonly blocks = new Map<string, BlockModel>();
    public readonly decors = new Map<string, DecorModel>();
    public readonly pickups = new Map<string, THREE.Object3D>();
    public blockMaterial?: THREE.MeshStandardMaterial;

    private async load(path: string): Promise<THREE.Object3D> {
        return ModelLoaderManager.instance.loadModel(`${MODEL_BASE}${path}`);
    }

    public async loadBlock(path: string, height: number): Promise<void> {
        if (this.blocks.has(path)) return;
        const { geometry, material } = extract(await this.load(path));
        fit(geometry, new THREE.Vector3(1, height, 1));
        this.blockMaterial ??= prepareMaterial(material);
        const box = texturedBox(geometry, height);
        this.blocks.set(path, { full: toData(box), top: toData(box, (normalY) => normalY > 0.6) });
    }

    /** Decor pieces stand upright and are about `size` tall. */
    public async loadDecor(path: string, size: number): Promise<void> {
        if (this.decors.has(path)) return;
        const { geometry, material } = extract(await this.load(path));
        geometry.computeBoundingBox();
        const now = geometry.boundingBox!.getSize(new THREE.Vector3());
        const scale = size / Math.max(now.x, now.y, now.z);
        fit(geometry, now.multiplyScalar(scale));
        this.decors.set(path, { data: toData(geometry), material: prepareMaterial(material) });
    }

    /** Pickups are about `size` across. */
    public async loadPickup(path: string, size: number): Promise<void> {
        if (this.pickups.has(path)) return;
        const object = await this.load(path);
        object.traverse((child) => {
            if (child instanceof THREE.Mesh) {
                child.material = (child.material as THREE.Material).clone();
                BendService.applyBend(child.material as THREE.Material);
            }
        });
        object.updateMatrixWorld(true);
        const bounds = new THREE.Box3().setFromObject(object);
        const extent = bounds.getSize(new THREE.Vector3());
        const center = bounds.getCenter(new THREE.Vector3());
        const holder = new THREE.Group();
        object.position.sub(center);
        holder.add(object);
        holder.scale.setScalar(size / Math.max(extent.x, extent.y, extent.z, 1e-4));
        this.pickups.set(path, holder);
    }
}
