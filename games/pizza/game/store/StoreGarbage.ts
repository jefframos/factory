// StoreGarbage.ts
//
// One piece of garbage on a store's floor — an item a fed-up client dropped
// (see StoreClient.ts's angry drop / Store.dropGarbage()). Drawn as that item,
// lying down and darkened (GARBAGE_DARKEN), with a little cloud of flies over
// it (the "garbageFlies" particle effect). Store.ts owns the list, saves it
// (StoreGarbageStorage.ts), and picks it up when the player walks over it: it
// flies onto the player's stack as ResourceType.Garbage, which only a trash
// storage takes.

import * as THREE from 'three';
import Entity from '../ecs/Entity';
import ParticleEmitterComponent from '../components/ParticleEmitterComponent';
import { stackItemScale } from '../components/CarrierStackVisual';
import { getPileScale } from '../components/ItemPile';
import { darkenResourceDisplayModel, disposeResourceDisplayModel, loadResourceDisplayModel } from '../world/ResourceDisplayModel';
import { GARBAGE_DARKEN } from '../data/GarbageCarryStorage';
import { ResourceType } from '../actions/ResourceTypes';
import type { SavedGarbage } from './StoreGarbageStorage';
import { FloorLayers } from '../world/FloorLayers';

/** Flies spawned per second over each piece. */
const FLIES_PER_SEC = 3;
/** Where the flies hover, above the piece's own position. */
const FLIES_OFFSET = new THREE.Vector3(0, 0.15, 0);

export default class StoreGarbage extends Entity {
    public readonly type: ResourceType;
    public readonly yaw: number;
    private model?: THREE.Object3D;
    private destroyed = false;

    public constructor(saved: SavedGarbage) {
        super();
        this.type = saved.type;
        this.yaw = saved.yaw;
        this.transform.position.set(saved.x, FloorLayers.baseY, saved.z);
    }

    public override awake(): void {
        this.addComponent(new ParticleEmitterComponent('garbageFlies', FLIES_PER_SEC, FLIES_OFFSET));
        void loadResourceDisplayModel(this.type, { orientation: 'lying' }).then(({ object }) => {
            if (this.destroyed) {
                disposeResourceDisplayModel(object);
                return;
            }
            object.scale.setScalar(stackItemScale() * getPileScale(this.type));
            object.rotation.y = this.yaw;
            darkenResourceDisplayModel(object, GARBAGE_DARKEN);
            this.model = object;
            this.transform.add(object);
        });
    }

    public override destroy(): void {
        this.destroyed = true;
        if (this.model) {
            this.model.removeFromParent();
            disposeResourceDisplayModel(this.model);
        }
        super.destroy();
    }

    public toSave(): SavedGarbage {
        return { type: this.type, x: this.transform.position.x, z: this.transform.position.z, yaw: this.yaw };
    }
}
