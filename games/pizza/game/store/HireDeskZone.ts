// HireDeskZone.ts
//
// A store's hire desk interaction spot — the dropper targeting a "hireDesk" on the map's
// sections layer (see WorldObjectRegistry.SECTIONS_LAYER_NAME), spawned by
// PizzaScene.setupHireDesks() once the section it sits in is built. Same interaction shape as
// MartZone: walk onto the spot -> a "Hire" button appears -> tapping it freezes movement and
// opens HireWorkersPopup, whose own onClosed() un-freezes it again. The desk's NPC (at the
// hireDesk itself) is spawned by PizzaScene, like a mart's — this zone is only trigger + button.

import * as THREE from 'three';
import * as PIXI from 'pixi.js';
import Entity from '../ecs/Entity';
import RigidBody from '../physics/RigidBody';
import { Layers } from '../physics/PhysicsConstants';
import DottedZoneVisualComponent from '../components/DottedZoneVisualComponent';
import ScreenAnchorComponent, { ScreenAnchorHost } from '../components/ScreenAnchorComponent';
import BaseButton from 'core/ui/BaseButton';
import { createLibraryButton } from '../ui/ButtonLibrary';
import { getZoneColor, ZoneColorKind } from '../data/ZoneColorTypes';
import MainPlayer from '../player/MainPlayer';
import { PopupManager } from '../ui/popups/PopupManager';
import HireWorkersPopup from '../ui/popups/HireWorkersPopup';
import type Store from './Store';
import { canAffordAnyWorkerUpgrade, STAFF_ALERT_TEXTURE } from './StaffUpgradeAlert';

const TRIGGER_HALF_HEIGHT = 0.75;
const CORNER_RADIUS = 0.2;
/** How far above the desk's ground position the "Hire" button floats. */
const BUTTON_HEIGHT_OFFSET = new THREE.Vector3(0, 3, 0);
const BUTTON_WIDTH = 160;
const BUTTON_HEIGHT = 52;
/** Same badge size BackpackButton uses. */
const ALERT_SIZE = 28;

export default class HireDeskZone extends Entity {
    private readonly screenHost: ScreenAnchorHost;
    private readonly storeId: string;
    private readonly footprint: { width: number; depth: number };
    /** Looked up on every tap, not once — the store may not be open yet when the desk spawns. */
    private readonly getStore: () => Store | undefined;
    private readonly freezePlayerMovement: () => void;
    private readonly unfreezePlayerMovement: () => void;

    private isPlayerInside = false;
    private buttonContent!: BaseButton;
    /** Last state refreshAlert() applied. */
    private alertShown = false;
    /** See the constructor's `showOutline` param doc. */
    private readonly showOutline: boolean;

    public constructor(
        position: THREE.Vector3,
        footprint: { width: number; depth: number },
        screenHost: ScreenAnchorHost,
        storeId: string,
        getStore: () => Store | undefined,
        freezePlayerMovement: () => void,
        unfreezePlayerMovement: () => void,
        /** Draw the dotted outline around the desk spot — off when the store sets hideHireDeskDropperView (see StoreConfig). */
        showOutline = true,
    ) {
        super();
        this.showOutline = showOutline;
        this.screenHost = screenHost;
        this.storeId = storeId;
        this.footprint = footprint;
        this.getStore = getStore;
        this.freezePlayerMovement = freezePlayerMovement;
        this.unfreezePlayerMovement = unfreezePlayerMovement;
        this.transform.position.copy(position);
    }

    public override update(delta: number): void {
        super.update(delta);
        // Same "only while actually standing here" final say as MartZone.update().
        if (!this.isPlayerInside) {
            this.buttonContent.visible = false;
        }
        this.refreshAlert();
    }

    /** Exclamation badge on the "Hire" button whenever some worker upgrade is affordable — see StaffUpgradeAlert.ts. Polled per frame (a cheap roster scan); only touches the button when the state flips. */
    private refreshAlert(): void {
        const show = this.getStore()?.isOpen() === true && canAffordAnyWorkerUpgrade(this.storeId);
        if (show === this.alertShown) {
            return;
        }
        this.alertShown = show;
        if (show) {
            this.buttonContent.addAlertIcon(PIXI.Texture.from(STAFF_ALERT_TEXTURE), ALERT_SIZE);
        } else {
            this.buttonContent.removeAlertIcon();
        }
    }

    public override awake(): void {
        const { width, depth } = this.footprint;
        const rigidBody = this.addComponent(new RigidBody({
            halfExtents: new THREE.Vector3(width / 2, TRIGGER_HALF_HEIGHT, depth / 2),
            isStatic: true,
            isTrigger: true,
            layer: Layers.Trigger,
            centerOffset: new THREE.Vector3(0, TRIGGER_HALF_HEIGHT, 0),
        }));
        rigidBody.onTriggerEnter.add(other => {
            if (other.entity instanceof MainPlayer) {
                this.isPlayerInside = true;
            }
        });
        rigidBody.onTriggerExit.add(other => {
            if (other.entity instanceof MainPlayer) {
                this.isPlayerInside = false;
            }
        });

        if (this.showOutline) {
            this.addComponent(new DottedZoneVisualComponent(width, depth, CORNER_RADIUS, { color: getZoneColor(ZoneColorKind.MartDropper) }));
        }

        this.buttonContent = createLibraryButton({
            color: 'blue',
            width: BUTTON_WIDTH, height: BUTTON_HEIGHT,
            label: 'Hire',
            onClick: () => this.openHire(),
        });
        const anchorPosition = new THREE.Vector3();
        this.addComponent(new ScreenAnchorComponent(
            this.screenHost,
            this.buttonContent,
            () => anchorPosition.copy(this.transform.position).add(BUTTON_HEIGHT_OFFSET),
            // Same options as MartZone's own button — see its comment on pointerEdgePadding.
            { avoidViewer: true, anchor: { x: 0.5, y: 1 }, pointerEdgePadding: 8 },
        ));
    }

    private openHire(): void {
        if (!this.isPlayerInside) {
            return;
        }
        this.freezePlayerMovement();
        PopupManager.instance.show(new HireWorkersPopup(this.storeId, this.getStore, this.unfreezePlayerMovement));
    }
}
