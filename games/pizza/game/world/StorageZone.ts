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
//     the stack first — BackpackStackVisual.peekTop() says which item and where
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
// The entity's transform sits at the TRIGGER's center (so the RigidBody and the
// dotted outline need no offset); the mesh and pile are offset to the storage's
// own position.

import * as THREE from 'three';
import gsap from 'gsap';
import Entity from '../ecs/Entity';
import RigidBody from '../physics/RigidBody';
import { Layers } from '../physics/PhysicsConstants';
import DottedZoneVisualComponent from '../components/DottedZoneVisualComponent';
import GlbVisualComponent from '../components/GlbVisualComponent';
import CharacterVisualComponent from '../components/CharacterVisualComponent';
import BackpackStackVisual, { stackItemScale } from '../components/BackpackStackVisual';
import ItemPile, { ItemPileLayout } from '../components/ItemPile';
import { flyResourceModel } from '../components/FlyToStack';
import ScreenAnchorComponent, { ScreenAnchorHost } from '../components/ScreenAnchorComponent';
import { ZONE_LABEL_ANCHOR_OPTIONS } from '../ui/ZoneLabelConfig';
import { buildLockRequirementPanel } from '../ui/LockRequirementPanel';
import { resolveResourceAssetKey } from '../actions/ResourceRegistry';
import { getAssetIcon } from './AssetLibraryRegistry';
import { BackpackStorage } from '../data/BackpackStorage';
import { StorageInventory } from '../data/StorageInventory';
import { StorageConfig } from '../data/StorageTypes';
import { getZoneColor, ZoneColorKind } from '../data/ZoneColorTypes';
import { RESOURCE_CONFIG, ResourceType } from '../actions/ResourceTypes';
import { ModelSnapshotTool } from '../debug/ModelSnapshotTool';
import MainPlayer from '../player/MainPlayer';

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
const FALLBACK_BACKPACK_HEIGHT = 1.2;
/** Per-axis fallback for a missing StorageConfig.dropOffset value — half-way up Restaurant.Crate. */
const DEFAULT_DROP_OFFSET = { x: 0, y: 0.4, z: 0 };
/** Half-height of StorageConfig.solid's collider — a little over Restaurant.Crate's 0.8. */
const SOLID_HALF_HEIGHT = 0.5;
/** Default gap (world units) between the top of the pile and the bottom of the "only this resource" panel, when StorageConfig.popupBobOffset is unset — see this file's own doc. */
const DEFAULT_ACCEPTS_PANEL_CLEARANCE = 1.0;

export default class StorageZone extends Entity {
    private readonly storageId: string;
    private readonly config: StorageConfig;
    private readonly triggerSize: { width: number; depth: number };
    /** The storage object's OWN footprint — what StorageConfig.solid's collider covers. */
    private readonly storageSize: { width: number; depth: number };
    private readonly screenHost: ScreenAnchorHost;
    /** Storage position relative to this entity (the trigger's center) — see this file's own doc. */
    private readonly meshOffset: THREE.Vector3;

    private visual?: GlbVisualComponent;
    /** Parent of every stored-item model — sits at meshOffset + config.dropOffset, so the pile's local origin IS the drop point. */
    private readonly pileRoot = new THREE.Group();
    private pile!: ItemPile;
    private footprint = { x: FALLBACK_FOOTPRINT, z: FALLBACK_FOOTPRINT };
    /** Items currently flying INTO this storage, in launch order — each aims one pile slot above the one before it. */
    private readonly incoming: number[] = [];
    private nextIncomingId = 1;

    private player?: MainPlayer;
    private isPlayerInside = false;
    private transferring = false;
    private destroyed = false;

    private readonly handleInventoryChanged = (storageId: string): void => {
        if (storageId === this.storageId) {
            this.pile.sync(StorageInventory.getAll(this.storageId));
        }
    };

    public constructor(
        storageId: string,
        config: StorageConfig,
        storagePosition: THREE.Vector3,
        triggerCenter: THREE.Vector3,
        triggerSize: { width: number; depth: number },
        storageSize: { width: number; depth: number },
        screenHost: ScreenAnchorHost,
    ) {
        super();
        this.screenHost = screenHost;
        this.storageId = storageId;
        this.config = config;
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

        this.addComponent(new DottedZoneVisualComponent(width, depth, CORNER_RADIUS, { color: getZoneColor(ZoneColorKind.DropZone) }));

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

        const modelRef = this.config.models[0];
        const modelDef = ModelSnapshotTool.resolveModelRef(modelRef);
        if (modelRef && !modelDef) {
            console.warn(`[StorageZone] "${this.storageId}": model "${String(modelRef)}" is not a known MODELS ref — no mesh`);
        }
        if (modelDef) {
            const visual: GlbVisualComponent = new GlbVisualComponent(
                modelDef,
                this.meshOffset.clone(),
                this.config.scale,
                THREE.MathUtils.degToRad(this.config.rotationDeg),
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

        // Each axis falls back on its own — the web editor can save a partial/empty object
        // (e.g. `dropOffset: {}`), and an undefined axis would put the whole pile at NaN.
        const drop = this.config.dropOffset ?? {};
        this.pileRoot.position.copy(this.meshOffset).add(new THREE.Vector3(
            drop.x ?? DEFAULT_DROP_OFFSET.x,
            drop.y ?? DEFAULT_DROP_OFFSET.y,
            drop.z ?? DEFAULT_DROP_OFFSET.z,
        ));
        this.transform.add(this.pileRoot);
        this.pile = new ItemPile(this.pileRoot, this.buildLayout());
        this.pile.sync(StorageInventory.getAll(this.storageId));
        StorageInventory.onChange.add(this.handleInventoryChanged);

        if (this.config.resourceType !== undefined) {
            this.buildAcceptsPanel(this.config.resourceType);
        }
    }

    public override destroy(): void {
        this.destroyed = true;
        StorageInventory.onChange.remove(this.handleInventoryChanged);
        this.pile.dispose();
        super.destroy();
    }

    /** The "only this resource" panel — see this file's own doc. */
    private buildAcceptsPanel(type: ResourceType): void {
        const panel = buildLockRequirementPanel(getAssetIcon(resolveResourceAssetKey(type)), { showBadge: false });

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
            localPerWorld: 1,
        };
    }

    private accepts(type: ResourceType): boolean {
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
        this.isPlayerInside = true;
        this.player = other.entity;
        this.startTransfer();
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

            const from = new THREE.Vector3();
            const type = this.nextOutgoing(player, from);
            if (type === undefined || !BackpackStorage.removeOne(type)) {
                this.transferring = false;
                return;
            }

            const incomingId = this.nextIncomingId++;
            this.incoming.push(incomingId);
            // Ends at the size it will actually be drawn at in its slot (fit-to-cell included), so it doesn't pop on landing.
            const landingScale = this.pile.getSlotScale(this.pile.count + this.incoming.length - 1, type);
            flyResourceModel({
                parent: scene,
                type,
                from,
                startScale: stackItemScale(),
                endScale: landingScale,
                resolveTarget: target => {
                    // The Nth item in flight aims N slots above the current top of this pile.
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

            gsap.delayedCall(TRANSFER_STAGGER_SEC, step);
        };

        step();
    }

    /** Which accepted item leaves next, and from where (written into `from`) — stacked items top-down first, then anything accepted but not drawn on the stack. See this file's own doc. */
    private nextOutgoing(player: MainPlayer, from: THREE.Vector3): ResourceType | undefined {
        const accepts = (type: ResourceType): boolean => this.accepts(type) && BackpackStorage.getCount(type) > 0;

        const stacked = player.getComponent(BackpackStackVisual)?.peekTop(accepts, from);
        if (stacked !== undefined) {
            return stacked;
        }

        for (const [type, count] of BackpackStorage.getAll()) {
            if (count > 0 && accepts(type)) {
                const backpack = player.getComponent(CharacterVisualComponent)?.character.getBackpackWorldPosition(from);
                if (!backpack) {
                    from.copy(player.transform.position).setY(player.transform.position.y + FALLBACK_BACKPACK_HEIGHT);
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
        const base = this.config.scale;
        gsap.killTweensOf(mesh.scale);
        mesh.scale.setScalar(base * LAND_BOUNCE_SCALE);
        gsap.to(mesh.scale, { x: base, y: base, z: base, duration: LAND_BOUNCE_SEC, ease: 'power2.out' });
    }
}
