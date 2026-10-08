// StoreCashier.ts
//
// The store's cashier spot — a trigger over the "storeCashier" rect that only
// tracks whether the player is standing in it. Store.ts reads isPlayerInside()
// to decide when the client at the front of the cashier line pays. Also draws
// the counter: the map's own model targeting this cashier (StoreLayout's
// cashierMesh — placed/rotated/solid exactly as drawn, see MapMeshVisual.ts),
// else StoreConfig.cashierView in the middle of the rect (StorePropVisual.ts).
// The player serves standing against it.
//
// setNeedsService(true) (Store: a client is waiting to pay and nobody is serving) shows a
// bobbing '!' high over the counter (ui/AlertIcon.ts) so the player knows to come over.

import * as THREE from 'three';
import Entity from '../ecs/Entity';
import RigidBody from '../physics/RigidBody';
import { Layers } from '../physics/PhysicsConstants';
import DottedZoneVisualComponent from '../components/DottedZoneVisualComponent';
import { getZoneColor, ZoneColorKind } from '../data/ZoneColorTypes';
import MainPlayer from '../player/MainPlayer';
import { StoreRect } from './StoreLayout';
import { addStorePropVisual } from './StorePropVisual';
import { addMapMeshVisual } from '../world/MapMeshVisual';
import { MeshPlacement } from '../world/MeshLayerSpawner';
import { FloorLayers } from '../world/FloorLayers';
import ScreenAnchorComponent, { ScreenAnchorHost } from '../components/ScreenAnchorComponent';
import { createAlertIcon, destroyAlertIcon } from '../ui/AlertIcon';
import { STORE_ALERT_ANCHOR_OPTIONS } from './StoreAlertConfig';

const TRIGGER_HALF_HEIGHT = 0.75;
const CORNER_RADIUS = 0.3;
/** The '!' floats this high over the cashier rect's center (world units). */
const ALERT_HEIGHT = 2.6;
const ALERT_SIZE = 52;

export default class StoreCashier extends Entity {
    private readonly rect: StoreRect;
    private readonly viewId?: string;
    /** The map's own counter model for this cashier, if any — wins over viewId. */
    private readonly mesh?: MeshPlacement;
    private player?: MainPlayer;
    private counterShown = false;
    private readonly screenHost?: ScreenAnchorHost;
    private alertIcon?: ReturnType<typeof createAlertIcon>;
    private alertAnchor?: ScreenAnchorComponent;
    private needsService = false;

    /** Draw the dotted floor outline — off when the store sets hideCashierDropperView (see StoreConfig). */
    private readonly showOutline: boolean;

    public constructor(rect: StoreRect, viewId?: string, mesh?: MeshPlacement, showOutline = true, screenHost?: ScreenAnchorHost) {
        super();
        this.screenHost = screenHost;
        this.rect = rect;
        this.viewId = viewId;
        this.mesh = mesh;
        this.showOutline = showOutline;
        this.transform.position.set(rect.x, FloorLayers.baseY, rect.z);
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
        if (this.showOutline) {
            this.addComponent(new DottedZoneVisualComponent(this.rect.width, this.rect.depth, CORNER_RADIUS, { color: getZoneColor(ZoneColorKind.Queue) }));
        }

        rigidBody.onTriggerEnter.add(other => this.handleEnter(other));
        rigidBody.onTriggerStay.add(other => this.handleEnter(other));
        rigidBody.onTriggerExit.add(other => {
            if (other.entity === this.player) {
                this.player = undefined;
            }
        });
    }

    /** Draws the counter (and its collider) — Store calls this once the store opens, so a closed store has no invisible wall where its hidden counter would be. */
    public showCounter(): void {
        if (!this.counterShown) {
            this.counterShown = true;
            if (!this.mesh || !addMapMeshVisual(this, this.mesh)) {
                addStorePropVisual(this, this.viewId);
            }
        }
    }

    public isPlayerInside(): boolean {
        return this.player !== undefined;
    }

    /** Shows/hides the '!' over the counter — see this file's own doc. */
    public setNeedsService(needs: boolean): void {
        if (needs === this.needsService) {
            return;
        }
        this.needsService = needs;
        if (needs && !this.alertAnchor && this.screenHost) {
            this.alertIcon = createAlertIcon('exclamation', ALERT_SIZE);
            const target = new THREE.Vector3();
            this.alertAnchor = this.addComponent(new ScreenAnchorComponent(
                this.screenHost,
                this.alertIcon,
                () => target.copy(this.transform.position).setY(this.transform.position.y + ALERT_HEIGHT),
                STORE_ALERT_ANCHOR_OPTIONS,
            ));
        }
        this.alertAnchor?.setForceHidden(!needs);
    }

    public override destroy(): void {
        if (this.alertIcon) {
            destroyAlertIcon(this.alertIcon);
        }
        super.destroy();
    }

    private handleEnter(other: RigidBody): void {
        if (other.entity instanceof MainPlayer) {
            this.player = other.entity;
        }
    }
}
