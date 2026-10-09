// FarmDeskZone.ts
//
// The farm manager's interaction spot (see FarmDeskTypes.ts for the map setup) — same shape as
// the store's HireDeskZone: walk onto the spot -> a button appears -> tapping it freezes movement
// and opens FarmUpgradesPopup, whose onClosed() un-freezes it again. The NPC itself is spawned by
// PizzaScene.setupFarmDesks(); this zone is only trigger + button (+ an exclamation badge while
// some farm upgrade is affordable).

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
import FarmUpgradesPopup, { canAffordAnyFarmUpgrade } from '../ui/popups/FarmUpgradesPopup';
import { STAFF_ALERT_TEXTURE } from '../store/StaffUpgradeAlert';
import type { FarmDeskConfig } from '../data/FarmDeskTypes';

const TRIGGER_HALF_HEIGHT = 0.75;
const CORNER_RADIUS = 0.2;
/** How far above the spot's ground position the button floats. */
const BUTTON_HEIGHT_OFFSET = new THREE.Vector3(0, 3, 0);
const BUTTON_WIDTH = 160;
const BUTTON_HEIGHT = 52;
/** Same badge size as HireDeskZone's. */
const ALERT_SIZE = 28;

export default class FarmDeskZone extends Entity {
    private readonly config: FarmDeskConfig;
    private readonly footprint: { width: number; depth: number };
    private readonly screenHost: ScreenAnchorHost;
    /** Every farm on the map — the popup lists the owned ones. */
    private readonly farmIds: readonly string[];
    private readonly freezePlayerMovement: () => void;
    private readonly unfreezePlayerMovement: () => void;

    private isPlayerInside = false;
    private buttonContent!: BaseButton;
    private alertShown = false;

    public constructor(
        config: FarmDeskConfig,
        position: THREE.Vector3,
        footprint: { width: number; depth: number },
        screenHost: ScreenAnchorHost,
        farmIds: readonly string[],
        freezePlayerMovement: () => void,
        unfreezePlayerMovement: () => void,
    ) {
        super();
        this.config = config;
        this.footprint = footprint;
        this.screenHost = screenHost;
        this.farmIds = farmIds;
        this.freezePlayerMovement = freezePlayerMovement;
        this.unfreezePlayerMovement = unfreezePlayerMovement;
        this.transform.position.copy(position);
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

        this.addComponent(new DottedZoneVisualComponent(width, depth, CORNER_RADIUS, { color: getZoneColor(ZoneColorKind.MartDropper) }));

        this.buttonContent = createLibraryButton({
            color: 'green',
            width: BUTTON_WIDTH, height: BUTTON_HEIGHT,
            label: this.config.buttonLabel ?? 'Farms',
            onClick: () => this.open(),
        });
        const anchorPosition = new THREE.Vector3();
        this.addComponent(new ScreenAnchorComponent(
            this.screenHost,
            this.buttonContent,
            () => anchorPosition.copy(this.transform.position).add(BUTTON_HEIGHT_OFFSET),
            // Same options as HireDeskZone's own button.
            { avoidViewer: true, anchor: { x: 0.5, y: 1 }, pointerEdgePadding: 8 },
        ));
    }

    public override update(delta: number): void {
        super.update(delta);
        // Same "only while actually standing here" final say as HireDeskZone.update().
        if (!this.isPlayerInside) {
            this.buttonContent.visible = false;
        }
        this.refreshAlert();
    }

    /** Exclamation badge on the button while some owned farm's next upgrade is affordable. Only touches the button when the state flips. */
    private refreshAlert(): void {
        const show = canAffordAnyFarmUpgrade(this.farmIds);
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

    private open(): void {
        if (!this.isPlayerInside) {
            return;
        }
        this.freezePlayerMovement();
        PopupManager.instance.show(new FarmUpgradesPopup(this.config.name ?? 'Farm Manager', this.farmIds, this.unfreezePlayerMovement));
    }
}
