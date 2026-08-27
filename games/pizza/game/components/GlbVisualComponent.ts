// GlbVisualComponent.ts
//
// Real-art counterpart to BoxVisualComponent/CylinderVisualComponent — loads
// a static prop (a model registry entry, e.g. MODELS.Props.Tree) via
// core/three/ModelLoaderManager instead of building a primitive. That
// manager caches the parsed glb/gltf scene and hands back a clone per
// instance, so spawning many of the same prop only pays the network/parse
// cost once.
//
// awake() is synchronous everywhere else in this ECS, but a model load
// can't be — this component's mesh simply doesn't exist for the few frames
// between spawn and the load resolving. setVisible()/destroy() both guard
// on that, and destroy() also cancels a still-in-flight load so it can't
// attach a mesh to an entity that's already gone.

import * as THREE from 'three';
import Component from '../ecs/Component';
import ModelLoaderManager from 'core/three/ModelLoaderManager';
import { BendService } from '../services/BendService';
import { ModelDefinition } from '../../registry/assetsRegistry/modelsRegistry';

/** Same `./` + repo-relative convention every other model load in pizza uses (see PizzaScene.ts/MainPlayer.ts's modelUrl()) — resolves e.g. "pizza/models/props/tree.glb" against public/pizza/models/. */
const modelUrl = (fullPath: string): string => `./${fullPath}`;

export default class GlbVisualComponent extends Component {
    private readonly modelDef: ModelDefinition;
    private readonly centerOffset: THREE.Vector3;
    private readonly scale: number;
    /** Yaw, in radians — see ResourceRegistry.ts's rotationDeg for where a caller typically rolls this from. */
    private readonly rotationY: number;
    /** Fired once, right after the model finishes loading and `this.mesh` becomes safe to read — for a caller that needs to do something to the mesh itself (e.g. CraftZone's float animation) but can't just do it inline after `new GlbVisualComponent(...)` returns, since the load is always asynchronous. */
    private readonly onReady?: () => void;
    private _mesh?: THREE.Object3D;
    private destroyed = false;

    public constructor(modelDef: ModelDefinition, centerOffset: THREE.Vector3 = new THREE.Vector3(), scale = 1, rotationY = 0, onReady?: () => void) {
        super();
        this.modelDef = modelDef;
        this.centerOffset = centerOffset;
        this.scale = scale;
        this.rotationY = rotationY;
        this.onReady = onReady;
    }

    public get mesh(): THREE.Object3D {
        if (!this._mesh) {
            throw new Error('GlbVisualComponent mesh accessed before its model finished loading');
        }
        return this._mesh;
    }

    /** True once the model has actually loaded and this.mesh is safe to read — see this file's own doc. */
    public get isReady(): boolean {
        return this._mesh !== undefined;
    }

    public awake(): void {
        // A failed load (missing asset, unreachable in a headless/no-DOM context, ...) has
        // nothing further to do beyond logging — swallow it here so it can never surface as
        // an unhandled promise rejection (which some environments, e.g. Node, treat as fatal)
        // just because this decorative prop couldn't load. isReady simply stays false forever.
        this.load().catch(error => console.warn(`GlbVisualComponent: failed to load ${this.modelDef.id}`, error));
    }

    private async load(): Promise<void> {
        const object = await ModelLoaderManager.instance.loadModel(modelUrl(this.modelDef.fullPath), this.modelDef.id);
        if (this.destroyed) {
            return;
        }

        // ModelLoaderManager caches ONE parsed scene per model id and hands every instance
        // `cached.clone(true)` — THREE.Object3D.clone() deep-copies the transform hierarchy but
        // copies each Mesh's `.material` by REFERENCE, not by value (stock three.js behavior).
        // Left alone, every live instance of e.g. "Props.Tree" shares the exact same Material
        // objects — mutating one (a hit-flash's emissive, a future per-instance tint, ...)
        // visibly affects every OTHER tree using that material at the same time, and disposing
        // one instance's material (see destroy() below) breaks rendering for every other
        // instance still using it. Cloning here gives THIS instance its own private materials,
        // fixing both. Geometry is deliberately left shared (see destroy()'s own doc) — nothing
        // ever mutates geometry per-instance, so there's no correctness reason to duplicate its
        // (often much larger) buffers.
        object.traverse(child => {
            if (child instanceof THREE.Mesh) {
                child.material = Array.isArray(child.material)
                    ? child.material.map(material => material.clone())
                    : child.material.clone();
            }
        });

        // Same shared uBendOrigin/uBendStrength every other world material uses — without
        // this the prop would sit rigid while the ground curves away from it.
        object.traverse(child => {
            if (child instanceof THREE.Mesh) {
                const materials = Array.isArray(child.material) ? child.material : [child.material];
                materials.forEach(material => BendService.applyBend(material));
            }
        });

        object.position.copy(this.centerOffset);
        object.scale.setScalar(this.scale);
        object.rotation.y = this.rotationY;

        this._mesh = object;
        this.entity.transform.add(object);
        this.onReady?.();
    }

    /** Hide/show the mesh without tearing it down — see ResourceNode.deplete()/respawn(). No-op until the model has actually loaded. */
    public setVisible(visible: boolean): void {
        if (this._mesh) {
            this._mesh.visible = visible;
        }
    }

    public destroy(): void {
        this.destroyed = true;

        // Materials are safe to dispose here since load() now clones one private set per
        // instance (see that method's own doc) — this can no longer break some OTHER live
        // instance still rendering with what used to be the same shared Material object.
        // Geometry is deliberately NOT disposed — it's still the raw, un-cloned buffer straight
        // out of ModelLoaderManager's cache, shared by every instance of this model that
        // exists or will ever be spawned; disposing it here would break every other tree/prop
        // of the same kind still visible, or about to be.
        this._mesh?.traverse(child => {
            if (child instanceof THREE.Mesh) {
                const materials = Array.isArray(child.material) ? child.material : [child.material];
                materials.forEach(material => material.dispose());
            }
        });
        this._mesh?.removeFromParent();
    }
}
