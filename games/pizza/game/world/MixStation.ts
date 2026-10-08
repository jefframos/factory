// MixStation.ts
//
// One built mix station (see MixStationTypes.ts for the map setup and config): its model, a
// trigger over its dropper (the MAKING area, outlined) and its labels:
//   - over each ingredient box: that ingredient's icon + what's in the box / what it holds;
//   - over the product box (the dispenser): the product's icon + how many are waiting / room, in
//     a different frame (PRODUCT_FRAME) so it reads as "what this station makes";
//   - a progress bar over the making area, shown ONLY while it's actually making (the player is
//     there and every box holds a batch).
//
// The ingredient boxes and the product box are plain StorageZones built by PizzaScene: each
// ingredient box takes only its resource, up to its capacity (StorageConfig.maxItems), from the
// player standing next to it; the product box is a collect storage. This entity only watches them:
// every box holding at least one batch + the player in the making area + room in the product box
// -> mixing progresses (pausing while the player is out, resetting if a box runs short); when it
// completes, one batch is used up and the product flies to the product box
// (StorageZone.receiveFrom()) — then the next batch starts while the boxes last.

import * as THREE from 'three';
import * as PIXI from 'pixi.js';
import Entity from '../ecs/Entity';
import RigidBody from '../physics/RigidBody';
import { Layers } from '../physics/PhysicsConstants';
import MainPlayer from '../player/MainPlayer';
import ScreenAnchorComponent, { ScreenAnchorHost } from '../components/ScreenAnchorComponent';
import { ZONE_LABEL_ANCHOR_OPTIONS } from '../ui/ZoneLabelConfig';
import AutoFitFrame, { uniformFitPadding } from '../ui/AutoFitFrame';
import type { FrameName } from '../ui/FrameRegistry';
import { createResourceSlot } from '../ui/ResourceSlotVisual';
import { getIconLayout } from '../ui/LayoutRegistry';
import BarComponent from '../ui/BarComponent';
import { MIN_BAR_HEIGHT } from '../ui/BarRegistry';
import { StorageInventory } from '../data/StorageInventory';
import { stackItemScale } from '../components/CarrierStackVisual';
import { getPileScale } from '../components/ItemPile';
import { addMapMeshVisual } from './MapMeshVisual';
import DottedZoneVisualComponent from '../components/DottedZoneVisualComponent';
import { getZoneColor, ZoneColorKind } from '../data/ZoneColorTypes';
import { DEFAULT_MIX_INPUT_CAPACITY } from '../data/MixStationTypes';
import { ResourceType } from '../actions/ResourceTypes';
import type { MeshPlacement } from './MeshLayerSpawner';
import type StorageZone from './StorageZone';
import type { MixStationConfig } from '../data/MixStationTypes';

const TRIGGER_HALF_HEIGHT = 0.75;
/** A box's label floats this far above the box's own spot (on the station's top). */
const LABEL_CLEARANCE = 2;
const LABEL_SCALE = 0.55;
/** Ingredient labels vs the product label — a different frame marks what the station makes. */
const INGREDIENT_FRAME: FrameName = 'QueueFrame';
const PRODUCT_FRAME: FrameName = 'ItemFrame';
/** The progress bar floats this high over the making area. */
const BAR_HEIGHT = 2.6;
const BAR_WIDTH = 110;
const SLOT_LAYOUT = getIconLayout('Requirement');
const MAKING_AREA_CORNER_RADIUS = 0.3;

export interface MixStationRect {
    x: number;
    z: number;
    width: number;
    depth: number;
}

/** One ingredient box — its StorageInventory id and where it stands (world, on the station's top). */
export interface MixStationBox {
    storageId: string;
    position: THREE.Vector3;
}

/** A small framed "icon + count" label — rebuilt only when what it shows changes. */
class BoxLabel {
    public readonly content = new PIXI.Container();
    private readonly body = new PIXI.Container();
    private readonly frame: AutoFitFrame;
    private key = '';

    public constructor(frameName: FrameName) {
        this.frame = new AutoFitFrame(uniformFitPadding(10), frameName, this.body);
        this.frame.scale.set(LABEL_SCALE);
        this.content.addChild(this.frame);
    }

    public show(type: ResourceType, text: string): void {
        const key = `${type}|${text}`;
        if (key === this.key) {
            return;
        }
        this.key = key;
        this.body.removeChildren().forEach(child => child.destroy({ children: true }));
        const slot = createResourceSlot(type, SLOT_LAYOUT.slotSize, text);
        // Bottom-center on the anchor point — by POSITION, not a pivot: AutoFitFrame fits the frame to
        // the body's own local bounds, which a pivot on the body would shift the slot away from.
        slot.container.position.set(-SLOT_LAYOUT.slotSize / 2, -slot.visualHeight);
        this.body.addChild(slot.container);
        this.frame.fit();
    }
}

export default class MixStation extends Entity {
    private readonly config: MixStationConfig;
    private readonly dropper: MixStationRect;
    private readonly mesh?: MeshPlacement;
    private readonly boxes: MixStationBox[];
    private readonly output: StorageZone;
    private readonly outputPosition: THREE.Vector3;
    private readonly screenHost: ScreenAnchorHost;

    private player?: MainPlayer;
    private progress = 0;
    private readonly boxLabels: BoxLabel[] = [];
    private readonly productLabel = new BoxLabel(PRODUCT_FRAME);
    private readonly barContent = new PIXI.Container();
    private readonly bar = new BarComponent('Green', BAR_WIDTH, MIN_BAR_HEIGHT);
    private barAnchor?: ScreenAnchorComponent;

    public constructor(
        config: MixStationConfig,
        position: THREE.Vector3,
        dropper: MixStationRect,
        mesh: MeshPlacement | undefined,
        /** The ingredient boxes, in config.inputs order. */
        boxes: MixStationBox[],
        output: StorageZone,
        /** The product box's spot (world, on the station's top). */
        outputPosition: THREE.Vector3,
        screenHost: ScreenAnchorHost,
    ) {
        super();
        this.config = config;
        this.dropper = dropper;
        this.mesh = mesh;
        this.boxes = boxes;
        this.output = output;
        this.outputPosition = outputPosition;
        this.screenHost = screenHost;
        this.transform.position.copy(position);
    }

    public override awake(): void {
        if (this.mesh && !addMapMeshVisual(this, this.mesh)) {
            console.warn(`[MixStation] "${this.config.name ?? 'mix station'}": model "${this.mesh.modelRef}" doesn't resolve — no mesh`);
        }

        const makingOffset = new THREE.Vector3(this.dropper.x - this.transform.position.x, 0, this.dropper.z - this.transform.position.z);
        const rigidBody = this.addComponent(new RigidBody({
            halfExtents: new THREE.Vector3(this.dropper.width / 2, TRIGGER_HALF_HEIGHT, this.dropper.depth / 2),
            isStatic: true,
            isTrigger: true,
            layer: Layers.Trigger,
            centerOffset: makingOffset.clone().setY(TRIGGER_HALF_HEIGHT),
        }));
        const enter = (other: RigidBody): void => {
            if (other.entity instanceof MainPlayer) {
                this.player = other.entity;
            }
        };
        rigidBody.onTriggerEnter.add(enter);
        rigidBody.onTriggerStay.add(enter);
        rigidBody.onTriggerExit.add(other => {
            if (other.entity === this.player) {
                this.player = undefined;
            }
        });
        // The making area's outline.
        this.addComponent(new DottedZoneVisualComponent(
            this.dropper.width,
            this.dropper.depth,
            MAKING_AREA_CORNER_RADIUS,
            { color: getZoneColor(ZoneColorKind.Queue) },
            makingOffset,
        ));

        // A label over each box, and over the product box.
        this.boxes.forEach(box => {
            const label = new BoxLabel(INGREDIENT_FRAME);
            this.boxLabels.push(label);
            this.anchorAbove(label.content, box.position, LABEL_CLEARANCE);
        });
        this.anchorAbove(this.productLabel.content, this.outputPosition, LABEL_CLEARANCE);

        // The bar, over the making area — hidden unless it's making.
        this.bar.pivot.set(BAR_WIDTH / 2, MIN_BAR_HEIGHT);
        this.barContent.addChild(this.bar);
        const barSpot = new THREE.Vector3(this.dropper.x, this.transform.position.y, this.dropper.z);
        this.barAnchor = this.anchorAbove(this.barContent, barSpot, BAR_HEIGHT);
        this.barAnchor.setForceHidden(true);

        this.refreshLabels(false);
    }

    public override update(delta: number): void {
        super.update(delta);

        const ready = this.hasIngredients() && this.output.getFillCount() + this.config.outputAmount <= this.config.maxOutput;
        const making = ready && this.player !== undefined;
        if (!ready) {
            this.progress = 0;
        } else if (making) {
            this.progress += delta / Math.max(0.1, this.config.mixSec);
            if (this.progress >= 1) {
                this.progress = 0;
                this.finishBatch();
            }
        }
        this.refreshLabels(making);
    }

    /** A ScreenAnchorComponent keeping `content` `height` above world point `spot`. */
    private anchorAbove(content: PIXI.Container, spot: THREE.Vector3, height: number): ScreenAnchorComponent {
        const target = new THREE.Vector3();
        return this.addComponent(new ScreenAnchorComponent(
            this.screenHost,
            content,
            () => target.copy(spot).setY(spot.y + height),
            ZONE_LABEL_ANCHOR_OPTIONS,
        ));
    }

    private hasIngredients(): boolean {
        return this.config.inputs.every((input, i) => StorageInventory.getCount(this.boxes[i]?.storageId ?? '', input.resourceType) >= input.amount);
    }

    /** Uses one batch up and sends the product to the product box. */
    private finishBatch(): void {
        this.config.inputs.forEach((input, i) => StorageInventory.remove(this.boxes[i]?.storageId ?? '', input.resourceType, input.amount));
        const type = this.config.resourceType;
        const from = this.transform.position.clone().setY(this.transform.position.y + this.config.surfaceHeight + 0.3);
        for (let i = 0; i < this.config.outputAmount; i++) {
            this.output.receiveFrom(type, from, stackItemScale() * getPileScale(type));
        }
    }

    /** Box counts (in box / box holds), the product count (waiting / room), and the bar only while making. */
    private refreshLabels(making: boolean): void {
        this.config.inputs.forEach((input, i) => {
            const box = this.boxes[i];
            const capacity = Math.max(input.amount, input.capacity ?? DEFAULT_MIX_INPUT_CAPACITY);
            const count = box ? StorageInventory.getCount(box.storageId, input.resourceType) : 0;
            this.boxLabels[i]?.show(input.resourceType, `${count}/${capacity}`);
        });
        this.productLabel.show(this.config.resourceType, `${this.output.getFillCount()}/${this.config.maxOutput}`);
        this.barAnchor?.setForceHidden(!making);
        this.bar.setProgress(this.progress);
    }
}
