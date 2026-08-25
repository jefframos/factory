// GateDropZone.ts
//
// The deposit trigger for a RESOURCE-gated Gate — see MilestoneRequirement.ts's own doc on why
// a 'resource' GateRequirement, unlike a 'building'/'item' one, isn't satisfied by a passive
// "already holding enough" check: the player has to actually walk up and drop the resource,
// same "deposit, don't just hold" convention BuildingZone's own upgrade ladder uses, rather
// than a gate quietly opening the moment the player happens to be carrying enough. See
// PizzaScene.setupGates()'s own doc for the split between resource-gated gates (this class)
// and building/item-gated ones (RequirementRegistry's usual passive recheck).
//
// One flat resource/amount target, no ladder — same continuous "drain while the player stands
// here" shape as BuildingZone.flyInResource()/tryDeposit(), just simpler: no per-level
// requirement lookup, no level-up sequence, just "keep draining until GateStorage's own deposit
// progress reaches `amount`, then fire onComplete() once." GateStorage.addDepositProgress() is
// the actual source of truth (persisted, survives a reload); this entity is purely the
// trigger + flying-icon front end for it, and could in principle be destroyed and rebuilt mid-
// deposit with zero progress lost.

import * as THREE from 'three';
import gsap from 'gsap';
import Entity from '../ecs/Entity';
import RigidBody from '../physics/RigidBody';
import { Layers } from '../physics/PhysicsConstants';
import DottedZoneVisualComponent from '../components/DottedZoneVisualComponent';
import CharacterVisualComponent from '../components/CharacterVisualComponent';
import { spawnFlyingResourceIcon } from '../components/FlyingResourceIcon';
import { ScreenAnchorHost } from '../components/ScreenAnchorComponent';
import { BackpackStorage } from '../data/BackpackStorage';
import { GateStorage } from '../data/GateStorage';
import { GateId } from '../data/GateTypes';
import { ResourceType } from '../actions/ResourceTypes';
import { resolveResourceAssetKey } from '../actions/ResourceRegistry';
import { getAssetIcon } from './AssetLibraryRegistry';
import MainPlayer from '../player/MainPlayer';

/** Same fixed trigger height every other deposit zone (BuildingZone/QueueZone/DropZone) uses — a gate's own footprint has no vertical dimension to derive one from either. */
const HALF_EXTENTS_Y = 0.75;
/** Same outline color/corner-rounding every other zone's dotted floor trace uses. */
const DROPPER_ZONE_COLOR = 0x3388ff;
const DROPPER_ZONE_CORNER_RADIUS = 0.3;
/** Same per-unit departure cadence BuildingZone.flyInResource() uses. */
const FLY_IN_STAGGER_SEC = 0.12;

export default class GateDropZone extends Entity {
    private readonly gateId: GateId;
    private readonly resourceType: ResourceType;
    private readonly amount: number;
    private readonly screenHost: ScreenAnchorHost;
    private readonly footprint: { width: number; depth: number };
    /** Where deposited icons fly TO — the gate's own icon panel is a reasonable stand-in for "the gate itself," so callers just pass wherever that already anchors. */
    private readonly targetWorldPosition: THREE.Vector3;
    /** Fired exactly once, the instant GateStorage's own deposit progress reaches `amount` — PizzaScene's own gate-unlock sequence. */
    private readonly onComplete: () => void;

    /** Guards a second overlapping flyInResource() loop starting from another onTriggerStay tick — same convention as BuildingZone's own `draining` field. */
    private draining = false;
    /** How many units have DEPARTED but not yet LANDED — see BuildingZone.flyInResource()'s own doc for why this exists (GateStorage's progress only advances on landing, but a new unit departs every FLY_IN_STAGGER_SEC). */
    private inFlight = 0;
    private isPlayerInside = false;
    private player?: MainPlayer;
    /** Set true the instant `amount` is reached — stops any further departures, same as BuildingZone's `awaitingReentry` (just permanent here, since a gate never re-opens for more once unlocked). */
    private done = false;

    public constructor(
        gateId: GateId,
        resourceType: ResourceType,
        amount: number,
        position: THREE.Vector3,
        screenHost: ScreenAnchorHost,
        footprint: { width: number; depth: number },
        targetWorldPosition: THREE.Vector3,
        onComplete: () => void,
    ) {
        super();
        this.gateId = gateId;
        this.resourceType = resourceType;
        this.amount = amount;
        this.screenHost = screenHost;
        this.footprint = footprint;
        this.targetWorldPosition = targetWorldPosition;
        this.onComplete = onComplete;
        this.transform.position.copy(position);
    }

    public override awake(): void {
        const halfExtents = new THREE.Vector3(this.footprint.width / 2, HALF_EXTENTS_Y, this.footprint.depth / 2);
        const centerOffset = new THREE.Vector3(0, halfExtents.y, 0);

        const rigidBody = this.addComponent(new RigidBody({
            halfExtents,
            isStatic: true,
            isTrigger: true,
            layer: Layers.Trigger,
            centerOffset,
        }));
        this.addComponent(new DottedZoneVisualComponent(
            halfExtents.x * 2,
            halfExtents.z * 2,
            DROPPER_ZONE_CORNER_RADIUS,
            { color: DROPPER_ZONE_COLOR },
            centerOffset,
        ));

        rigidBody.onTriggerEnter.add(other => this.tryDeposit(other));
        rigidBody.onTriggerStay.add(other => this.tryDeposit(other));
        rigidBody.onTriggerExit.add(other => this.handleTriggerExit(other));
    }

    private tryDeposit(other: RigidBody): void {
        const player = other.entity;
        if (!(player instanceof MainPlayer) || this.done) {
            return;
        }

        this.isPlayerInside = true;
        this.player = player;
        this.flyInResource();
    }

    private handleTriggerExit(other: RigidBody): void {
        if (other.entity !== this.player) {
            return;
        }
        this.isPlayerInside = false;
        this.player = undefined;
    }

    /** Same per-unit polling loop shape as BuildingZone.flyInResource() — re-checks isPlayerInside/remaining need/backpack count before every single unit rather than a fixed burst computed once at trigger time. */
    private flyInResource(): void {
        if (this.draining || this.done) {
            return;
        }
        this.draining = true;

        const icon = getAssetIcon(resolveResourceAssetKey(this.resourceType));

        const step = (): void => {
            if (this.done) {
                this.draining = false;
                return;
            }

            const remaining = this.amount - GateStorage.getDepositProgress(this.gateId) - this.inFlight;
            const fromWorld = this.isPlayerInside && remaining > 0 && BackpackStorage.getCount(this.resourceType) - this.inFlight > 0
                ? this.player?.getComponent(CharacterVisualComponent)?.character.getBackpackWorldPosition()
                : undefined;

            if (!fromWorld) {
                this.draining = false;
                return;
            }

            this.inFlight++;
            spawnFlyingResourceIcon(this.screenHost, fromWorld.clone(), this.targetWorldPosition.clone(), icon, () => {
                this.inFlight--;
                if (!BackpackStorage.removeOne(this.resourceType)) {
                    return;
                }

                GateStorage.addDepositProgress(this.gateId, 1);
                if (!this.done && GateStorage.getDepositProgress(this.gateId) >= this.amount) {
                    this.done = true;
                    this.onComplete();
                }
            });

            gsap.delayedCall(FLY_IN_STAGGER_SEC, step);
        };

        step();
    }
}
