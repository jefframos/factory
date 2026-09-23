// ResourceDisplayModel.ts
//
// "Show this ResourceType as a small 3D object" — the resource's own
// AssetLibraryRegistry model (the same art LooseResourceNode/ResourceNode use).
// Shared by HarvestPickup (lying on the ground), FlyToStack (flying onto the
// player) and BackpackStackVisual (piled on the player's back), so an item
// looks identical in all three.
//
// Sizing: by default the model is shown at its REAL world size — its native
// glb size times the AssetLibrary entry's own `scale` (the midpoint, for a
// random-range scale, so every copy on the stack matches) — i.e. exactly as
// big as that resource is anywhere else in the world. Pass `maxSize` instead
// to normalize its largest dimension to a fixed size.
//
// `layDownIfTall`: a model noticeably taller than it is wide (height >
// LAY_DOWN_ASPECT x its larger horizontal side — a carrot, an eggplant) is
// rotated 90° onto its side, so it lies on the pile instead of standing up
// out of it; anything squatter (a tomato, a pumpkin) is left as authored.
//
// The returned group's local origin sits at the model's BOTTOM-center (after
// any lay-down rotation), and `size` is its extent in that same frame, in
// world units — so a caller can rest it on a surface and stack the next one
// `size.y` higher. Materials are cloned per instance (see
// GlbVisualComponent.load() for why sharing ModelLoaderManager's cached
// materials is unsafe) and bent (BendService.applyBend) like every other world
// material — release it with disposeResourceDisplayModel(), never by
// disposing geometry (shared with the cache).

import * as THREE from 'three';
import ModelLoaderManager from 'core/three/ModelLoaderManager';
import { BendService } from '../services/BendService';
import { RESOURCE_CONFIG, ResourceType } from '../actions/ResourceTypes';
import { resolveResourceAssetKey } from '../actions/ResourceRegistry';
import { ASSET_LIBRARY, AssetLibraryEntry, NumberRange, pickRandom } from './AssetLibraryRegistry';

/** Same `./` + repo-relative convention every other model load in pizza uses (see GlbVisualComponent.ts's modelUrl()). */
const modelUrl = (fullPath: string): string => `./${fullPath}`;

/** Marks the placeholder box — the only mesh this file builds itself, so the only one whose geometry disposeResourceDisplayModel() may dispose, and whose (fresh, unshared) material needs no clone. */
const OWNED_MESH_FLAG = 'resourceDisplayOwnedMesh';
/** World-unit edge of the placeholder box when a resource has no model yet. */
const PLACEHOLDER_SIZE = 0.3;
/**
 * height / max(width, depth) above which layDownIfTall rotates the model onto its side. Measured
 * against the real crop models: carrot 2.09 and eggplant 1.88 lie down; broccoli 1.13, onion 1.02,
 * tomato 0.84 and pumpkin 0.55 stay upright.
 */
const LAY_DOWN_ASPECT = 1.5;

export interface ResourceDisplayOptions {
    /** Normalize the largest dimension to this (world units) instead of using the real world size. */
    maxSize?: number;
    /** Rotate tall models onto their side — see this file's own doc. */
    layDownIfTall?: boolean;
}

export interface ResourceDisplayModel {
    /** Origin at the bottom-center — see this file's own doc. */
    object: THREE.Group;
    /** Extent in `object`'s own frame (after any lay-down), in the units the model was sized in. */
    size: THREE.Vector3;
}

/** Loads `type`'s display model — see this file's own doc. Falls back to a flat-colored box when the resource has no AssetLibrary model or the load fails; never rejects. */
export async function loadResourceDisplayModel(type: ResourceType, options: ResourceDisplayOptions = {}): Promise<ResourceDisplayModel> {
    const entry: AssetLibraryEntry | undefined = ASSET_LIBRARY[resolveResourceAssetKey(type)];
    const modelDef = entry && entry.models.length > 0 ? pickRandom(entry.models) : undefined;

    let object: THREE.Object3D;
    let worldScale = 1;
    if (modelDef) {
        try {
            object = await ModelLoaderManager.instance.loadModel(modelUrl(modelDef.fullPath), modelDef.id);
            worldScale = rangeMidpoint(entry!.scale);
        } catch (error) {
            console.warn(`ResourceDisplayModel: failed to load a model for "${type}" — using a placeholder box`, error);
            object = buildPlaceholderBox(type);
        }
    } else {
        object = buildPlaceholderBox(type);
    }

    object.traverse(child => {
        if (!(child instanceof THREE.Mesh)) {
            return;
        }
        if (!child.userData[OWNED_MESH_FLAG]) {
            child.material = Array.isArray(child.material)
                ? child.material.map(material => material.clone())
                : child.material.clone();
        }
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        materials.forEach(material => BendService.applyBend(material));
    });

    // Hierarchy: wrapper (returned, untouched by us) -> align (bottom-center offset) -> orient
    // (lay-down rotation) -> scaler (size) -> object. Each measurement below is taken with
    // `wrapper` parentless, so Box3 reads everything in wrapper's own frame — no stale ancestor
    // matrixWorld can leak in (see the background-tab pivot bug fixed in PizzaScene.setupMeshLayer()).
    const scaler = new THREE.Group();
    scaler.add(object);
    const orient = new THREE.Group();
    orient.add(scaler);
    const align = new THREE.Group();
    align.add(orient);
    const wrapper = new THREE.Group();
    wrapper.add(align);

    const measure = (): THREE.Box3 => {
        wrapper.updateWorldMatrix(false, true);
        return new THREE.Box3().setFromObject(align);
    };

    // 1. Size — real world size by default, or normalized to maxSize.
    let bounds = measure();
    const nativeSize = bounds.getSize(new THREE.Vector3());
    if (options.maxSize !== undefined) {
        const largest = Math.max(nativeSize.x, nativeSize.y, nativeSize.z);
        scaler.scale.setScalar(largest > 1e-6 ? options.maxSize / largest : 1);
    } else {
        scaler.scale.setScalar(worldScale);
    }

    // 2. Orientation — tall things lie on their side.
    if (options.layDownIfTall && nativeSize.y > LAY_DOWN_ASPECT * Math.max(nativeSize.x, nativeSize.z)) {
        orient.rotation.z = Math.PI / 2;
    }

    // 3. Bottom-center at the origin.
    bounds = measure();
    const center = bounds.getCenter(new THREE.Vector3());
    align.position.set(-center.x, -bounds.min.y, -center.z);

    return { object: wrapper, size: bounds.getSize(new THREE.Vector3()) };
}

/** Releases everything loadResourceDisplayModel() created — its cloned materials, plus the placeholder box's geometry. Cached model geometry is left alone. Also detaches `model` from its parent. */
export function disposeResourceDisplayModel(model: THREE.Object3D): void {
    model.traverse(child => {
        if (child instanceof THREE.Mesh) {
            const materials = Array.isArray(child.material) ? child.material : [child.material];
            materials.forEach(material => material.dispose());
            if (child.userData[OWNED_MESH_FLAG]) {
                child.geometry.dispose();
            }
        }
    });
    model.removeFromParent();
}

function rangeMidpoint(range: NumberRange): number {
    return Array.isArray(range) ? (range[0] + range[1]) / 2 : range;
}

function buildPlaceholderBox(type: ResourceType): THREE.Mesh {
    const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(PLACEHOLDER_SIZE, PLACEHOLDER_SIZE, PLACEHOLDER_SIZE),
        new THREE.MeshStandardMaterial({ color: RESOURCE_CONFIG[type].color }),
    );
    mesh.userData[OWNED_MESH_FLAG] = true;
    return mesh;
}
