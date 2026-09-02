// CraftingTableZone.ts
//
// The world entity for a CraftingTableTypes.ts crafting table — same "walk
// in -> a small 'Open' button appears -> tapping it freezes player movement
// and opens a popup, whose own onClosed() hook unfreezes movement again
// regardless of how it closed" shape as MartZone.ts (see that file's own top
// doc — this is a near-verbatim structural copy, popup swapped for
// CraftingTablePopup). NOT related to the existing CraftZone.ts (a totally
// different, unrelated single-active-recipe/auto-drain entity) — see
// CraftingTableTypes.ts's own top doc for why these are two separate
// systems.
//
// Same dropper-or-own-footprint trigger resolution as MartZone/ShopZone/
// BuildingZone (see PizzaScene.setupCraftingTables()'s own doc): a Tiled
// "dropper" object targeting this table's id stands in for its own
// footprint as the PLAYER-FACING trigger when a level designer has placed
// one. The "Open" button follows the TRIGGER's own position, same reasoning
// as MartZone's own "Open Shop" button.
//
// Optional real mesh via CraftingTableConfig.view (see EntityViewRegistry.ts),
// same resolveEntityView()-or-placeholder-box fallback every other zone in
// this game uses.

import * as THREE from 'three';
import * as PIXI from 'pixi.js';
import Entity from '../ecs/Entity';
import RigidBody from '../physics/RigidBody';
import { Layers } from '../physics/PhysicsConstants';
import { buildSolidArea } from '../physics/SolidArea';
import DottedZoneVisualComponent from '../components/DottedZoneVisualComponent';
import BoxVisualComponent from '../components/BoxVisualComponent';
import GlbVisualComponent from '../components/GlbVisualComponent';
import ScreenAnchorComponent, { ScreenAnchorHost } from '../components/ScreenAnchorComponent';
import AutoFitFrame, { uniformFitPadding } from '../ui/AutoFitFrame';
import { TextStyleRegistry } from '../ui/TextStyleRegistry';
import { CraftingTableConfig } from '../data/CraftingTableTypes';
import { resolveEntityView } from '../world/EntityViewRegistry';
import { getZoneColor, ZoneColorKind } from '../data/ZoneColorTypes';
import MainPlayer from '../player/MainPlayer';
import CraftingTablePopup from '../ui/popups/CraftingTablePopup';
import { PopupManager } from '../ui/popups/PopupManager';

const TABLE_ZONE_CORNER_RADIUS = 0.2;
const PLACEHOLDER_HEIGHT = 1.5;
const PLACEHOLDER_COLOR = 0x7a5a3a;
/** Same value/reasoning as MartZone.BUTTON_HEIGHT_OFFSET's own doc. */
const BUTTON_HEIGHT_OFFSET = new THREE.Vector3(0, 2.6, 0);
/** Same value/reasoning as MartZone.BUTTON_FRAME_PADDING's own doc. */
const BUTTON_FRAME_PADDING = uniformFitPadding(20);
const BUTTON_WIDTH = 160;
const BUTTON_HEIGHT = 52;

/** A separate deposit-trigger rect, in WORLD space — from a Tiled "dropper" object targeting this table (see this file's own top doc). Same shape as MartZone's own MartTriggerArea. */
export interface CraftingTableTriggerArea {
    position: THREE.Vector3;
    footprint: { width: number; depth: number };
}

export default class CraftingTableZone extends Entity {
    private readonly screenHost: ScreenAnchorHost;
    private readonly tableId: string;
    private readonly config: CraftingTableConfig;
    private readonly footprint: { width: number; depth: number };
    private readonly triggerArea?: CraftingTableTriggerArea;
    private readonly freezePlayerMovement: () => void;
    private readonly unfreezePlayerMovement: () => void;

    private isPlayerInside = false;
    private buttonContent!: AutoFitFrame;

    public constructor(
        position: THREE.Vector3,
        screenHost: ScreenAnchorHost,
        tableId: string,
        footprint: { width: number; depth: number },
        config: CraftingTableConfig,
        freezePlayerMovement: () => void,
        unfreezePlayerMovement: () => void,
        triggerArea?: CraftingTableTriggerArea,
    ) {
        super();
        this.screenHost = screenHost;
        this.tableId = tableId;
        this.footprint = footprint;
        this.config = config;
        this.freezePlayerMovement = freezePlayerMovement;
        this.unfreezePlayerMovement = unfreezePlayerMovement;
        this.triggerArea = triggerArea;
        this.transform.position.copy(position);
    }

    public override update(delta: number): void {
        super.update(delta);
        if (!this.isPlayerInside) {
            this.buttonContent.visible = false;
        }
    }

    public override awake(): void {
        const triggerFootprint = this.triggerArea?.footprint ?? this.footprint;
        const halfExtents = new THREE.Vector3(triggerFootprint.width / 2, PLACEHOLDER_HEIGHT, triggerFootprint.depth / 2);

        const centerOffset = new THREE.Vector3(0, halfExtents.y, 0);
        if (this.triggerArea) {
            centerOffset.x = this.triggerArea.position.x - this.transform.position.x;
            centerOffset.z = this.triggerArea.position.z - this.transform.position.z;
        }

        const rigidBody = this.addComponent(new RigidBody({
            halfExtents,
            isStatic: true,
            isTrigger: true,
            layer: Layers.Trigger,
            centerOffset,
        }));
        rigidBody.onTriggerEnter.add(other => this.handleTriggerEnter(other));
        rigidBody.onTriggerExit.add(other => this.handleTriggerExit(other));

        const solidArea = buildSolidArea(halfExtents, centerOffset, this.config.solid ?? 0);
        if (solidArea) {
            this.addComponent(solidArea);
        }

        this.addComponent(new DottedZoneVisualComponent(
            halfExtents.x * 2,
            halfExtents.z * 2,
            TABLE_ZONE_CORNER_RADIUS,
            { color: getZoneColor(ZoneColorKind.CraftingTableDropper) },
            centerOffset,
        ));

        const resolved = resolveEntityView(this.config.view);
        if (resolved) {
            const [offsetX, offsetY, offsetZ] = resolved.offset;
            this.addComponent(new GlbVisualComponent(
                resolved.model,
                new THREE.Vector3(offsetX, offsetY, offsetZ),
                resolved.scale,
                THREE.MathUtils.degToRad(resolved.rotationDeg),
            ));
        } else {
            this.addComponent(new BoxVisualComponent(
                new THREE.Vector3(this.footprint.width, PLACEHOLDER_HEIGHT, this.footprint.depth),
                PLACEHOLDER_COLOR,
                new THREE.Vector3(0, PLACEHOLDER_HEIGHT / 2, 0),
            ));
        }

        this.buildOpenButton();
    }

    private buildOpenButton(): void {
        const spacer = new PIXI.Graphics();
        spacer.beginFill(0x000000, 0).drawRect(0, 0, BUTTON_WIDTH, BUTTON_HEIGHT).endFill();

        const label = new PIXI.Text('Craft', TextStyleRegistry.Inventory);
        label.anchor.set(0.5, 0.5);
        label.position.set(BUTTON_WIDTH / 2, BUTTON_HEIGHT / 2);

        const row = new PIXI.Container();
        row.addChild(spacer, label);
        row.eventMode = 'static';
        row.cursor = 'pointer';
        row.on('pointertap', () => this.openTable());

        this.buttonContent = new AutoFitFrame(BUTTON_FRAME_PADDING, 'FarmFrame', row);

        const triggerPosition = this.triggerArea?.position ?? this.transform.position;
        const anchorPosition = new THREE.Vector3();
        this.addComponent(new ScreenAnchorComponent(
            this.screenHost,
            this.buttonContent,
            () => anchorPosition.copy(triggerPosition).add(BUTTON_HEIGHT_OFFSET),
            { avoidViewer: true, anchor: { x: 0.5, y: 1 } },
        ));
    }

    private handleTriggerEnter(other: RigidBody): void {
        if (other.entity instanceof MainPlayer) {
            this.isPlayerInside = true;
        }
    }

    private handleTriggerExit(other: RigidBody): void {
        if (other.entity instanceof MainPlayer) {
            this.isPlayerInside = false;
        }
    }

    private openTable(): void {
        if (!this.isPlayerInside) {
            return;
        }
        this.freezePlayerMovement();
        PopupManager.instance.show(new CraftingTablePopup(this.tableId, this.config, this.unfreezePlayerMovement));
    }
}
