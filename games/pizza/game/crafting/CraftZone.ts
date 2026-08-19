// CraftZone.ts
//
// A BuildingZone-style trigger, but funding a CRAFTING TABLE's independent
// recipe set (see CraftTypes.ts/CraftStorage.ts) instead of a single upgrade
// ladder: while the player stands inside, pulls whatever the CURRENT active
// recipe's cost still needs out of BackpackStorage one unit at a time (same
// continuous drain-while-inside-trigger + flying-icon cascade BuildingZone/
// QueueZone use), crediting CraftStorage.addProgress(). Once a recipe's full
// cost lands, CraftStorage.tryCompleteRecipe() credits ItemStorage with the
// payout and moves the table on to whichever recipe is next (see
// CraftStorage.getNextRecipe()) — refreshLabel() just re-reads whatever that
// next recipe is, no separate "level up" sequence needed since there's no
// mesh/ladder to advance, just a different recipe's requirements to show.
//
// Once every recipe's been crafted (CraftStorage.isFullyCrafted()), a
// `destroyOnComplete` table leaves the world immediately, the instant the
// LAST recipe's final unit lands (see flyInResource()'s completion
// callback) — there is no "fully-crafted" state this table EVER renders,
// not even for a single frame: refreshLabel() special-cases exactly this
// combination to just hide everything instead of building an "All
// Crafted!" panel first. A one-shot starter table is done being interacted
// with the moment it's spent, so nothing is gained by still showing it
// (complete) for any length of time before it goes — see this file's own
// history for the earlier "fade out after a delay" version this replaced.
// A permanent table (`destroyOnComplete: false`) still shows that "All
// Crafted!" panel forever, since it never leaves at all — see
// CraftTypes.ts's own doc for why that's also the right setting for a
// table meant to keep producing rarer/"good" items.
//
// Carries a PERSISTENT nameplate/requirements panel the same way
// BuildingZone's does (ScreenAnchorComponent, no ttlSec, mutated in place),
// icon-first like ShopZone's panel: the recipe's OUTPUT item icon sits above
// the cost requirement row, so the panel reads as "here's what you're
// making" rather than a plain title string.

import * as THREE from 'three';
import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import Entity from '../ecs/Entity';
import RigidBody from '../physics/RigidBody';
import { Layers } from '../physics/PhysicsConstants';
import { BendService } from '../services/BendService';
import ScreenAnchorComponent, { ScreenAnchorHost } from '../components/ScreenAnchorComponent';
import DottedZoneVisualComponent from '../components/DottedZoneVisualComponent';
import CharacterVisualComponent from '../components/CharacterVisualComponent';
import { spawnFlyingResourceIcon } from '../components/FlyingResourceIcon';
import { TextStyleRegistry } from '../ui/TextStyleRegistry';
import AutoFitFrame, { uniformFitPadding } from '../ui/AutoFitFrame';
import ViewUtils from 'core/utils/ViewUtils';
import { BackpackStorage } from '../data/BackpackStorage';
import { CraftStorage } from './CraftStorage';
import { CraftRecipeDef, CraftTableConfig, getCraftConfig } from './CraftTypes';
import { getItemIcon, ITEM_CONFIG } from './ItemTypes';
import { ResourceType } from '../actions/ResourceTypes';
import { RESOURCE_ASSET_KEYS } from '../actions/ResourceRegistry';
import { getAssetIcon } from '../world/AssetLibraryRegistry';
import { ZONE_LABEL_ANCHOR_OPTIONS } from '../ui/ZoneLabelConfig';
import { createResourceSlot } from '../ui/ResourceSlotVisual';
import MainPlayer from '../player/MainPlayer';
import { UpgradeNotificationManager } from '../ui/notifications/UpgradeNotificationManager';
import { NotificationRarity, NotificationType } from '../ui/notifications/NotificationTypes';
import { WorldProgressionHost } from '../camera/WorldProgressionHost';

/** A separate deposit-trigger rect, in WORLD space — see the constructor's `triggerArea` param doc. Same shape as BuildingZone's BuildingTriggerArea/ShopZone's ShopTriggerArea. */
export interface CraftTriggerArea {
    position: THREE.Vector3;
    footprint: { width: number; depth: number };
}

const LABEL_FRAME_PADDING = uniformFitPadding(15);

const HALF_EXTENTS = new THREE.Vector3(1.25, 0.75, 1.25);
/** Dotted-outline color — distinct from every other zone's own hue (see QueueZone/BuildingZone/ShopZone), so a craft table reads as its own kind of zone on the map until real art exists. */
const CRAFT_BOX_COLOR = 0xcc44cc;
const CRAFT_ZONE_CORNER_RADIUS = 0.3;
const LABEL_HEIGHT_OFFSET = new THREE.Vector3(0, HALF_EXTENTS.y * 2 + 1.2, 0);
const FLY_IN_STAGGER_SEC = 0.12;
/** The table's own placeholder mesh — a plain box until real art exists, same convention as BuildingZone/ShopZone's mesh. */
const TABLE_MESH_SIZE: [number, number, number] = [1.6, 0.9, 1.6];
const TABLE_MESH_COLOR = 0x7a5a3a;
/** The active recipe's own output icon — the panel's main image, same "icon-first" idiom ShopZone's tool icon uses. */
const RESULT_ICON_SIZE = 48;
const ICON_BODY_GAP = 4;
const REQ_SLOT_SIZE = 56;
const REQ_SLOT_GAP = 10;

export default class CraftZone extends Entity {
    private readonly screenHost: ScreenAnchorHost;
    private readonly craftId: string;
    private readonly config: CraftTableConfig;
    /** Overrides HALF_EXTENTS' X/Z from a Tiled object's rect — same reasoning as BuildingZone's own `footprint` param. Ignored when `triggerArea` is given — see that param's own doc. */
    private readonly footprint?: { width: number; depth: number };
    /** Optional separate deposit-trigger area, in WORLD space — from a Tiled "dropper" object targeting this craft table (see WorldObjectRegistry.ts's own doc / PizzaScene.setupCraftTables()). When given, the PLAYER-FACING trigger sits here instead of on the table's own footprint. The table's own visual mesh/panel are UNAFFECTED — they stay exactly where `position`/`footprint` say regardless. Undefined means "trigger the table's own footprint," same as BuildingZone/ShopZone. */
    private readonly triggerArea?: CraftTriggerArea;
    /** Optional — when given, notified (fire-and-forget, see flyInResource()'s own doc) right after a recipe's item is credited, so a gate whose requirement is owning that item can unlock. Undefined means "nothing to notify," same as BuildingZone's own optional CameraFocusHost/WorldProgressionHost params. */
    private readonly worldProgressionHost?: WorldProgressionHost;

    /** Resource types currently mid-drain via flyInResource() — guards a second overlapping drain loop for the same type. */
    private readonly draining = new Set<ResourceType>();
    private isPlayerInside = false;
    private player?: MainPlayer;
    private labelAnchor!: THREE.Object3D;

    private tableMesh?: THREE.Mesh;
    /** True the instant this table decides it's about to leave the world for good (see flyInResource()'s completion callback) — guards tryDeposit()/flyInResource()'s own step() from starting or continuing a deposit into a table that's already gone. */
    private destroying = false;

    private resultIcon!: PIXI.Sprite;
    /** Holds either the active recipe's cost row (see ResourceSlotVisual.ts) or an "All Crafted!" text — rebuilt wholesale by refreshLabel(). */
    private bodyContainer!: PIXI.Container;
    private labelFrame!: AutoFitFrame;

    private readonly handleCraftChanged = (id: string): void => {
        if (id === this.craftId) {
            this.refreshLabel();
        }
    };

    public constructor(
        position: THREE.Vector3,
        screenHost: ScreenAnchorHost,
        craftId: string,
        footprint?: { width: number; depth: number },
        triggerArea?: CraftTriggerArea,
        worldProgressionHost?: WorldProgressionHost,
        config: CraftTableConfig | undefined = getCraftConfig(craftId),
    ) {
        super();
        if (!config) {
            throw new Error(`CraftZone: no CraftTableConfig registered for craft id "${craftId}" — see CraftTypes.CRAFT_CONFIG_BY_ID`);
        }

        this.screenHost = screenHost;
        this.craftId = craftId;
        this.config = config;
        this.footprint = footprint;
        this.triggerArea = triggerArea;
        this.worldProgressionHost = worldProgressionHost;
        this.transform.position.copy(position);
    }

    public override awake(): void {
        // Trigger footprint (X/Z) matches this.triggerArea's footprint when a separate trigger
        // area was given, else the table's own footprint — same reasoning as
        // BuildingZone.awake()'s identical computation.
        const triggerFootprint = this.triggerArea?.footprint ?? this.footprint;
        const halfExtents = triggerFootprint
            ? new THREE.Vector3(triggerFootprint.width / 2, HALF_EXTENTS.y, triggerFootprint.depth / 2)
            : HALF_EXTENTS;

        // centerOffset is relative to THIS entity's own transform.position (the table's visual
        // position) — converting triggerArea's ABSOLUTE world position to an X/Z offset from
        // here is what lets the trigger sit somewhere else on the map while the visual
        // mesh/panel stay exactly where `position` says — same as BuildingZone.awake().
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
        this.addComponent(new DottedZoneVisualComponent(
            halfExtents.x * 2,
            halfExtents.z * 2,
            CRAFT_ZONE_CORNER_RADIUS,
            { color: CRAFT_BOX_COLOR },
            centerOffset,
        ));

        this.createTableMesh();

        this.resultIcon = new PIXI.Sprite();
        this.resultIcon.anchor.set(0.5, 1);

        this.bodyContainer = new PIXI.Container();

        const column = new PIXI.Container();
        column.addChild(this.resultIcon, this.bodyContainer);
        this.labelFrame = new AutoFitFrame(LABEL_FRAME_PADDING, 'Popup', column);
        this.refreshLabel();

        this.labelAnchor = new THREE.Object3D();
        this.labelAnchor.position.copy(LABEL_HEIGHT_OFFSET);
        this.transform.add(this.labelAnchor);
        const labelAnchorWorldPosition = new THREE.Vector3();

        this.addComponent(new ScreenAnchorComponent(
            this.screenHost,
            this.labelFrame,
            () => this.labelAnchor.getWorldPosition(labelAnchorWorldPosition),
            ZONE_LABEL_ANCHOR_OPTIONS,
        ));

        CraftStorage.onChange.add(this.handleCraftChanged);

        rigidBody.onTriggerEnter.add(other => this.tryDeposit(other));
        rigidBody.onTriggerStay.add(other => this.tryDeposit(other));
        rigidBody.onTriggerExit.add(other => this.handleTriggerExit(other));
    }

    public override destroy(): void {
        CraftStorage.onChange.remove(this.handleCraftChanged);
        this.disposeTableMesh();
        super.destroy();
    }

    private createTableMesh(): void {
        const material = new THREE.MeshStandardMaterial({ color: TABLE_MESH_COLOR });
        BendService.applyBend(material);

        const [configWidth, height, configDepth] = TABLE_MESH_SIZE;
        const width = this.footprint?.width ?? configWidth;
        const depth = this.footprint?.depth ?? configDepth;
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
        mesh.position.set(0, height / 2, 0);
        this.transform.add(mesh);
        this.tableMesh = mesh;
    }

    private disposeTableMesh(): void {
        if (!this.tableMesh) {
            return;
        }
        gsap.killTweensOf(this.tableMesh.scale);
        this.tableMesh.geometry.dispose();
        (this.tableMesh.material as THREE.Material).dispose();
        this.tableMesh.removeFromParent();
        this.tableMesh = undefined;
    }

    /** Rewrites the panel from CraftStorage's current state and re-fits the frame around the new bounds. */
    private refreshLabel(): void {
        this.bodyContainer.removeChildren().forEach(child => child.destroy({ children: true }));

        if (CraftStorage.isFullyCrafted(this.craftId, this.config)) {
            // A destroyOnComplete table never renders a "fully crafted" state at all — it's
            // leaving the world in this same instant (see flyInResource()'s completion
            // callback), so there's nothing worth building a panel for. Just go quiet.
            if (this.config.destroyOnComplete) {
                this.resultIcon.visible = false;
                this.labelFrame.visible = false;
                this.labelFrame.fit();
                return;
            }

            this.resultIcon.visible = false;

            const doneText = new PIXI.Text('All Crafted!', TextStyleRegistry.Body);
            doneText.anchor.set(0.5, 1);
            this.bodyContainer.addChild(doneText);
            this.labelFrame.fit();
            return;
        }

        const recipe = CraftStorage.getNextRecipe(this.craftId, this.config)!;

        this.resultIcon.visible = true;
        this.resultIcon.texture = getItemIcon(recipe.result.item);
        this.resultIcon.scale.set(ViewUtils.elementScaler(this.resultIcon, RESULT_ICON_SIZE));

        const entries = Object.entries(recipe.cost) as [ResourceType, number][];
        const slots = entries.map(([type, need]) => {
            const have = CraftStorage.getProgress(this.craftId, type);
            return createResourceSlot(type, REQ_SLOT_SIZE, `${have}/${need}`);
        });
        const bodyHeight = Math.max(REQ_SLOT_SIZE, ...slots.map(slot => slot.visualHeight));

        const rowWidth = entries.length * REQ_SLOT_SIZE + Math.max(0, entries.length - 1) * REQ_SLOT_GAP;
        slots.forEach((slot, index) => {
            slot.container.position.set(-rowWidth / 2 + index * (REQ_SLOT_SIZE + REQ_SLOT_GAP), -bodyHeight);
            this.bodyContainer.addChild(slot.container);
        });

        this.resultIcon.position.set(0, -(bodyHeight + ICON_BODY_GAP));
        this.labelFrame.fit();
    }

    private tryDeposit(other: RigidBody): void {
        const player = other.entity;
        if (!(player instanceof MainPlayer) || this.destroying || CraftStorage.isFullyCrafted(this.craftId, this.config)) {
            return;
        }

        const recipe = CraftStorage.getNextRecipe(this.craftId, this.config);
        if (!recipe) {
            return;
        }

        this.isPlayerInside = true;
        this.player = player;

        for (const type of Object.keys(recipe.cost) as ResourceType[]) {
            this.flyInResource(type);
        }
    }

    /** Player's RigidBody left this zone's trigger — flyInResource()'s loop reads isPlayerInside before every unit, so clearing it here is the ENTIRE "stop depositing" instruction, same shape as BuildingZone/QueueZone's identical handler. */
    private handleTriggerExit(other: RigidBody): void {
        if (other.entity !== this.player) {
            return;
        }

        this.isPlayerInside = false;
        this.player = undefined;
    }

    /**
     * Drains `type` out of BackpackStorage one unit at a time toward the table's CURRENT
     * active recipe, re-checking isPlayerInside and that recipe's identity/progress before
     * every single unit — not a fixed burst computed once at trigger time. Same self-
     * rescheduling step() shape as BuildingZone.flyInResource().
     */
    private flyInResource(type: ResourceType): void {
        if (this.draining.has(type)) {
            return;
        }
        this.draining.add(type);

        const icon = getAssetIcon(RESOURCE_ASSET_KEYS[type]);
        const toWorld = new THREE.Vector3();

        const step = (): void => {
            const recipe = this.isPlayerInside && !this.destroying ? CraftStorage.getNextRecipe(this.craftId, this.config) : undefined;
            const need = recipe?.cost[type] ?? 0;
            const remaining = need - CraftStorage.getProgress(this.craftId, type);

            const fromWorld = remaining > 0 && BackpackStorage.getCount(type) > 0
                ? this.player?.getComponent(CharacterVisualComponent)?.character.getBackpackWorldPosition()
                : undefined;

            if (!fromWorld) {
                this.draining.delete(type);
                return;
            }

            this.labelAnchor.getWorldPosition(toWorld);

            spawnFlyingResourceIcon(this.screenHost, fromWorld.clone(), toWorld.clone(), icon, () => {
                BackpackStorage.removeOne(type);
                CraftStorage.addProgress(this.craftId, this.config, type, 1);
                const completedRecipe = CraftStorage.tryCompleteRecipe(this.craftId, this.config);
                if (!completedRecipe) {
                    return;
                }

                // CraftStorage.tryCompleteRecipe()'s own onChange dispatch already ran
                // refreshLabel() synchronously (see handleCraftChanged) — for a
                // destroyOnComplete table that just went fully crafted, that already hid
                // everything rather than rendering an "All Crafted!" state (see
                // refreshLabel()'s own doc), so leaving the world right here means this table
                // is NEVER visibly rendered complete, not even for one frame.
                this.announceNewTool(completedRecipe);

                // Fire-and-forget, deliberately NOT awaited — a gate's own unlock sequence
                // (camera travel, collapse) has nothing to do with whether THIS table's
                // entity still exists, and this table disappearing immediately (see below)
                // must not wait on that sequence finishing first.
                void this.worldProgressionHost?.notifyItemCrafted(completedRecipe.result.item);

                if (this.config.destroyOnComplete && CraftStorage.isFullyCrafted(this.craftId, this.config)) {
                    this.destroying = true;
                    this.world?.remove(this);
                }
            });

            gsap.delayedCall(FLY_IN_STAGGER_SEC, step);
        };

        step();
    }

    /** A new-tool callout for `recipe`'s payout — see NotificationType.NewTool's own doc for why this is distinct from ShopZone's Upgrade notification (an EXISTING tool getting better, not a new one being obtained). Always Common rarity/green badge, per this table's own design — a table meant to hand out rarer items later can still show off via a different rarity there without this call site changing. */
    private announceNewTool(recipe: CraftRecipeDef): void {
        const itemConfig = ITEM_CONFIG[recipe.result.item];
        UpgradeNotificationManager.instance.show({
            type: NotificationType.NewTool,
            rarity: NotificationRarity.Common,
            icon: getItemIcon(recipe.result.item),
            title: 'NEW TOOL!',
            subtitle: itemConfig.label.toUpperCase(),
        });
    }
}
