// MartZone.ts
//
// The world entity for a MartTypes.ts general store — a totally different
// interaction shape from ShopZone's own continuous-coin-drain-while-inside
// upgrade ladder (see MartTypes.ts's own top doc for why marts are their own
// registry). Player walks in -> a small "Open Shop" button appears -> tapping
// it freezes player movement and opens a MartPopup (buy/sell tabs) via
// PopupManager. MartPopup's own onClosed() hook (see Popup.ts's own doc) is
// what un-freezes movement again, regardless of whether the popup was closed
// via its own X button, tapping the darkened backdrop, or getting replaced
// by some other popup entirely — this zone never has to poll for "is my
// popup still open."
//
// Same dropper-or-own-footprint trigger resolution as ShopZone/BuildingZone
// (see PizzaScene.setupMarts()'s own doc): a Tiled "dropper" object
// targeting this mart's id stands in for its own footprint as the PLAYER-
// FACING trigger when a level designer has placed one — e.g. a mart stall
// drawn against a wall the player can't walk into, with its real
// interaction spot placed elsewhere. Unlike ShopZone's own passive price
// panel (which stays anchored to the shop's own position regardless), the
// "Open Shop" button here follows the TRIGGER's own position instead — this
// is a button the player has to actually be standing at to tap, not a
// from-a-distance readout, so it needs to show up wherever they really are.
// The mart's own visual mesh is UNAFFECTED either way — it stays exactly
// where `position`/`footprint` say.
//
// Optional real mesh via MartConfig.view (see EntityViewRegistry.ts), same
// resolveEntityView()-or-placeholder-box fallback every other zone in this
// game uses.

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
import { MartConfig } from '../data/MartTypes';
import { resolveEntityView } from '../world/EntityViewRegistry';
import { getZoneColor, ZoneColorKind } from '../data/ZoneColorTypes';
import MainPlayer from '../player/MainPlayer';
import MartPopup from '../ui/popups/MartPopup';
import { PopupManager } from '../ui/popups/PopupManager';

const MART_ZONE_CORNER_RADIUS = 0.2;
const PLACEHOLDER_HEIGHT = 1.5;
const PLACEHOLDER_COLOR = 0x4a6fa5;
/** How far above the trigger's own ground-level position the "Open Shop" button floats — raised a bit further than a first pass to give the frame's own arrow (see BUTTON_FRAME_PADDING's own doc) clean room below the label without crowding the player's own head. */
const BUTTON_HEIGHT_OFFSET = new THREE.Vector3(0, 2.6, 0);
/** 'FarmFrame's own baked-in speech-bubble tail needs real clearance below the content to render cleanly (its 9-slice border widths are a fixed 30px, see FrameRegistry.ts's own DEFAULT_PADDING_BUBBLE) — same order of magnitude as CraftZone's/FarmZone's own LABEL_FRAME_PADDING (15), which never shows this overlap since their content (a real icon + requirement rows) is naturally tall enough on its own; see buildOpenShopButton()'s own doc on why this button's short text-only content needed BOTH this bump and an explicit spacer to get the same clearance. */
const BUTTON_FRAME_PADDING = uniformFitPadding(20);
const BUTTON_WIDTH = 160;
const BUTTON_HEIGHT = 52;

/** A separate deposit-trigger rect, in WORLD space — from a Tiled "dropper" object targeting this mart (see this file's own top doc). Same shape as ShopZone's own ShopTriggerArea/BuildingZone's own BuildingTriggerArea. */
export interface MartTriggerArea {
    position: THREE.Vector3;
    footprint: { width: number; depth: number };
}

export default class MartZone extends Entity {
    private readonly screenHost: ScreenAnchorHost;
    private readonly martId: string;
    private readonly config: MartConfig;
    private readonly footprint: { width: number; depth: number };
    /** Optional separate trigger area from a Tiled dropper — see this file's own top doc. Undefined means "trigger the mart's own footprint," same convention ShopZone/BuildingZone use. */
    private readonly triggerArea?: MartTriggerArea;
    /** PizzaScene's own reference-counted freeze/unfreeze pair (see that file's own doc on movementFreezeCount) — passed in as closures, same "caller owns the real implementation, this zone just calls it" convention every other cross-cutting PizzaScene service (getWalletOverlayPosition, onPurchased, ...) already uses across every zone type in this game. */
    private readonly freezePlayerMovement: () => void;
    private readonly unfreezePlayerMovement: () => void;

    private isPlayerInside = false;
    private buttonContent!: AutoFitFrame;

    public constructor(
        position: THREE.Vector3,
        screenHost: ScreenAnchorHost,
        martId: string,
        footprint: { width: number; depth: number },
        config: MartConfig,
        freezePlayerMovement: () => void,
        unfreezePlayerMovement: () => void,
        triggerArea?: MartTriggerArea,
    ) {
        super();
        this.screenHost = screenHost;
        this.martId = martId;
        this.footprint = footprint;
        this.config = config;
        this.freezePlayerMovement = freezePlayerMovement;
        this.unfreezePlayerMovement = unfreezePlayerMovement;
        this.triggerArea = triggerArea;
        this.transform.position.copy(position);
    }

    public override update(delta: number): void {
        super.update(delta);
        // Gate ON TOP of whatever ScreenAnchorComponent's own maxDistance already decided —
        // same "runs after, has final say" idiom FarmPlotTile's own picker gate uses — so the
        // button only ever shows while the player is genuinely standing in this trigger.
        if (!this.isPlayerInside) {
            this.buttonContent.visible = false;
        }
    }

    public override awake(): void {
        // Trigger footprint (X/Z) matches this.triggerArea's footprint when a separate dropper
        // trigger was given, else the mart's own footprint — same reasoning as
        // ShopZone.awake()/BuildingZone.awake()'s identical computation.
        const triggerFootprint = this.triggerArea?.footprint ?? this.footprint;
        const halfExtents = new THREE.Vector3(triggerFootprint.width / 2, PLACEHOLDER_HEIGHT, triggerFootprint.depth / 2);

        // centerOffset is relative to THIS entity's own transform.position (the mart's visual
        // position) — converting triggerArea's ABSOLUTE world position to an X/Z offset from
        // here is what lets the trigger sit somewhere else on the map while the visual mesh
        // stays exactly where `position` says — same as ShopZone.awake().
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

        // Traces the ACTUAL interaction trigger's own footprint/position on the floor — same
        // dotted-outline technique as ShopZone/QueueZone/DropZone/BuildingZone. Needed
        // independently of the mart's own visual mesh below since a triggerArea (a Tiled
        // "dropper") can sit anywhere on the map, entirely apart from where the mart itself is
        // drawn.
        this.addComponent(new DottedZoneVisualComponent(
            halfExtents.x * 2,
            halfExtents.z * 2,
            MART_ZONE_CORNER_RADIUS,
            { color: getZoneColor(ZoneColorKind.MartDropper) },
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

        this.buildOpenShopButton();
    }

    private buildOpenShopButton(): void {
        // Locks row's own reported bounds to the FULL nominal BUTTON_WIDTH x BUTTON_HEIGHT box —
        // without this, AutoFitFrame.fit() measures only the label's own tight rendered bounds
        // (a single short line of text), producing a frame far smaller than 'FarmFrame's own
        // baked-in speech-bubble tail needs to clear, which is what made that tail visibly
        // overlap the label instead of sitting cleanly below it. Same "invisible spacer" trick
        // InventoryPopup/MartPopup already use for their own fixed-size bodies.
        const spacer = new PIXI.Graphics();
        spacer.beginFill(0x000000, 0).drawRect(0, 0, BUTTON_WIDTH, BUTTON_HEIGHT).endFill();

        const label = new PIXI.Text('Open Shop', TextStyleRegistry.Inventory);
        label.anchor.set(0.5, 0.5);
        label.position.set(BUTTON_WIDTH / 2, BUTTON_HEIGHT / 2);

        const row = new PIXI.Container();
        row.addChild(spacer, label);
        row.eventMode = 'static';
        row.cursor = 'pointer';
        row.on('pointertap', () => this.openMart());

        this.buttonContent = new AutoFitFrame(BUTTON_FRAME_PADDING, 'FarmFrame', row);

        // Anchors to the TRIGGER's own position (this.triggerArea, when a dropper stands in for
        // one — falls back to this entity's own position otherwise) rather than the mart's own
        // visual position — see this file's own top doc for why: this button has to show up
        // wherever the player actually needs to stand to tap it.
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

    /** Freezes movement, opens this mart's MartPopup, and wires the popup's own onClosed() hook (see Popup.ts's own doc) straight back to unfreezePlayerMovement() — that hook fires no matter how the popup actually closes (X button, backdrop tap, replaced by another popup), so this is the ONLY freeze/unfreeze pairing this zone ever needs, with no "did the popup actually close" tracking of its own. */
    private openMart(): void {
        if (!this.isPlayerInside) {
            return;
        }
        this.freezePlayerMovement();
        PopupManager.instance.show(new MartPopup(this.martId, this.config, this.unfreezePlayerMovement));
    }
}
