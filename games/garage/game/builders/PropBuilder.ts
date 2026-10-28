// PropBuilder.ts
//
// Places static set dressing (cars, tires, boxes...) from public/garage/models: loads the model, gives
// every material the world bend, scales it to a target length or height, stands it on the floor and,
// when asked, adds a static collider so the player walks around it.

import * as THREE from 'three';
import ModelLoaderManager from 'core/three/ModelLoaderManager';
import RigidBody from 'core/physics/RigidBody';
import { Layers } from 'core/physics/PhysicsConstants';
import type World from 'core/ecs/World';
import { WorldBendService } from 'core/services/BendService';

const MODEL_BASE = './garage/models/';

export interface PropPlacement {
    x: number;
    z: number;
    /** Degrees around the vertical axis. */
    rotationY?: number;
    /** Scale so the longest horizontal side is this long (cars)... */
    length?: number;
    /** ...or so the model is this tall (everything else). */
    height?: number;
}

export async function placeProp(
    threeScene: THREE.Scene,
    bendService: WorldBendService,
    model: string,
    placement: PropPlacement,
): Promise<THREE.Object3D> {
    const object = await ModelLoaderManager.instance.loadModel(`${MODEL_BASE}${model}`);
    object.traverse((child) => {
        if (child instanceof THREE.Mesh) {
            child.material = Array.isArray(child.material) ? child.material.map((m) => m.clone()) : child.material.clone();
            (Array.isArray(child.material) ? child.material : [child.material]).forEach((m) => bendService.applyBend(m));
        }
    });
    object.updateMatrixWorld(true);
    const size = new THREE.Box3().setFromObject(object).getSize(new THREE.Vector3());
    if (placement.length) {
        object.scale.multiplyScalar(placement.length / Math.max(size.x, size.z, 1e-4));
    } else if (placement.height) {
        object.scale.multiplyScalar(placement.height / Math.max(size.y, 1e-4));
    }
    object.rotation.y = THREE.MathUtils.degToRad(placement.rotationY ?? 0);
    object.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(object);
    object.position.set(placement.x, -bounds.min.y, placement.z);
    threeScene.add(object);
    return object;
}

/** A static box the player collides with (half sizes in world units), resting on the floor. */
export function addStaticCollider(world: World, threeScene: THREE.Scene, bendService: WorldBendService, x: number, z: number, halfX: number, halfY: number, halfZ: number): void {
    const entity = world.spawn();
    entity.transform.position.set(x, 0, z);
    threeScene.add(entity.transform);
    entity.addComponent(new RigidBody({
        halfExtents: new THREE.Vector3(halfX, halfY, halfZ),
        centerOffset: new THREE.Vector3(0, halfY, 0),
        isStatic: true,
        layer: Layers.Environment,
        bendService,
    }));
}
