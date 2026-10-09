// StorageZone.ts
//
// The world entity for one map storage (see StorageTypes.ts): the storage's
// mesh (Restaurant.Crate by default) at the storage object's own spot, a
// dotted-outline trigger over its dropper rect (or over the storage itself if
// no dropper targets it), and its contents shown DIEGETICALLY — every stored
// unit is a real model in an ItemPile (the same system as the player's carry
// stack — see ItemPile.ts), a grid of StorageConfig.pile.columns x rows per
// layer rising from StorageConfig.dropOffset.
//
// While the player stands in the trigger, accepted items leave the player one
// at a time, every TRANSFER_STAGGER_SEC:
//   - stacked items (the crops piled on the player's back) come off the TOP of
//     the stack first — CarrierStackVisual.peekTop() says which item and where
//     it is, so the model visibly flies from that exact spot;
//   - anything else accepted but not drawn on the stack (e.g. wood, for a
//     storage accepting 'main') flies from the backpack itself.
// Each flies to the exact slot it will occupy on this storage's pile (the Nth
// item in flight aims N slots above the current top). It's removed from
// BackpackStorage the moment it departs (so the stack shrinks right away) and
// added to StorageInventory when it lands — which is what grows the pile.
// onTriggerStay keeps restarting the loop, so items landing on the player's
// stack while they're standing here get transferred too.
//
// A storage limited to ONE resource (StorageConfig.resourceType) also shows a
// floating panel with that resource's icon, so the player can tell what goes
// there before walking up — the same lock/requirement panel a for-sale farm or
// a gate shows (LockRequirementPanel.ts), minus the "missing" badge. Its bottom
// sits StorageConfig.popupBobOffset (default DEFAULT_ACCEPTS_PANEL_CLEARANCE)
// above the TOP of the pile, so it rises with it instead of ending up buried in
// the stacked items.
//
// A COLLECT storage (StorageConfig.collect) runs it the other way: while the player stands in the
// trigger, its items fly from the top of the pile onto the player's stack, one at a time, while
// the stack has room (startCollect()). Something else fills it — receiveFrom(), e.g. an animal
// stall's animals laying eggs (see StallAnimal.ts / PizzaScene.setupAnimalStalls()).
//
// A TRASH storage (StorageConfig.trash) runs the exact same transfer, but each
// item flies into the storage's drop point, shrinks and is destroyed instead of
// landing in StorageInventory — no pile, no count. Its signpost shows
// TRASH_SIGNPOST_ICON only. With StorageConfig.dumpAnyAfterSec, standing in it
// that long (garbage gone) also throws away whatever is on the player's stack.
//
// A SHELF storage (StorageConfig.shelf — see ShelfTypes.ts) draws the shelf's model instead
// (its decorative nodes hidden) and puts each item on one of the shelf's fixed slots ('slots'
// pile mode); it takes no more items than it has slots (isFull()).
//
// The entity's transform sits at the TRIGGER's center (so the RigidBody and the
// dotted outline need no offset); the mesh and pile are offset to the storage's
// own position.

import * as THREE from 'three';
import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import Entity from '../ecs/Entity';
import RigidBody from '../physics/RigidBody';
import { Layers } from '../physics/PhysicsConstants';
import DottedZoneVisualComponent from '../components/DottedZoneVisualComponent';
import ParticleEmitterComponent from '../components/ParticleEmitterComponent';
import GlbVisualComponent from '../components/GlbVisualComponent';
import { resolveEntityView } from './EntityViewRegistry';
import CharacterVisualComponent from '../components/CharacterVisualComponent';
import CarrierStackVisual, { stackItemScale } from '../components/CarrierStackVisual';
import ItemPile, { getPileScale, ItemPileLayout } from '../components/ItemPile';
import { flyResourceModel, flyResourceToStack } from '../components/FlyToStack';
import { CarryStack } from '../player/CarryStack';
import ScreenAnchorComponent, { ScreenAnchorHost } from '../components/ScreenAnchorComponent';
import { ZONE_LABEL_ANCHOR_OPTIONS } from '../ui/ZoneLabelConfig';
import { buildLockRequirementPanel } from '../ui/LockRequirementPanel';
import FloorLabelComponent, { FloorLabelItem, floorLabelEdgeOffset } from '../components/FloorLabelComponent';
import { isFloorFrame, FLOOR_FRAME } from '../ui/PopupConfig';
import type { LockRequirementPanel } from '../ui/LockRequirementPanel';
import { resolveResourceAssetKey } from '../actions/ResourceRegistry';
import { getAssetIcon } from './AssetLibraryRegistry';
import { BackpackStorage } from '../data/BackpackStorage';
import { StorageInventory } from '../data/StorageInventory';
import { GARBAGE_DARKEN, GarbageCarryStorage } from '../data/GarbageCarryStorage';
import { StorageConfig, STORAGE_SIGNPOST_CONFIG } from '../data/StorageTypes';
import { getZoneColor, ZoneColorKind } from '../data/ZoneColorTypes';
import { RESOURCE_CONFIG, ResourceType } from '../actions/ResourceTypes';
import { ModelSnapshotTool } from '../debug/ModelSnapshotTool';
import { getShelfConfig, isShelfNodeHidden, ShelfConfig } from '../data/ShelfTypes';
import MainPlayer from '../player/MainPlayer';
import DepositPacer from '../utils/DepositPacer';

const TRIGGER_HEIGHT = 0.75;
const CORNER_RADIUS = 0.3;
/** Gap between two departing items — same cadence as DropZone's own deposit. */
const TRANSFER_STAGGER_SEC = 0.12;
/** Fraction of the mesh's own X/Z floor the pile's grid spans — leaves its walls visible around the pile. */
const FOOTPRINT_FILL = 0.8;
/** Grid footprint (world units) until the mesh has loaded, or if it has none — Restaurant.Crate's own 2 x 2 floor x FOOTPRINT_FILL. */
const FALLBACK_FOOTPRINT = 1.6;
const LAND_BOUNCE_SCALE = 1.08;
const LAND_BOUNCE_SEC = 0.12;
/** Where to launch a non-stacked item from if the character (and so its backpack) hasn't loaded — roughly chest height. */
const FALLBACK_CARRIER_HEIGHT = 1.2;
/** Per-axis fallback for a missing StorageConfig.dropOffset value — half-way up Restaurant.Crate. */
const DEFAULT_DROP_OFFSET = { x: 0, y: 0.4, z: 0 };
/** StorageConfig.signpostGap fallback — see that field's own doc. */
const DEFAULT_SIGNPOST_GAP = 0.2;
const UP_AXIS = new THREE.Vector3(0, 1, 0);
/** Icon height when STORAGE_SIGNPOST_CONFIG.iconOffset is missing (e.g. a stale save from the editor). */
const DEFAULT_SIGNPOST_ICON_HEIGHT = 1.5;

/** Half-height of StorageConfig.solid's collider — a little over Restaurant.Crate's 0.8. */
const SOLID_HALF_HEIGHT = 0.5;
/** StorageConfig.particleSpawnRate fallback — same rate Gate/CraftZone's own ambient emitters use. */
const DEFAULT_PARTICLE_SPAWN_RATE_PER_SEC = 4;

/** Texture alias shown on a trash storage's signpost (StorageConfig.trash). */
const TRASH_SIGNPOST_ICON = 'trash';

/** What a storage is FOR, as an icon — the trash icon for a trash, its `resourceType`'s icon otherwise, undefined for an any-resource storage. Shared by this zone's signpost and StoragePurchaseZone's for-sale label so both show the same thing. */
export function getStorageIcon(config: StorageConfig): PIXI.Texture | undefined {
    if (config.trash) {
        return PIXI.Texture.from(TRASH_SIGNPOST_ICON);
    }
    return config.resourceType !== undefined ? getAssetIcon(resolveResourceAssetKey(config.resourceType)) : undefined;
}
/** A trashed item shrinks to this fraction of its slot size as it falls in, then disappears. */
const TRASH_END_SCALE_FRACTION = 0.2;

/** Default gap (world units) between the top of the pile and the bottom of the "only this resource" panel, when StorageConfig.popupBobOffset is unset — see this file's own doc. */
const DEFAULT_ACCEPTS_PANEL_CLEARANCE = 1.0;

export default class StorageZone extends Entity {
    /** Speeds this zone's one-unit-at-a-time deposits up (to ~3x) the longer the player keeps paying — see DepositPacer.ts. */
    private readonly depositPacer = new DepositPacer(TRANSFER_STAGGER_SEC);
    private readonly storageId: string;
    private readonly config: StorageConfig;
    /** StorageConfig.shelf, resolved — see this file's own doc. */
    private readonly shelf?: ShelfConfig;
    private readonly triggerSize: { width: number; depth: number };
    /** See the constructor's `showDropOutline` param doc. */
    private readonly showDropOutline: boolean;
    /** The storage object's OWN footprint — what StorageConfig.solid's collider covers. */
    private readonly storageSize: { width: number; depth: number };
    private readonly screenHost: ScreenAnchorHost;
    /** Storage position relative to this entity (the trigger's center) — see this file's own doc. */
    private readonly meshOffset: THREE.Vector3;

    private visual?: GlbVisualComponent;
    /** Scale the storage mesh was built at — the view's when StorageConfig.view resolves, else config.scale. playLandBounce() returns to it. */
    private meshScale = 1;
    /** The item icon + "xN" count standing on the signpost — see buildSignpost(). */
    private signpostLabel?: FloorLabelComponent;
    /** Parent of every stored-item model — sits at meshOffset + config.dropOffset, so the pile's local origin IS the drop point. */
    private readonly pileRoot = new THREE.Group();
    private pile!: ItemPile;
    private footprint = { x: FALLBACK_FOOTPRINT, z: FALLBACK_FOOTPRINT };
    /** Items currently flying INTO this storage, in launch order — each aims one pile slot above the one before it. */
    private readonly incoming: number[] = [];
    private nextIncomingId = 1;

    private player?: MainPlayer;
    private isPlayerInside = false;
    /** performance.now() the player stepped in — StorageConfig.dumpAnyAfterSec counts from it. */
    private enteredAtMs = 0;
    private transferring = false;
    private destroyed = false;

    /** The popup alternative to the signpost's count (a non-Floor `frame`) — see buildAcceptsPanel(). */
    private acceptsPanel?: LockRequirementPanel;

    private readonly handleInventoryChanged = (storageId: string): void => {
        if (storageId === this.storageId) {
            this.pile.sync(StorageInventory.getAll(this.storageId));
            this.refreshFloorLabel();
        }
    };

    /** See the constructor's `mapRotationDeg`. */
    private readonly mapRotationDeg: number;

    public constructor(
        storageId: string,
        config: StorageConfig,
        storagePosition: THREE.Vector3,
        triggerCenter: THREE.Vector3,
        triggerSize: { width: number; depth: number },
        storageSize: { width: number; depth: number },
        screenHost: ScreenAnchorHost,
        /** Draw the dotted outline around the drop area — off when this storage's store sets hideStorageDropperView (see StoreConfig / PizzaScene.setupStorages()). */
        showDropOutline = true,
        /** The storage object's own rotation on the Tiled map (degrees, clockwise) — turns the mesh on top of its config/view rotationDeg. The signpost isn't affected. */
        mapRotationDeg = 0,
    ) {
        super();
        this.showDropOutline = showDropOutline;
        this.mapRotationDeg = mapRotationDeg;
        this.screenHost = screenHost;
        this.storageId = storageId;
        this.config = config;
        this.shelf = getShelfConfig(config.shelf);
        this.triggerSize = triggerSize;
        this.storageSize = storageSize;
        this.meshOffset = storagePosition.clone().sub(triggerCenter);
        this.transform.position.copy(triggerCenter);
    }

    public override awake(): void {
        const { width, depth } = this.triggerSize;
        const rigidBody = this.addComponent(new RigidBody({
            halfExtents: new THREE.Vector3(width / 2, TRIGGER_HEIGHT, depth / 2),
            isStatic: true,
            isTrigger: true,
            layer: Layers.Trigger,
            centerOffset: new THREE.Vector3(0, TRIGGER_HEIGHT, 0),
        }));
        rigidBody.onTriggerEnter.add(other => this.handleTriggerEnter(other));
        rigidBody.onTriggerStay.add(other => this.handleTriggerEnter(other));
        rigidBody.onTriggerExit.add(other => this.handleTriggerExit(other));

        if (this.showDropOutline) {
            this.addComponent(new DottedZoneVisualComponent(width, depth, CORNER_RADIUS, { color: getZoneColor(ZoneColorKind.DropZone) }));
        }

        // StorageConfig.solid — built here rather than via SolidArea.buildSolidArea(), which scales
        // its centerOffset along with its size (it assumes a collider centered on the entity's
        // origin); this one sits at the storage's own position, offset from the trigger.
        const solid = Math.min(this.config.solid ?? 0, 1);
        if (solid > 0) {
            this.addComponent(new RigidBody({
                halfExtents: new THREE.Vector3(this.storageSize.width / 2 * solid, SOLID_HALF_HEIGHT, this.storageSize.depth / 2 * solid),
                centerOffset: this.meshOffset.clone().setY(this.meshOffset.y + SOLID_HALF_HEIGHT),
                isStatic: true,
                layer: Layers.Environment,
                // Horizontal-only obstacle — same reasoning as SolidArea.ts's own blocksVertical.
                blocksVertical: false,
            }));
        }

        if (this.shelf) {
            this.buildShelfMesh(this.shelf);
        } else {
            this.buildStorageMesh();
        }

        this.buildSignpost();

        // Each axis falls back on its own — the web editor can save a partial/empty object
        // (e.g. `dropOffset: {}`), and an undefined axis would put the whole pile at NaN.
        // A shelf's slots are measured from the shelf itself — no drop offset.
        const drop = this.shelf ? { x: 0, y: 0, z: 0 } : this.config.dropOffset ?? {};
        this.pileRoot.position.copy(this.meshOffset).add(new THREE.Vector3(
            drop.x ?? DEFAULT_DROP_OFFSET.x,
            drop.y ?? DEFAULT_DROP_OFFSET.y,
            drop.z ?? DEFAULT_DROP_OFFSET.z,
        ));
        this.transform.add(this.pileRoot);
        this.pile = new ItemPile(this.pileRoot, this.buildLayout());
        this.finishAwake();
    }

    /** The shelf's model (StorageConfig.shelf) at the storage's spot — its hideNodes hidden once loaded. */
    private buildShelfMesh(shelf: ShelfConfig): void {
        const modelDef = ModelSnapshotTool.resolveModelRef(shelf.models[0]);
        if (!modelDef) {
            console.warn(`[StorageZone] "${this.storageId}": shelf model "${String(shelf.models[0])}" is not a known MODELS ref — no mesh`);
            return;
        }
        this.meshScale = shelf.scale;
        const visual: GlbVisualComponent = new GlbVisualComponent(modelDef, this.meshOffset.clone(), shelf.scale, this.shelfYaw(), () => {
            visual.mesh.traverse(node => {
                if (node !== visual.mesh && isShelfNodeHidden(shelf, node.name)) {
                    node.visible = false;
                }
            });
        });
        this.visual = this.addComponent(visual);
    }

    /** The shelf model's yaw — its own rotationDeg on top of the map object's (Tiled turns clockwise, THREE counter-clockwise). */
    private shelfYaw(): number {
        return THREE.MathUtils.degToRad((this.shelf?.rotationDeg ?? 0) - this.mapRotationDeg);
    }

    /** The normal storage look: StorageConfig.view, else its inline models/scale/rotationDeg. */
    private buildStorageMesh(): void {
        // StorageConfig.view (an Entity Views id) wins over the inline models/scale/rotationDeg.
        const view = resolveEntityView(this.config.view);
        if (this.config.view && !view) {
            console.warn(`[StorageZone] "${this.storageId}": view "${this.config.view}" has no model in Entity Views — using the inline model`);
        }
        const modelRef = this.config.models[0];
        const modelDef = view?.model ?? ModelSnapshotTool.resolveModelRef(modelRef);
        if (!view && modelRef && !modelDef) {
            console.warn(`[StorageZone] "${this.storageId}": model "${String(modelRef)}" is not a known MODELS ref — no mesh`);
        }
        this.meshScale = view?.scale ?? this.config.scale;
        if (modelDef) {
            const visual: GlbVisualComponent = new GlbVisualComponent(
                modelDef,
                view ? this.meshOffset.clone().add(new THREE.Vector3(...view.offset)) : this.meshOffset.clone(),
                this.meshScale,
                // Tiled turns clockwise, THREE's yaw counter-clockwise — hence the minus.
                THREE.MathUtils.degToRad((view?.rotationDeg ?? this.config.rotationDeg) - this.mapRotationDeg),
                () => {
                    // Parents included before measuring — see the background-tab stale-matrixWorld
                    // note in ResourceDisplayModel.ts. Only the X/Z SIZE is used, so the mesh's own
                    // yaw is the one thing that could skew it — fine for an axis-aligned crate.
                    visual.mesh.updateWorldMatrix(true, true);
                    const size = new THREE.Box3().setFromObject(visual.mesh).getSize(new THREE.Vector3());
                    this.footprint = { x: size.x * FOOTPRINT_FILL, z: size.z * FOOTPRINT_FILL };
                    this.pile.setLayout(this.buildLayout());
                },
            );
            this.visual = this.addComponent(visual);
        }
    }

    /** The rest of awake(), once the mesh and pile exist. */
    private finishAwake(): void {
        // StorageConfig.particleEffectId — from the drop point (pileRoot), so e.g. a trash's fire
        // rises out of the crate where items fall in. The effect's own `offset` nudges it further.
        if (this.config.particleEffectId) {
            const rate = this.config.particleSpawnRate;
            this.addComponent(new ParticleEmitterComponent(
                this.config.particleEffectId,
                rate !== undefined && rate > 0 ? rate : DEFAULT_PARTICLE_SPAWN_RATE_PER_SEC,
                this.pileRoot.position.clone(),
            ));
        }
        this.pile.sync(StorageInventory.getAll(this.storageId));
        StorageInventory.onChange.add(this.handleInventoryChanged);

        // 'Floor' (the default) draws nothing extra here — the stored count is shown on the
        // signpost instead (see buildSignpost()). A popup frame keeps its floating panel.
        if (!this.config.trash && this.config.resourceType !== undefined && !isFloorFrame(this.config.frame ?? FLOOR_FRAME)) {
            this.buildAcceptsPanel(this.config.resourceType);
        }
    }

    public override destroy(): void {
        this.destroyed = true;
        StorageInventory.onChange.remove(this.handleInventoryChanged);
        this.pile.dispose();
        super.destroy();
    }

    /**
     * The shared signpost (STORAGE_SIGNPOST_CONFIG — one model/scale/icon size for every
     * storage) just outside this storage's signpostSide edge (default north), turned by its own
     * signpostRotationDeg; with a `resourceType`, that item's icon stands on it. The icon is a flat
     * plane facing south (toward the camera) rather than a THREE.Sprite, since a sprite's shader
     * can't take the world bend and would drift off the post away from the player.
     */
    private buildSignpost(): void {
        // StorageConfig.hideSignpost — no post, no icon.
        if (this.config.hideSignpost) {
            return;
        }
        const shared = STORAGE_SIGNPOST_CONFIG;
        const modelRef = shared.models[0];
        const model = ModelSnapshotTool.resolveModelRef(modelRef);
        if (!model) {
            if (modelRef) {
                console.warn(`[StorageZone] signpost model "${String(modelRef)}" is not a known MODELS ref — no signposts`);
            }
            return;
        }
        const side = this.config.signpostSide ?? 'north';
        const yaw = THREE.MathUtils.degToRad(this.config.signpostRotationDeg ?? 0);
        // Shared offset nudges the post off its side/gap spot — x/z turn with this storage's yaw.
        const [postX, postY, postZ] = shared.offset ?? [0, 0, 0];
        const position = floorLabelEdgeOffset(side, this.meshOffset, this.storageSize.width, this.storageSize.depth, this.config.signpostGap ?? DEFAULT_SIGNPOST_GAP)
            .add(new THREE.Vector3(postX, 0, postZ).applyAxisAngle(UP_AXIS, yaw));
        position.y += postY;
        this.addComponent(new GlbVisualComponent(model, position.clone(), shared.scale, yaw));

        const items = this.signpostItems();
        if (!items) {
            return;
        }
        // Upright sign (item icon + "xN", or just the trash icon) — a FloorLabelComponent stood up, so it redraws on count
        // changes and takes the world bend (a THREE.Sprite couldn't). iconScale is its height;
        // iconOffset is relative to the signpost, so its x/z turn with this storage's signpost yaw.
        const [offsetX, offsetY, offsetZ] = shared.iconOffset ?? [0, DEFAULT_SIGNPOST_ICON_HEIGHT, 0];
        const iconOffset = new THREE.Vector3(offsetX, 0, offsetZ).applyAxisAngle(UP_AXIS, yaw);
        this.signpostLabel = this.addComponent(new FloorLabelComponent({
            items,
            size: shared.iconScale,
            upright: true,
            background: false,
            offset: new THREE.Vector3(position.x + iconOffset.x, 0, position.z + iconOffset.z),
            height: position.y + offsetY,
        }));
    }

    /** The signpost sign's content — the item icon + "xN" stored count, just the trash icon for a trash, or undefined (no sign) for a storage with no `resourceType`. */
    private signpostItems(): FloorLabelItem[] | undefined {
        const icon = getStorageIcon(this.config);
        if (this.config.trash) {
            return [{ icon }];
        }
        const type = this.config.resourceType;
        if (type === undefined) {
            return undefined;
        }
        return [{ icon, text: `x${StorageInventory.getCount(this.storageId, type)}` }];
    }

    /** Keeps whichever count display this storage has (signpost sign or popup) in sync with StorageInventory. */
    private refreshFloorLabel(): void {
        if (this.config.trash || this.config.resourceType === undefined) {
            return;
        }
        this.signpostLabel?.setItems(this.signpostItems() ?? []);
        this.acceptsPanel?.setCornerText(`${StorageInventory.getCount(this.storageId, this.config.resourceType)}`);
    }

    /** The "only this resource" panel (icon + stored count) in the chosen `frame` preset — the popup alternative to buildFloorLabel(). */
    private buildAcceptsPanel(type: ResourceType): void {
        const panel = buildLockRequirementPanel(getAssetIcon(resolveResourceAssetKey(type)), {
            showBadge: false,
            frame: this.config.frame,
            cornerText: `${StorageInventory.getCount(this.storageId, type)}`,
        });
        this.acceptsPanel = panel;

        const clearance = this.config.popupBobOffset ?? DEFAULT_ACCEPTS_PANEL_CLEARANCE;
        const anchor = new THREE.Vector3();
        this.addComponent(new ScreenAnchorComponent(
            this.screenHost,
            panel.frame,
            () => {
                // Just above wherever the NEXT item would sit — i.e. the top of the pile right now.
                this.pile.getSlotWorldPosition(this.pile.count, type, anchor);
                return anchor.setY(anchor.y + clearance);
            },
            ZONE_LABEL_ANCHOR_OPTIONS,
        ));
    }

    private itemScale(): number {
        const scale = this.config.itemScale;
        return scale !== undefined && scale > 0 ? scale : stackItemScale();
    }

    private buildLayout(): ItemPileLayout {
        const pile = this.config.pile ?? { columns: 3, rows: 3, layers: 4 };
        if (this.shelf) {
            // Each slot: model units x the shelf's scale, turned with the shelf — root-local (the
            // pile root sits where the shelf mesh does).
            const shelf = this.shelf;
            const yaw = this.shelfYaw();
            const slotPositions = shelf.slots.map(slot => new THREE.Vector3(...slot.position).multiplyScalar(shelf.scale).applyAxisAngle(UP_AXIS, yaw));
            return {
                mode: 'slots',
                base: new THREE.Vector3(),
                footprint: this.footprint,
                maxColumns: 1,
                maxRows: 1,
                maxLayers: 1,
                fitToCells: false,
                towerMaxItems: slotPositions.length,
                slotPositions,
                itemScale: shelf.itemScale !== undefined && shelf.itemScale > 0 ? shelf.itemScale : this.itemScale(),
                itemYawDeg: this.config.itemYawDeg,
                itemOrientation: this.config.itemOrientation,
                localPerWorld: 1,
                offsetYFor: type => RESOURCE_CONFIG[type]?.storageOffsetY ?? 0,
            };
        }
        return {
            mode: 'grid',
            base: new THREE.Vector3(),
            footprint: this.footprint,
            maxColumns: pile.columns,
            maxRows: pile.rows,
            maxLayers: pile.layers,
            // A storage's grid is exactly what its config says — oversized items shrink to fit.
            fitToCells: true,
            towerMaxItems: pile.columns * pile.rows * pile.layers,
            itemScale: this.itemScale(),
            itemYawDeg: this.config.itemYawDeg,
            itemOrientation: this.config.itemOrientation,
            localPerWorld: 1,
            // Per-resource height in storages (e.g. carrots a bit lower) — ResourceConfig.storageOffsetY.
            offsetYFor: type => RESOURCE_CONFIG[type]?.storageOffsetY ?? 0,
        };
    }

    private accepts(type: ResourceType): boolean {
        // The trash takes garbage (store/StoreGarbage.ts); garbage goes nowhere else. Garbage gone
        // and the player still standing here (dumpAnyAfterSec) -> any stack item too.
        if (this.config.trash) {
            if (type === ResourceType.Garbage) {
                return true;
            }
            const dumpAfterSec = this.config.dumpAnyAfterSec ?? 0;
            return dumpAfterSec > 0
                && BackpackStorage.getCount(ResourceType.Garbage) <= 0
                && performance.now() - this.enteredAtMs >= dumpAfterSec * 1000
                && RESOURCE_CONFIG[type]?.category === 'farm';
        }
        if (type === ResourceType.Garbage) {
            return false;
        }
        // A specific resource overrides the category — see StorageConfig.resourceType's own doc.
        if (this.config.resourceType !== undefined) {
            return type === this.config.resourceType;
        }
        if (this.config.accepts === 'all') {
            return true;
        }
        return (RESOURCE_CONFIG[type]?.category ?? 'main') === this.config.accepts;
    }

    private handleTriggerEnter(other: RigidBody): void {
        if (!(other.entity instanceof MainPlayer) || this.destroyed) {
            return;
        }
        if (!this.isPlayerInside) {
            this.enteredAtMs = performance.now();
        }
        this.isPlayerInside = true;
        this.player = other.entity;
        if (this.config.collect) {
            this.startCollect();
        } else {
            this.startTransfer();
        }
    }

    /** StorageConfig.collect — see this file's own doc. One item per paced step, top of the pile first, while the player's stack has room. */
    private startCollect(): void {
        if (this.transferring) {
            return;
        }
        this.transferring = true;

        const step = (): void => {
            const player = this.player;
            const scene = this.transform.parent;
            const type = this.nextStored();
            if (!this.isPlayerInside || !player || !scene || this.destroyed || type === undefined) {
                this.transferring = false;
                return;
            }
            if (!CarryStack.hasRoomFor(1)) {
                CarryStack.notifyFull(player);
                this.transferring = false;
                return;
            }
            // Launches from where the top item sits, read before it's removed from the pile.
            const from = this.pile.getSlotWorldPosition(this.pile.count - 1, type, new THREE.Vector3());
            if (StorageInventory.remove(this.storageId, type, 1) <= 0) {
                this.transferring = false;
                return;
            }
            flyResourceToStack(scene, player, type, from);
            this.playLandBounce();
            gsap.delayedCall(this.depositPacer.nextDelaySec(), step);
        };

        step();
    }

    /** The first resource this storage holds any of — what a collect step takes next. */
    private nextStored(): ResourceType | undefined {
        for (const [type, count] of StorageInventory.getAll(this.storageId)) {
            if (count > 0) {
                return type;
            }
        }
        return undefined;
    }

    /**
     * One `type` arriving from somewhere other than the player (e.g. an animal laying an egg —
     * see StallAnimal.ts): flies from `from` into the next free slot of this pile and is added
     * to StorageInventory as it lands. The caller checks getFillCount() < getCapacity() first.
     */
    public receiveFrom(type: ResourceType, from: THREE.Vector3, startScale: number): void {
        const scene = this.transform.parent;
        if (!scene || this.destroyed) {
            StorageInventory.add(this.storageId, type, 1);
            return;
        }
        const incomingId = this.nextIncomingId++;
        this.incoming.push(incomingId);
        flyResourceModel({
            parent: scene,
            type,
            from,
            startScale,
            endScale: this.pile.getSlotScale(this.pile.count + this.incoming.length - 1, type),
            orientation: this.config.itemOrientation,
            yawDeg: this.config.itemYawDeg,
            resolveTarget: target => {
                const index = this.pile.count + Math.max(this.incoming.indexOf(incomingId), 0);
                this.pile.getSlotWorldPosition(index, type, target);
            },
            onArrive: () => {
                const index = this.incoming.indexOf(incomingId);
                if (index !== -1) {
                    this.incoming.splice(index, 1);
                }
                StorageInventory.add(this.storageId, type, 1);
                this.playLandBounce();
            },
        });
    }

    /** Items stored plus items already flying in. */
    public getFillCount(): number {
        return StorageInventory.getTotal(this.storageId) + this.incoming.length;
    }

    /** How many items the pile draws — a shelf's slot count, else StorageConfig.pile's grid. */
    public getCapacity(): number {
        return this.pile.capacity;
    }

    /** Full = StorageConfig.maxItems reached, or every slot of a SHELF taken — a plain crate storage keeps taking items past what it draws. */
    private isFull(): boolean {
        if (this.config.maxItems !== undefined) {
            return this.getFillCount() >= this.config.maxItems;
        }
        return this.shelf !== undefined && this.getFillCount() >= this.getCapacity();
    }

    private handleTriggerExit(other: RigidBody): void {
        if (other.entity !== this.player) {
            return;
        }
        this.isPlayerInside = false;
        this.player = undefined;
    }

    /** See this file's own doc — one item per TRANSFER_STAGGER_SEC, re-checking everything before each. */
    private startTransfer(): void {
        if (this.transferring) {
            return;
        }
        this.transferring = true;

        const step = (): void => {
            const player = this.player;
            const scene = this.transform.parent;
            if (!this.isPlayerInside || !player || !scene || this.destroyed) {
                this.transferring = false;
                return;
            }

            // A shelf holds one item per slot — nothing more goes in once they're all taken.
            if (this.isFull()) {
                this.transferring = false;
                return;
            }
            const from = new THREE.Vector3();
            const type = this.nextOutgoing(player, from);
            // Garbage keeps looking like the darkened item it was (read before the removal trims that list).
            const garbageWas = type === ResourceType.Garbage ? GarbageCarryStorage.peekTop() : undefined;
            if (type === undefined || !BackpackStorage.removeOne(type)) {
                this.transferring = false;
                return;
            }

            const trash = this.config.trash === true;
            const incomingId = this.nextIncomingId++;
            this.incoming.push(incomingId);
            // Ends at the size it will actually be drawn at in its slot (fit-to-cell included), so it
            // doesn't pop on landing. A trash has no pile: everything aims at slot 0 and shrinks away.
            const landingScale = trash
                ? this.pile.getSlotScale(0, type) * TRASH_END_SCALE_FRACTION
                : this.pile.getSlotScale(this.pile.count + this.incoming.length - 1, type);
            flyResourceModel({
                parent: scene,
                type,
                displayType: garbageWas,
                darken: garbageWas ? GARBAGE_DARKEN : undefined,
                from,
                // Leaves the carrier at the size it was drawn there (pileScale included).
                startScale: stackItemScale() * getPileScale(type),
                endScale: landingScale,
                // Already turned the way it'll sit in this storage, so it doesn't flip on landing.
                orientation: this.config.itemOrientation,
                yawDeg: this.config.itemYawDeg,
                resolveTarget: target => {
                    // The Nth item in flight aims N slots above the current top of this pile.
                    const index = trash ? 0 : this.pile.count + Math.max(this.incoming.indexOf(incomingId), 0);
                    this.pile.getSlotWorldPosition(index, type, target);
                },
                onArrive: () => {
                    const index = this.incoming.indexOf(incomingId);
                    if (index !== -1) {
                        this.incoming.splice(index, 1);
                    }
                    // Trash: already gone from BackpackStorage on departure — nothing to add.
                    if (!trash) {
                        StorageInventory.add(this.storageId, type, 1);
                    }
                    this.playLandBounce();
                },
            });

            gsap.delayedCall(this.depositPacer.nextDelaySec(), step);
        };

        step();
    }

    /** Which accepted item leaves next, and from where (written into `from`) — stacked items top-down first, then anything accepted but not drawn on the stack. See this file's own doc. */
    private nextOutgoing(player: MainPlayer, from: THREE.Vector3): ResourceType | undefined {
        const accepts = (type: ResourceType): boolean => this.accepts(type) && BackpackStorage.getCount(type) > 0;

        const stacked = player.getComponent(CarrierStackVisual)?.peekTop(accepts, from);
        if (stacked !== undefined) {
            return stacked;
        }

        for (const [type, count] of BackpackStorage.getAll()) {
            if (count > 0 && accepts(type)) {
                const backpack = player.getComponent(CharacterVisualComponent)?.character.getCarrierWorldPosition(from);
                if (!backpack) {
                    from.copy(player.transform.position).setY(player.transform.position.y + FALLBACK_CARRIER_HEIGHT);
                }
                return type;
            }
        }
        return undefined;
    }

    private playLandBounce(): void {
        if (!this.visual?.isReady) {
            return;
        }
        const mesh = this.visual.mesh;
        const base = this.meshScale;
        gsap.killTweensOf(mesh.scale);
        mesh.scale.setScalar(base * LAND_BOUNCE_SCALE);
        gsap.to(mesh.scale, { x: base, y: base, z: base, duration: LAND_BOUNCE_SEC, ease: 'power2.out' });
    }
}
