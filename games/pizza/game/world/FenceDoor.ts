// FenceDoor.ts
//
// The model in a fence door's hole (a "polyDoor" rect over a "polyFence" — see
// PolyFenceBuilder.layout()): the setup's first model (FenceDoorSetupConfig.models), stretched
// along the fence to exactly fill the hole, FenceDoorSetupConfig.height tall (its depth follows
// the height fit × depthScale), standing on the floor, centered on the hole whatever the model's
// own pivot (fitFenceDoorModel()). Its colliders (two side supports, the middle walkable) are
// added by PizzaScene from PolyFenceBuilder.doorColliderBoxes() — they don't wait for the model.
//
// The model's own width runs along its local X (true for fence-doorway: 0.5 wide, 0.27 deep);
// FenceDoorSetupConfig.rotationOffsetDeg turns one that's modelled the other way.

import * as THREE from 'three';
import Entity from '../ecs/Entity';
import GlbVisualComponent from '../components/GlbVisualComponent';
import { ModelSnapshotTool } from '../debug/ModelSnapshotTool';
import type { FenceDoorSlot } from '../builders/PolyFenceBuilder';
import type { FenceDoorSetupConfig } from '../store/StoreViewTypes';

const UP_AXIS = new THREE.Vector3(0, 1, 0);

/**
 * Scales/turns/places a just-loaded, unscaled, unrotated `mesh` (a child of a parent standing on
 * the floor at the hole's middle) so its bounding box fills a `holeLength`-long hole along
 * `angle` (radians, atan2(dz, dx) of the fence), `setup.height` tall, bottom on the floor.
 */
export function fitFenceDoorModel(mesh: THREE.Object3D, holeLength: number, angle: number, setup: FenceDoorSetupConfig): void {
    const rotationY = -angle + THREE.MathUtils.degToRad(setup.rotationOffsetDeg ?? 0);
    // Measured in the parent's frame (see MapMeshVisual on why the whole chain is refreshed first).
    mesh.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(mesh);
    const size = box.getSize(new THREE.Vector3());
    const localMin = mesh.parent!.worldToLocal(box.min.clone());
    const localCenter = mesh.parent!.worldToLocal(box.getCenter(new THREE.Vector3()));

    const scaleX = size.x > 1e-4 ? holeLength / size.x : 1;
    const scaleY = size.y > 1e-4 ? setup.height / size.y : 1;
    const scaleZ = scaleY * (setup.depthScale ?? 1);

    // Bounding-box center onto the hole's middle, bottom onto the floor — whatever the pivot.
    const pivotToCenter = new THREE.Vector3(
        (localCenter.x - mesh.position.x) * scaleX,
        0,
        (localCenter.z - mesh.position.z) * scaleZ,
    ).applyAxisAngle(UP_AXIS, rotationY);
    const bottom = (localMin.y - mesh.position.y) * scaleY;
    mesh.scale.set(scaleX, scaleY, scaleZ);
    mesh.rotation.y = rotationY;
    mesh.position.set(-pivotToCenter.x, -bottom, -pivotToCenter.z);
}

/** Adds `slot`'s door model to `entity` (which stands on the floor at slot.mid). False (nothing added) if the setup's model doesn't resolve. */
export function addFenceDoorVisual(entity: Entity, slot: FenceDoorSlot): boolean {
    const modelDef = ModelSnapshotTool.resolveModelRef(slot.setup.models?.[0]);
    if (!modelDef) {
        console.warn(`[FenceDoor] fence door setup "${slot.setup.name ?? 'default'}" has no model that resolves — the hole stays empty`);
        return false;
    }
    const holeLength = Math.hypot(slot.to.x - slot.from.x, slot.to.z - slot.from.z);
    const visual: GlbVisualComponent = new GlbVisualComponent(modelDef, new THREE.Vector3(), 1, 0, () => {
        fitFenceDoorModel(visual.mesh, holeLength, slot.angle, slot.setup);
    });
    entity.addComponent(visual);
    return true;
}
