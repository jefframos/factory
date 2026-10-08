// StoreGarbage.ts
//
// One piece of garbage on a store's floor — an item a fed-up client dropped
// (see StoreClient.ts's angry drop / Store.dropGarbage()). Drawn as that item,
// lying down and darkened (GARBAGE_DARKEN), with a little cloud of flies over
// it (the "garbageFlies" particle effect). Store.ts owns the list, saves it
// (StoreGarbageStorage.ts), and picks it up when the player walks over it: it
// flies onto the player's stack as ResourceType.Garbage, which only a trash
// storage takes. A bobbing trash icon floats over it (ui/AlertIcon.ts) so it's easy to spot.

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
import ScreenAnchorComponent, { ScreenAnchorHost } from '../components/ScreenAnchorComponent';
import { createAlertIcon, destroyAlertIcon } from '../ui/AlertIcon';
import { STORE_ALERT_ANCHOR_OPTIONS } from './StoreAlertConfig';

/** Flies spawned per second over each piece. */
const FLIES_PER_SEC = 3;
/** Where the flies hover, above the piece's own position. */
const FLIES_OFFSET = new THREE.Vector3(0, 0.15, 0);
/** The trash icon floats this high over the piece (world units). */
const ICON_HEIGHT = 1.2;
const ICON_SIZE = 34;

export default class StoreGarbage extends Entity {
    public readonly type: ResourceType;
    public readonly yaw: number;
    private model?: THREE.Object3D;
    private destroyed = false;
    private readonly screenHost?: ScreenAnchorHost;
    private icon?: ReturnType<typeof createAlertIcon>;

    public constructor(saved: SavedGarbage, screenHost?: ScreenAnchorHost) {
        super();
        this.screenHost = screenHost;
        this.type = saved.type;
        this.yaw = saved.yaw;
        this.transform.position.set(saved.x, FloorLayers.baseY, saved.z);
    }

    public override awake(): void {
        this.addComponent(new ParticleEmitterComponent('garbageFlies', FLIES_PER_SEC, FLIES_OFFSET));
        if (this.screenHost) {
            this.icon = createAlertIcon('trash', ICON_SIZE);
            const target = new THREE.Vector3();
            this.addComponent(new ScreenAnchorComponent(
                this.screenHost,
                this.icon,
                () => target.copy(this.transform.position).setY(this.transform.position.y + ICON_HEIGHT),
                STORE_ALERT_ANCHOR_OPTIONS,
            ));
        }
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
        if (this.icon) {
            destroyAlertIcon(this.icon);
        }
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
