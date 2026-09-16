// CropVisualComponent.ts
//
// Drives a farm cell's own growing-crop mesh purely off external state — a
// `getPlanted` callback (FarmPlotTile.ts reads FarmCropStorage.getPlanted()
// through it) polled every frame, same "component reacts to a store, caller
// never has to push updates into it" shape as ScreenAnchorComponent's own
// getTargetPosition. Added ONCE in FarmPlotTile.awake() and left in place
// for that entity's whole lifetime — this ECS has no removeComponent() (see
// Entity.ts), so a cell that gets planted, harvested, and replanted many
// times over never adds/removes components for that; it just changes what
// getPlanted() returns and this component reacts (hides its mesh entirely
// while empty, same as GlbVisualComponent.setVisible(false) elsewhere).
//
// Can't just BE a GlbVisualComponent (see that file's own doc) because a
// crop needs to swap its underlying model mid-life as CropStageConfig.mesh
// changes between stages, and continuously re-drive the SAME loaded mesh's
// own position/scale every frame as CropTypes.resolveCropStage() lerps
// between a stage's start/end transform — GlbVisualComponent bakes both in
// once at load and never touches them again. This duplicates GlbVisualComponent's
// own load/clone/dispose steps for that reason (see its own comments there
// for why each one exists) rather than becoming reusable — the two never
// stay in sync as a single load DOES here.

import * as THREE from 'three';
import Component from '../ecs/Component';
import ModelLoaderManager from 'core/three/ModelLoaderManager';
import { BendService } from '../services/BendService';
import { resolveEntityView } from '../world/EntityViewRegistry';
import { CROP_CONFIG, resolveCropStage } from '../data/CropTypes';
import { PlantedCrop } from '../data/FarmCropStorage';

/** Same repo-relative convention every other model load in pizza uses — see GlbVisualComponent.ts's own modelUrl(). */
const modelUrl = (fullPath: string): string => `./${fullPath}`;

export default class CropVisualComponent extends Component {
    private readonly getPlanted: () => PlantedCrop | undefined;

    private mesh?: THREE.Object3D;
    /** The EntityViewRegistry id `mesh` currently shows — undefined while empty OR while a swap is still loading (see swapMesh()). Compared against resolveCropStage()'s own meshKey each frame to decide whether a swap is needed. */
    private currentMeshKey?: string;
    /** Guards a stale in-flight load from attaching after either a newer swap started or this component was torn down — same "ignore anything that resolves after destroy()" guard GlbVisualComponent's own `destroyed` flag provides, generalized to "and also after an even newer swap superseded it." */
    private loadToken = 0;
    private destroyed = false;

    public constructor(getPlanted: () => PlantedCrop | undefined) {
        super();
        this.getPlanted = getPlanted;
    }

    public update(): void {
        const planted = this.getPlanted();
        if (!planted) {
            if (this.mesh || this.currentMeshKey !== undefined) {
                this.clearMesh();
            }
            return;
        }

        const config = CROP_CONFIG[planted.cropId];
        const elapsedSec = Date.now() / 1000 - planted.plantedAtSec;
        const { stage, t, meshKey } = resolveCropStage(config, elapsedSec);

        if (meshKey !== this.currentMeshKey) {
            this.swapMesh(meshKey);
        }

        if (this.mesh) {
            const offsetX = THREE.MathUtils.lerp(stage.start.offset[0], stage.end.offset[0], t);
            const offsetY = THREE.MathUtils.lerp(stage.start.offset[1], stage.end.offset[1], t);
            const offsetZ = THREE.MathUtils.lerp(stage.start.offset[2], stage.end.offset[2], t);
            this.mesh.position.set(offsetX, offsetY, offsetZ);
            this.mesh.scale.setScalar(THREE.MathUtils.lerp(stage.start.scale, stage.end.scale, t));
        }
    }

    /** Tears down whatever mesh is currently showing and marks this cell as having none — used both for "harvested/never planted" (see update()) and as the first step of swapMesh() below. */
    private clearMesh(): void {
        this.disposeMesh(this.mesh);
        this.mesh = undefined;
        this.currentMeshKey = undefined;
    }

    /** Starts loading `meshKey`'s own model (undefined = clear back to nothing, e.g. a stage with no mesh at all and no earlier one to inherit — see CropStageConfig.mesh's own doc) — async, same reason GlbVisualComponent's own load() is: this.mesh simply doesn't exist for the few frames between calling this and the load resolving, during which update() keeps rendering last stage's mesh untouched rather than flickering empty. */
    private swapMesh(meshKey: string | undefined): void {
        this.clearMesh();
        // currentMeshKey is set to the TARGET key immediately (not just once loaded) so a
        // same-key resolveCropStage() result on the very next frame doesn't re-trigger another
        // swap while this one is still in flight.
        this.currentMeshKey = meshKey;

        const resolved = resolveEntityView(meshKey);
        if (!resolved) {
            return;
        }

        const token = ++this.loadToken;
        ModelLoaderManager.instance.loadModel(modelUrl(resolved.model.fullPath), resolved.model.id)
            .then(object => this.attachMesh(object, token))
            .catch(error => console.warn(`CropVisualComponent: failed to load ${resolved.model.id}`, error));
    }

    private attachMesh(object: THREE.Object3D, token: number): void {
        // Stale: either this component was destroyed, or a NEWER swapMesh() call already
        // superseded this one (currentMeshKey moved on before this load resolved) — either way,
        // attaching now would leave an orphaned mesh nothing is tracking to dispose later.
        if (this.destroyed || token !== this.loadToken) {
            return;
        }

        // Same private-clone-per-instance + shared-bend-material steps as GlbVisualComponent's
        // own load() — see that file's own doc for why each is needed.
        object.traverse(child => {
            if (child instanceof THREE.Mesh) {
                child.material = Array.isArray(child.material)
                    ? child.material.map(material => material.clone())
                    : child.material.clone();
            }
        });
        object.traverse(child => {
            if (child instanceof THREE.Mesh) {
                const materials = Array.isArray(child.material) ? child.material : [child.material];
                materials.forEach(material => BendService.applyBend(material));
            }
        });

        this.mesh = object;
        this.entity.transform.add(object);
    }

    private disposeMesh(mesh: THREE.Object3D | undefined): void {
        if (!mesh) {
            return;
        }

        // Geometry deliberately left undisposed — still ModelLoaderManager's own shared cache
        // buffer, same "never privately owned" reasoning as GlbVisualComponent.destroy()'s doc.
        mesh.traverse(child => {
            if (child instanceof THREE.Mesh) {
                const materials = Array.isArray(child.material) ? child.material : [child.material];
                materials.forEach(material => material.dispose());
            }
        });
        mesh.removeFromParent();
    }

    public destroy(): void {
        this.destroyed = true;
        this.disposeMesh(this.mesh);
        this.mesh = undefined;
    }
}
