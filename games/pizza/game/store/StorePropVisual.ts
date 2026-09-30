// StorePropVisual.ts
//
// A solid piece of store furniture (the cashier counter, the money-drop
// counter — see StoreConfig.cashierView/moneyDropView) on an entity whose
// transform sits at the prop's spot on the floor. Loads the EntityViewRegistry
// view's model, then — whatever the model's own pivot (the kitchen cabinet
// floats 2 units above its origin and isn't centered in depth) — sits it
// bottom-center on the spot (plus the view's own offset), and gives it a solid
// collider matching its REAL measured footprint, so what you see is what you
// bump into. The zone's own trigger stays whatever the entity already has
// (the full map rect): the player serves/collects by standing against it.

import * as THREE from 'three';
import Entity from '../ecs/Entity';
import GlbVisualComponent from '../components/GlbVisualComponent';
import RigidBody from '../physics/RigidBody';
import { Layers } from '../physics/PhysicsConstants';
import { resolveEntityView } from '../world/EntityViewRegistry';

/** `onFitted` gets the placed model's bounds in the ENTITY's local frame (bottom at y=0). */
export function addStorePropVisual(entity: Entity, viewId: string | undefined, onFitted?: (localBounds: THREE.Box3) => void): void {
    const resolved = resolveEntityView(viewId);
    if (!resolved) {
        if (viewId) {
            console.warn(`[StorePropVisual] view "${viewId}" has no model — no prop drawn`);
        }
        return;
    }
    const visual: GlbVisualComponent = entity.addComponent(new GlbVisualComponent(
        resolved.model,
        new THREE.Vector3(),
        resolved.scale,
        THREE.MathUtils.degToRad(resolved.rotationDeg),
        () => {
            const mesh = visual.mesh;
            const bounds = measureLocalBounds(entity, mesh);
            if (bounds.isEmpty()) {
                return;
            }
            // Bottom-center onto the spot, then the view's own offset on top.
            const center = bounds.getCenter(new THREE.Vector3());
            const [offsetX, offsetY, offsetZ] = resolved.offset;
            mesh.position.x += -center.x + offsetX;
            mesh.position.y += -bounds.min.y + offsetY;
            mesh.position.z += -center.z + offsetZ;
            const placed = measureLocalBounds(entity, mesh);

            const size = placed.getSize(new THREE.Vector3());
            const placedCenter = placed.getCenter(new THREE.Vector3());
            entity.addComponent(new RigidBody({
                halfExtents: new THREE.Vector3(size.x / 2, size.y / 2, size.z / 2),
                centerOffset: placedCenter,
                isStatic: true,
                layer: Layers.Environment,
                // A wall to walk into, never something to stand on — see SolidArea.buildSolidArea().
                blocksVertical: false,
            }));
            onFitted?.(placed);
        },
    ));
}

/**
 * `object`'s bounds in `entity`'s local frame. Refreshes the whole matrix chain first, parents
 * included — a load that resolves before the first rendered frame (a background tab) would
 * otherwise measure against stale matrices (see PizzaScene.setupMeshLayer()'s identical note).
 */
function measureLocalBounds(entity: Entity, object: THREE.Object3D): THREE.Box3 {
    object.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(object);
    return box.applyMatrix4(entity.transform.matrixWorld.clone().invert());
}
