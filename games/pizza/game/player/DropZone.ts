// DropZone.ts
//
// Where the player automatically deposits everything in its backpack —
// the design doc's "entering the build zone automatically deposits carried
// resources." A static trigger (Layers.Trigger); on the PLAYER entering,
// drains its BackpackComponent and, for each resource type that came out,
// spawns a short-lived floating "+N Wood" popup using ScreenAnchorComponent
// — the centralized 3D-point-tracking system, not anything drop-zone-
// specific — anchored above this zone.
//
// Listens on ITS OWN RigidBody rather than the player's, so it never needs
// to know MainPlayer exists beyond checking `other.entity instanceof
// MainPlayer` — MainPlayer doesn't need to know DropZone exists at all.

import * as THREE from 'three';
import * as PIXI from 'pixi.js';
import Entity from '../ecs/Entity';
import RigidBody from '../physics/RigidBody';
import { Layers } from '../physics/PhysicsConstants';
import BoxVisualComponent from '../components/BoxVisualComponent';
import ScreenAnchorComponent, { ScreenAnchorHost } from '../components/ScreenAnchorComponent';
import { RESOURCE_CONFIG } from '../actions/ResourceTypes';
import MainPlayer from './MainPlayer';

const HALF_EXTENTS = new THREE.Vector3(1.25, 0.75, 1.25);
/** How far above the zone the deposit popup floats. */
const POPUP_HEIGHT_OFFSET = new THREE.Vector3(0, HALF_EXTENTS.y * 2 + 0.5, 0);
/** How long a single deposit popup stays up before it's torn down. */
const POPUP_LIFETIME_SEC = 1.5;

/** Builds the actual Pixi content for a deposit popup — plain PIXI.Text by default. Injectable (see the constructor) so DropZone's trigger/backpack-draining logic stays testable headlessly, where PIXI.Text can't construct at all (needs a real canvas/`document` — see scripts/test-gather.ts). */
function defaultCreatePopupContent(label: string, amount: number): PIXI.Container {
    const text = new PIXI.Text(`+${amount} ${label}`, {
        fontFamily: 'Arial',
        fontSize: 16,
        fill: 0xffffff,
        stroke: 0x000000,
        strokeThickness: 3,
    });
    text.anchor.set(0.5, 1);
    return text;
}

export default class DropZone extends Entity {
    private readonly screenHost: ScreenAnchorHost;
    private readonly createPopupContent: (label: string, amount: number) => PIXI.Container;
    /** Popups currently counting down — ticked in update() alongside whatever ScreenAnchorComponent instances back them (see spawnPopup()). */
    private readonly popups: Array<{ entity: Entity; remainingSec: number }> = [];

    public constructor(position: THREE.Vector3, screenHost: ScreenAnchorHost, createPopupContent: (label: string, amount: number) => PIXI.Container = defaultCreatePopupContent) {
        super();
        this.screenHost = screenHost;
        this.createPopupContent = createPopupContent;
        this.transform.position.copy(position);
    }

    public override awake(): void {
        const rigidBody = this.addComponent(new RigidBody({
            halfExtents: HALF_EXTENTS,
            isStatic: true,
            isTrigger: true,
            layer: Layers.Trigger,
            centerOffset: new THREE.Vector3(0, HALF_EXTENTS.y, 0),
        }));
        this.addComponent(new BoxVisualComponent(
            HALF_EXTENTS.clone().multiplyScalar(2),
            0x33cc66,
            new THREE.Vector3(0, HALF_EXTENTS.y, 0),
        ));

        rigidBody.onTriggerEnter.add(other => this.tryDeposit(other));
    }

    public override update(delta: number): void {
        super.update(delta);

        for (let i = this.popups.length - 1; i >= 0; i--) {
            const popup = this.popups[i];
            popup.remainingSec -= delta;
            if (popup.remainingSec <= 0) {
                this.world?.despawn(popup.entity);
                this.popups.splice(i, 1);
            }
        }
    }

    private tryDeposit(other: RigidBody): void {
        const player = other.entity;
        if (!(player instanceof MainPlayer)) {
            return;
        }

        const drained = player.backpack.drainAll();
        if (drained.size === 0) {
            return;
        }

        for (const [type, amount] of drained) {
            console.log(`[deposit] +${amount} ${RESOURCE_CONFIG[type].label}`);
            this.spawnPopup(RESOURCE_CONFIG[type].label, amount);
        }
    }

    /** A tiny, self-contained Entity — just a ScreenAnchorComponent wrapping whatever createPopupContent() builds — spawned per deposited resource type and torn down after POPUP_LIFETIME_SEC (see update()). */
    private spawnPopup(label: string, amount: number): void {
        if (!this.world) {
            return;
        }

        const content = this.createPopupContent(label, amount);
        const popupEntity = this.world.spawn();
        const targetPosition = this.transform.position.clone().add(POPUP_HEIGHT_OFFSET);
        popupEntity.addComponent(new ScreenAnchorComponent(this.screenHost, content, () => targetPosition));

        this.popups.push({ entity: popupEntity, remainingSec: POPUP_LIFETIME_SEC });
    }
}
