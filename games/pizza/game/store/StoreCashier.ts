// StoreCashier.ts
//
// The store's cashier spot — a trigger over the "storeCashier" rect that only
// tracks whether the player is standing in it. Store.ts reads isPlayerInside()
// to decide when the client at the front of the cashier line pays.

import * as THREE from 'three';
import Entity from '../ecs/Entity';
import RigidBody from '../physics/RigidBody';
import { Layers } from '../physics/PhysicsConstants';
import DottedZoneVisualComponent from '../components/DottedZoneVisualComponent';
import { getZoneColor, ZoneColorKind } from '../data/ZoneColorTypes';
import MainPlayer from '../player/MainPlayer';
import { StoreRect } from './StoreLayout';

const TRIGGER_HALF_HEIGHT = 0.75;
const CORNER_RADIUS = 0.3;

export default class StoreCashier extends Entity {
    private readonly rect: StoreRect;
    private player?: MainPlayer;

    public constructor(rect: StoreRect) {
        super();
        this.rect = rect;
        this.transform.position.set(rect.x, 0, rect.z);
    }

    public override awake(): void {
        const halfExtents = new THREE.Vector3(this.rect.width / 2, TRIGGER_HALF_HEIGHT, this.rect.depth / 2);
        const rigidBody = this.addComponent(new RigidBody({
            halfExtents,
            isStatic: true,
            isTrigger: true,
            layer: Layers.Trigger,
            centerOffset: new THREE.Vector3(0, TRIGGER_HALF_HEIGHT, 0),
        }));
        this.addComponent(new DottedZoneVisualComponent(this.rect.width, this.rect.depth, CORNER_RADIUS, { color: getZoneColor(ZoneColorKind.Queue) }));

        rigidBody.onTriggerEnter.add(other => this.handleEnter(other));
        rigidBody.onTriggerStay.add(other => this.handleEnter(other));
        rigidBody.onTriggerExit.add(other => {
            if (other.entity === this.player) {
                this.player = undefined;
            }
        });
    }

    public isPlayerInside(): boolean {
        return this.player !== undefined;
    }

    private handleEnter(other: RigidBody): void {
        if (other.entity instanceof MainPlayer) {
            this.player = other.entity;
        }
    }
}
