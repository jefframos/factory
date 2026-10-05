// MapMeshVisual.ts
//
// Draws a MeshPlacement (a model dragged onto the Tiled map — see
// MeshLayerSpawner.ts) on an entity, fitted exactly the way the map shows it:
// scaled to the object's drawn footprint, turned by its rotation, centered on
// its rect whatever the model's own pivot, and — when the placement is solid
// (object or tile "solid" property) — with a collider covering that footprint, or, when the tile
// has collision rects drawn in Tiled's tile collision editor, one collider per rect instead.
// Used for the meshes layer (PizzaScene.setupMeshLayer()) and for store
// counters (StoreCashier/StoreMoneyPile), so both read the map the same way.
//
// The entity doesn't have to sit ON the placement: everything is placed
// relative to entity.transform (e.g. a cashier entity at its trigger rect's
// center, drawing a counter the designer put somewhere else inside it).

import * as THREE from 'three';
import Entity from '../ecs/Entity';
import GlbVisualComponent from '../components/GlbVisualComponent';
import RigidBody from '../physics/RigidBody';
import { Layers } from '../physics/PhysicsConstants';
import { ModelSnapshotTool } from '../debug/ModelSnapshotTool';
import { OcclusionFadeConfig } from '../services/BendService';
import { MeshPlacement } from './MeshLayerSpawner';

const UP_AXIS = new THREE.Vector3(0, 1, 0);

export interface MapMeshVisualOptions {
    occlusionFade?: OcclusionFadeConfig;
    /** After the model is loaded and fitted — its bounds in the ENTITY's local frame (e.g. to rest things on its top). */
    onFitted?: (localBounds: THREE.Box3) => void;
}

/** Returns false (and adds nothing) if the placement's model ref doesn't resolve. */
export function addMapMeshVisual(entity: Entity, placement: MeshPlacement, options: MapMeshVisualOptions = {}): boolean {
    const modelDef = ModelSnapshotTool.resolveModelDef(placement.modelRef);
    if (!modelDef) {
        return false;
    }

    // Where the placement sits relative to the entity (0 when the entity IS at the placement).
    const base = new THREE.Vector3(
        placement.x - entity.transform.position.x,
        0,
        placement.z - entity.transform.position.z,
    );
    // offsetX/Y/Z (Tiled custom properties — see MeshLayerSpawner's OFFSET_X_PROPERTY) are a
    // level designer's manual nudge for wherever this model's own pivot sits relative to its
    // placeholder's rect center. That nudge is meaningless in a fixed WORLD direction once the
    // object is rotated (it has to turn WITH the model) — rotating it by the same rotationY the
    // mesh gets is what keeps it pointing the same way RELATIVE to the model.
    const meshOffset = new THREE.Vector3(placement.offsetX, placement.offsetY, placement.offsetZ)
        .applyAxisAngle(UP_AXIS, placement.rotationY)
        .add(base);

    const visual: GlbVisualComponent = new GlbVisualComponent(modelDef, meshOffset, 1, 0, () => {
        const mesh = visual.mesh;
        // Refresh the WHOLE chain (parents included) before measuring — Box3.setFromObject()
        // only updates the object itself against its parent's CURRENT matrixWorld, which is
        // stale (identity) if no frame has rendered since this entity was positioned (e.g. the
        // game loaded in a background tab: every GLB resolves before the first frame).
        mesh.updateWorldMatrix(true, true);
        const box = new THREE.Box3().setFromObject(mesh);
        const nativeSize = box.getSize(new THREE.Vector3());
        const scaleX = nativeSize.x > 1e-4 ? placement.worldWidth / nativeSize.x : 1;
        const scaleZ = nativeSize.z > 1e-4 ? placement.worldDepth / nativeSize.z : 1;
        // No Tiled-side signal for vertical scale (a top-down placement has no height to
        // resize) — splitting the difference between the two horizontal axes is the least
        // arbitrary stand-in.
        const scaleY = (scaleX + scaleZ) / 2;

        // ModelSnapshotTool frames its placeholder snapshot around the model's own BOUNDING-BOX
        // center (see frameTopDown()), not its pivot — so the rect's center is where that box
        // center belongs. THREE scales/rotates around the pivot, so for an off-center pivot the
        // box center would swing away from the rect as rotation grows; this moves it back. X/Z
        // only — Y keeps the pivot-at-base convention. worldToLocal() re-expresses the WORLD box
        // center in the mesh's parent frame, isolating the model's own pivot-to-center offset.
        const localBoxCenter = mesh.parent!.worldToLocal(box.getCenter(new THREE.Vector3()));
        const pivotToCenterXZ = new THREE.Vector3(
            (localBoxCenter.x - mesh.position.x) * scaleX,
            0,
            (localBoxCenter.z - mesh.position.z) * scaleZ,
        ).applyAxisAngle(UP_AXIS, placement.rotationY);
        mesh.position.x -= pivotToCenterXZ.x;
        mesh.position.z -= pivotToCenterXZ.z;

        mesh.scale.set(scaleX, scaleY, scaleZ);
        mesh.rotation.y = placement.rotationY;

        if (placement.solid && placement.colliders && placement.colliders.length > 0) {
            // The tile's own collision rects (Tiled's tile collision editor) instead of the whole
            // footprint — already fitted to this placement's size/rotation in world space.
            const halfY = Math.max(nativeSize.y * scaleY, 0.1) / 2;
            for (const collider of placement.colliders) {
                entity.addComponent(new RigidBody({
                    halfExtents: new THREE.Vector3(collider.halfX, halfY, collider.halfZ),
                    isStatic: true,
                    layer: Layers.Environment,
                    centerOffset: new THREE.Vector3(
                        collider.x - entity.transform.position.x,
                        placement.offsetY + halfY,
                        collider.z - entity.transform.position.z,
                    ),
                }));
            }
        } else if (placement.solid) {
            // Colliders are axis-aligned: a rotated object gets the box around its ROTATED
            // footprint (exact for 90°/270°) — see BuildingZone.addSolidAreasFromMap().
            const cos = Math.abs(Math.cos(placement.rotationY));
            const sin = Math.abs(Math.sin(placement.rotationY));
            const halfExtents = new THREE.Vector3(
                (placement.worldWidth * cos + placement.worldDepth * sin) / 2,
                Math.max(nativeSize.y * scaleY, 0.1) / 2,
                (placement.worldWidth * sin + placement.worldDepth * cos) / 2,
            );
            entity.addComponent(new RigidBody({
                halfExtents,
                isStatic: true,
                layer: Layers.Environment,
                // Follows the same offset the visual got, so the collider sits where it's drawn.
                centerOffset: new THREE.Vector3(meshOffset.x, placement.offsetY + halfExtents.y, meshOffset.z),
            }));
        }

        if (options.onFitted) {
            mesh.updateWorldMatrix(true, true);
            const fitted = new THREE.Box3().setFromObject(mesh).applyMatrix4(entity.transform.matrixWorld.clone().invert());
            options.onFitted(fitted);
        }
    }, options.occlusionFade);
    entity.addComponent(visual);
    return true;
}
