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
// The boxes rest on whatever solid surface is drawn under them — a kitchen counter, the station's
// own table — found from the static colliders' tops (physics/SurfaceQuery.ts), re-checked every
// SURFACE_CHECK_SEC (the counters' colliders only reach their real height once their models load).
// Nothing solid under a box = config.surfaceHeight above the floor.
//
// The ingredient boxes and the product box are plain StorageZones built by PizzaScene: each
// ingredient box takes only its resource, up to its capacity (StorageConfig.maxItems), from the
// player standing next to it; the product box is a collect storage. This entity only watches them:
// every box holding at least one batch + the player in the making area + room in the product box
// -> mixing progresses (pausing while the player is out, resetting if a box runs short); when it
// completes, one batch is used up and the product flies to the product box
// (StorageZone.receiveFrom()) — then the next batch starts while the boxes last.
//
// A store BAKER (store/StoreBakerWorker.ts) can do the player's part: fill the boxes
// (depositFromWorker()) and stand in the making area (operate(), every frame it's there).

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
import StorageZone from './StorageZone';
import type { MixStationConfig } from '../data/MixStationTypes';
import { findSolidTopAt } from '../physics/SurfaceQuery';

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
/** How often the boxes re-check the surface under them — see this file's own doc. */
const SURFACE_CHECK_SEC = 0.5;
/** How fast a box glides to a newly found surface height (exponential ease, 1/s). */
const SURFACE_GLIDE_SPEED = 6;
/** Closer than this to its surface, a box just snaps the rest of the way. */
const SURFACE_SNAP_DISTANCE = 0.005;

export interface MixStationRect {
    x: number;
    z: number;
    width: number;
    depth: number;
}

/** One ingredient box as a worker sees it — see MixStation.getInputNeeds(). */
export interface MixStationInputNeed {
    /** Index into config.inputs (and the boxes). */
    index: number;
    resourceType: ResourceType;
    /** Units one batch uses. */
    batch: number;
    /** What the box holds at most. */
    capacity: number;
    /** In the box, plus items already flying in. */
    count: number;
    /** The box's spot (on the station's top) — a worker walks next to it to drop items in. */
    position: THREE.Vector3;
}

/**
 * How many frames one operate() call keeps the station mixing — a worker calls it every frame it stands
 * there. Frames, not seconds: at high game speed one frame can be longer than any fixed hold, which
 * used to expire it before update() ever saw it. 2 covers either update order (worker before/after us).
 */
const OPERATOR_HOLD_FRAMES = 2;

/** One ingredient box — its StorageInventory id, where it stands (world, kept on the surface under it) and its StorageZone. */
export interface MixStationBox {
    storageId: string;
    position: THREE.Vector3;
    /** Undefined when the map has no spot for it (nothing to move). */
    zone?: StorageZone;
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
    /** Every built station — store bakers (StoreBakerWorker.ts) pick theirs from here. */
    private static readonly all = new Set<MixStation>();

    public static getAll(): ReadonlySet<MixStation> {
        return MixStation.all;
    }

    private readonly config: MixStationConfig;
    private readonly dropper: MixStationRect;
    private readonly mesh?: MeshPlacement;
    private readonly boxes: MixStationBox[];
    private readonly output: StorageZone;
    private readonly outputPosition: THREE.Vector3;
    private readonly screenHost: ScreenAnchorHost;

    private player?: MainPlayer;
    /** > 0 while a worker is operating it (operate()) — counts like the player standing in the making area. */
    private operatorHoldFrames = 0;
    private progress = 0;
    /** Batches finished since spawn — read by the playtest bot (getPlaytestState()). */
    private batchesMade = 0;
    /** Of batchesMade, how many a worker made alone (operate(), no player in the making area) — for playtest reports. */
    private batchesByWorker = 0;
    private surfaceTimerSec = 0;
    /** Each box spot's (and the product box's) surface height to glide to — see settleOnSurfaces(). */
    private readonly surfaceTargets = new Map<THREE.Vector3, number>();
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
        // Cooking from a pantry: no boxes to label — the pantry's own sign lists its contents.
        if (!this.config.pantryId) {
            this.boxes.forEach(box => {
                const label = new BoxLabel(INGREDIENT_FRAME);
                this.boxLabels.push(label);
                this.anchorAbove(label.content, box.position, LABEL_CLEARANCE);
            });
        }
        this.anchorAbove(this.productLabel.content, this.outputPosition, LABEL_CLEARANCE);

        // The bar, over the making area — hidden unless it's making.
        this.bar.pivot.set(BAR_WIDTH / 2, MIN_BAR_HEIGHT);
        this.barContent.addChild(this.bar);
        const barSpot = new THREE.Vector3(this.dropper.x, this.transform.position.y, this.dropper.z);
        this.barAnchor = this.anchorAbove(this.barContent, barSpot, BAR_HEIGHT);
        this.barAnchor.setForceHidden(true);

        this.refreshLabels(false);
        MixStation.all.add(this);
    }

    public override destroy(): void {
        MixStation.all.delete(this);
        super.destroy();
    }

    /** What a playtest report shows per station each sample — see PlaytestRecorder's StoreSample.kitchen. */
    public getReportState(): { product: ResourceType; made: number; madeByWorker: number; output: number; maxOutput: number; mixing: boolean; boxes: { type: ResourceType; count: number; capacity: number }[] } {
        return {
            product: this.config.resourceType,
            made: this.batchesMade,
            madeByWorker: this.batchesByWorker,
            output: this.output.getFillCount(),
            maxOutput: this.config.maxOutput,
            mixing: this.canMix() && (this.player !== undefined || this.operatorHoldFrames > 0),
            boxes: this.getInputNeeds().map(need => ({ type: need.resourceType, count: need.count, capacity: need.capacity })),
        };
    }

    // ---- Worker API (store bakers — see StoreBakerWorker.ts)

    public getProduct(): ResourceType {
        return this.config.resourceType;
    }

    /** Where the player (or a baker) stands while it mixes — the making area's center, on the floor. */
    public getMakingPoint(): THREE.Vector3 {
        return new THREE.Vector3(this.dropper.x, this.transform.position.y, this.dropper.z);
    }

    /** Every box holds a batch and the product box has room for one more — standing here would make something. */
    public canMix(): boolean {
        return this.hasIngredients() && this.hasOutputRoom();
    }

    /** Products waiting in the product box (in flight included). */
    public getOutputCount(): number {
        return this.output.getFillCount();
    }

    /** The product box can take one more batch. */
    public hasOutputRoom(): boolean {
        return this.output.getFillCount() + this.config.outputAmount <= this.config.maxOutput;
    }

    /** Each ingredient box: what it takes, holds and has (in flight included) — boxes the map has no spot for are left out. */
    public getInputNeeds(): MixStationInputNeed[] {
        const needs: MixStationInputNeed[] = [];
        // Cooking from a pantry (the diner fridge): what's in IT, per type — filled at the fridge.
        if (this.config.pantryId) {
            const pantry = StorageZone.get(this.config.pantryId);
            const pantryConfig = pantry?.getConfig().pantry;
            if (!pantry || !pantryConfig) {
                return needs;
            }
            const position = pantry.getStoragePosition();
            this.config.inputs.forEach((input, index) => needs.push({
                index,
                resourceType: input.resourceType,
                batch: input.amount,
                capacity: Math.max(input.amount, pantryConfig.maxPerType),
                count: StorageInventory.getCount(this.config.pantryId!, input.resourceType),
                position,
            }));
            return needs;
        }
        this.config.inputs.forEach((input, index) => {
            const box = this.boxes[index];
            if (!box?.zone) {
                return;
            }
            needs.push({
                index,
                resourceType: input.resourceType,
                batch: input.amount,
                capacity: Math.max(input.amount, input.capacity ?? DEFAULT_MIX_INPUT_CAPACITY),
                count: box.zone.getFillCount(),
                position: box.position,
            });
        });
        return needs;
    }

    /** One `type` from a worker into box `index` — flies from `from` and lands in the box. False when the box doesn't take it or is full. */
    public depositFromWorker(index: number, type: ResourceType, from: THREE.Vector3): boolean {
        const need = this.getInputNeeds().find(candidate => candidate.index === index);
        const zone = this.config.pantryId ? StorageZone.get(this.config.pantryId) : this.boxes[index]?.zone;
        if (!need || !zone || need.resourceType !== type || need.count >= need.capacity) {
            return false;
        }
        zone.receiveFrom(type, from, stackItemScale() * getPileScale(type));
        return true;
    }

    /** A worker standing in the making area — call every frame; mixing runs while it keeps calling. */
    public operate(): void {
        this.operatorHoldFrames = OPERATOR_HOLD_FRAMES;
    }

    /** What the playtest bot (playtest/PlaytestBot.ts) needs: where to stand to make, whether a batch can start, and each ingredient box. */
    public getPlaytestState(): { product: ResourceType; makingPoint: THREE.Vector3; ready: boolean; made: number; inputs: { storageId: string; resourceType: ResourceType; batch: number }[] } {
        return {
            product: this.config.resourceType,
            /** Batches finished so far — the bot leaves after one (see PlaytestBot's make goal). */
            made: this.batchesMade,
            makingPoint: new THREE.Vector3(this.dropper.x, 0, this.dropper.z),
            ready: this.hasIngredients() && this.output.getFillCount() + this.config.outputAmount <= this.config.maxOutput,
            inputs: this.config.inputs.map((input, i) => ({ storageId: this.boxes[i]?.storageId ?? '', resourceType: input.resourceType, batch: input.amount })),
        };
    }

    public override update(delta: number): void {
        super.update(delta);
        this.surfaceTimerSec -= delta;
        if (this.surfaceTimerSec <= 0) {
            this.surfaceTimerSec = SURFACE_CHECK_SEC;
            this.settleOnSurfaces();
        }
        this.glideToSurfaces(delta);

        const ready = this.canMix();
        const operated = this.operatorHoldFrames > 0;
        this.operatorHoldFrames = Math.max(0, this.operatorHoldFrames - 1);
        const making = ready && (this.player !== undefined || operated);
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

    /** The surface under every box (and the product box) — where glideToSurfaces() takes it. */
    private settleOnSurfaces(): void {
        const physics = this.world?.physics;
        if (!physics) {
            return;
        }
        const floorY = this.transform.position.y;
        const surfaceAt = (spot: THREE.Vector3): number => findSolidTopAt(physics, spot.x, spot.z, floorY) ?? floorY + this.config.surfaceHeight;
        for (const box of this.boxes) {
            if (box.zone) {
                this.surfaceTargets.set(box.position, surfaceAt(box.position));
            }
        }
        this.surfaceTargets.set(this.outputPosition, surfaceAt(this.outputPosition));
    }

    /** Eases each box toward its surface (no teleport) — the box, its pile and its label move together. */
    private glideToSurfaces(delta: number): void {
        const t = 1 - Math.exp(-SURFACE_GLIDE_SPEED * delta);
        const glide = (spot: THREE.Vector3, zone: StorageZone): void => {
            const target = this.surfaceTargets.get(spot);
            if (target === undefined || spot.y === target) {
                return;
            }
            spot.y = Math.abs(target - spot.y) <= SURFACE_SNAP_DISTANCE ? target : spot.y + (target - spot.y) * t;
            zone.setStorageY(spot.y);
        };
        for (const box of this.boxes) {
            if (box.zone) {
                glide(box.position, box.zone);
            }
        }
        glide(this.outputPosition, this.output);
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
        this.batchesMade++;
        if (!this.player) {
            this.batchesByWorker++;
        }
        this.config.inputs.forEach((input, i) => StorageInventory.remove(this.boxes[i]?.storageId ?? '', input.resourceType, input.amount));
        const type = this.config.resourceType;
        const from = this.transform.position.clone().setY(this.outputPosition.y + 0.3);
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
