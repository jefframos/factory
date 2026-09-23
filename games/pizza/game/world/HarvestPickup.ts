// HarvestPickup.ts
//
// A resource lying in the world, waiting to be picked up onto the player's
// carry stack — the generic "world pickable entity". (Farm harvests no longer
// drop these: FarmPlotTile flies a harvest straight onto the stack — see
// FlyToStack.ts. This stays for anything that should land on the ground
// first.) Lifecycle:
//
//   1. HOP:   optionally arcs out from `from` and lands at `landAt` (pass the
//             same point twice to just appear there).
//   2. ARMED: after ARM_DELAY_SEC on the ground it becomes collectable — the
//             delay lets the player actually SEE it land.
//   3. PICK:  when the player touches it, if their stack has room
//             (CarryStack.hasRoomFor()) it flies onto the top of the stack
//             (flyResourceToStack) and this entity leaves the world; if the
//             stack is full it stays put and the "stack is full" balloon shows
//             (CarryStack.notifyFull(), rate-limited) — walking back over it
//             once there's room picks it up (onTriggerStay keeps re-checking).

import * as THREE from 'three';
import gsap from 'gsap';
import Entity from '../ecs/Entity';
import RigidBody from '../physics/RigidBody';
import { Layers } from '../physics/PhysicsConstants';
import { ResourceType } from '../actions/ResourceTypes';
import MainPlayer from '../player/MainPlayer';
import { CarryStack } from '../player/CarryStack';
import { flyResourceToStack } from '../components/FlyToStack';
import { disposeResourceDisplayModel, loadResourceDisplayModel } from './ResourceDisplayModel';

/** Pickup reach — a little bigger than the model so brushing past it counts. */
const TRIGGER_HALF_EXTENTS = new THREE.Vector3(0.5, 0.5, 0.5);
const HOP_DURATION_SEC = 0.4;
const HOP_HEIGHT = 0.9;
const ARM_DELAY_SEC = 0.25;

type PickupState = 'hopping' | 'armed' | 'picked';

export default class HarvestPickup extends Entity {
    private readonly resourceType: ResourceType;
    private readonly amount: number;
    private readonly from: THREE.Vector3;
    private readonly landAt: THREE.Vector3;
    private state: PickupState = 'hopping';
    private model?: THREE.Group;
    private destroyed = false;
    /** Whichever hop/arm tween is currently running — killed in destroy() so a pickup torn down mid-animation stops writing to its transform. */
    private activeTween?: gsap.core.Tween;

    public constructor(resourceType: ResourceType, amount: number, from: THREE.Vector3, landAt: THREE.Vector3) {
        super();
        this.resourceType = resourceType;
        this.amount = amount;
        this.from = from.clone();
        this.landAt = landAt.clone();
        this.transform.position.copy(from);
    }

    public override awake(): void {
        const rigidBody = this.addComponent(new RigidBody({
            halfExtents: TRIGGER_HALF_EXTENTS,
            isStatic: true,
            isTrigger: true,
            // Not Layers.Resource — same reasoning as LooseResourceNode: this must never feed
            // AutoGatherController's harvest pipeline.
            layer: Layers.Default,
            centerOffset: new THREE.Vector3(0, TRIGGER_HALF_EXTENTS.y, 0),
        }));
        rigidBody.onTriggerEnter.add(other => this.tryPickup(other));
        rigidBody.onTriggerStay.add(other => this.tryPickup(other));

        // Real world size, tall items lying down — exactly as it will look flying and on the stack.
        void loadResourceDisplayModel(this.resourceType, { layDownIfTall: true }).then(({ object }) => {
            if (this.destroyed) {
                disposeResourceDisplayModel(object);
                return;
            }
            this.model = object;
            this.transform.add(object);
        });

        this.playHop();
    }

    public override destroy(): void {
        this.destroyed = true;
        this.activeTween?.kill();
        this.activeTween = undefined;
        if (this.model) {
            disposeResourceDisplayModel(this.model);
            this.model = undefined;
        }
        super.destroy();
    }

    private playHop(): void {
        const progress = { t: 0 };
        const apex = this.from.clone().lerp(this.landAt, 0.5).add(new THREE.Vector3(0, HOP_HEIGHT, 0));
        this.activeTween = gsap.to(progress, {
            t: 1,
            duration: HOP_DURATION_SEC,
            ease: 'power1.out',
            onUpdate: () => {
                const t = progress.t;
                const u = 1 - t;
                this.transform.position.set(
                    u * u * this.from.x + 2 * u * t * apex.x + t * t * this.landAt.x,
                    u * u * this.from.y + 2 * u * t * apex.y + t * t * this.landAt.y,
                    u * u * this.from.z + 2 * u * t * apex.z + t * t * this.landAt.z,
                );
            },
            onComplete: () => {
                this.activeTween = gsap.delayedCall(ARM_DELAY_SEC, () => {
                    if (this.state === 'hopping') {
                        this.state = 'armed';
                    }
                });
            },
        });
    }

    private tryPickup(other: RigidBody): void {
        if (this.state !== 'armed' || !(other.entity instanceof MainPlayer)) {
            return;
        }
        const player = other.entity;
        if (!CarryStack.hasRoomFor(this.amount)) {
            CarryStack.notifyFull(player);
            return;
        }

        const scene = this.transform.parent;
        if (!scene) {
            return;
        }
        this.state = 'picked';
        const from = this.transform.position.clone();
        for (let i = 0; i < this.amount; i++) {
            flyResourceToStack(scene, player, this.resourceType, from);
        }
        this.world?.remove(this);
    }
}
