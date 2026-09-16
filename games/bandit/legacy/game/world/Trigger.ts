// Trigger.ts
//
// The runtime entity for one placed "trigger" mapSettings object (see TriggerTypes.ts's own doc
// for the design intent) — a trigger-only RigidBody (same shape as GateDropZone/BuildingZone/
// QueueZone's own deposit triggers, just with no deposit/drain behavior of its own) that marks
// its own id activated (`onActivated`, wired by PizzaScene to TriggerStorage.activate() + a
// requirement recheck — see setupTriggers()'s own doc) the instant MainPlayer enters, then
// either removes itself (destroyOnTrigger) or stands ready to re-activate on the next entry.
//
// Shown with the same DottedZoneVisualComponent floor outline GateDropZone.ts uses for its own
// deposit area — a player has no other way to see where an invisible collider actually is, and
// "the collider should be visible, same as a dropper" is exactly what every other deposit-style
// trigger in this game already does.

import * as THREE from 'three';
import Entity from '../ecs/Entity';
import RigidBody from '../physics/RigidBody';
import { Layers } from '../physics/PhysicsConstants';
import DottedZoneVisualComponent from '../components/DottedZoneVisualComponent';
import MainPlayer from '../player/MainPlayer';
import { getZoneColor, ZoneColorKind } from '../data/ZoneColorTypes';

/** Same fixed trigger height every other footprint-only trigger volume in this game uses (GateDropZone/BuildingZone/QueueZone) — a trigger's own Tiled footprint has no vertical dimension to derive one from either. */
const HALF_EXTENTS_Y = 0.75;
const TRIGGER_ZONE_CORNER_RADIUS = 0.3;

export default class Trigger extends Entity {
    private readonly footprint: { width: number; depth: number };
    private readonly destroyOnTrigger: boolean;
    private readonly onActivated: () => void;

    /**
     * Guards a second overlapping onTriggerEnter call (RigidBody's own trigger events can fire
     * more than once per genuine entry — see other trigger entities' own `draining`/`done`
     * guards for the same reason) from re-activating within the same entry. Reset right back to
     * false for a non-destroying trigger (see this file's own doc on why that one DELIBERATELY
     * re-activates on every subsequent entry) — only a destroyOnTrigger firing leaves it
     * permanently true, moot anyway once world.remove() tears the entity down.
     */
    private fired = false;

    public constructor(
        position: THREE.Vector3,
        footprint: { width: number; depth: number },
        destroyOnTrigger: boolean,
        onActivated: () => void,
    ) {
        super();
        this.footprint = footprint;
        this.destroyOnTrigger = destroyOnTrigger;
        this.onActivated = onActivated;
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
            TRIGGER_ZONE_CORNER_RADIUS,
            { color: getZoneColor(ZoneColorKind.Trigger) },
            centerOffset,
        ));

        rigidBody.onTriggerEnter.add(other => this.handleTriggerEnter(other));
    }

    private handleTriggerEnter(other: RigidBody): void {
        if (!(other.entity instanceof MainPlayer) || this.fired) {
            return;
        }
        this.fired = true;

        this.onActivated();

        if (this.destroyOnTrigger) {
            this.world?.remove(this);
        } else {
            this.fired = false;
        }
    }
}
