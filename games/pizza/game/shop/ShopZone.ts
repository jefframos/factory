// ShopZone.ts
//
// A BuildingZone-style trigger that funds a TOOL UPGRADE LADDER (see
// ShopTypes.ts/ShopUpgradeStorage.ts) instead of a building's resource
// requirements: while the player stands inside, money flies from EconomyUI's
// wallet icon (see spawnFlyingIconFromOverlayPoint()) to this shop one coin
// at a time, crediting ShopUpgradeStorage.addProgress() as each one lands —
// same continuous-drain-while-inside-trigger shape BuildingZone/QueueZone
// both use, just spending EconomyStorage's balance instead of draining
// BackpackStorage. Once the next level's full cost is deposited,
// ShopUpgradeStorage.tryCompleteUpgrade() bumps the level, applies the
// change to ACTION_CONFIG live (see ShopTypes.applyShopLevel()), and starts
// that level's cooldown — the panel then shows "Next upgrade in Ns" until it
// elapses.
//
// Carries a PERSISTENT panel the same way BuildingZone's requirements panel
// does (ScreenAnchorComponent, no ttlSec, mutated in place) — but icon-first
// rather than text-first: the tool's own icon IS the panel (see
// getToolIcon()), with an "upgrade available" arrow badge (see
// SHOP_UPGRADE_AVAILABLE_ICON) overlapping its corner whenever affordable,
// and a money-icon + number row below for cost/progress (or a bare cooldown
// countdown, or "MAX"). No level number/sentences anywhere on this panel.

import * as THREE from 'three';
import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import Entity from '../ecs/Entity';
import RigidBody from '../physics/RigidBody';
import { Layers } from '../physics/PhysicsConstants';
import { BendService } from '../services/BendService';
import ScreenAnchorComponent, { ScreenAnchorHost } from '../components/ScreenAnchorComponent';
import { spawnFlyingIconFromOverlayPoint } from '../components/FlyingResourceIcon';
import { TextStyleRegistry } from '../ui/TextStyleRegistry';
import AutoFitFrame, { uniformFitPadding } from '../ui/AutoFitFrame';
import { ZONE_LABEL_ANCHOR_OPTIONS } from '../ui/ZoneLabelConfig';
import { EconomyStorage } from '../data/EconomyStorage';
import { CURRENCY_CONFIG, CurrencyType } from '../data/EconomyTypes';
import { getAssetIcon } from '../world/AssetLibraryRegistry';
import { ShopUpgradeStorage } from './ShopUpgradeStorage';
import { getToolIcon } from '../actions/ToolRegistry';
import { getShopConfig, ShopConfig, SHOP_UPGRADE_AVAILABLE_ICON } from './ShopTypes';
import MainPlayer from '../player/MainPlayer';

const LABEL_FRAME_PADDING = uniformFitPadding(15);

const HALF_EXTENTS = new THREE.Vector3(1.25, 0.75, 1.25);
const LABEL_HEIGHT_OFFSET = new THREE.Vector3(0, HALF_EXTENTS.y * 2 + 1.2, 0);
const COST_ICON_SIZE = 22;
const FLY_IN_STAGGER_SEC = 0.12;
const ICON_BODY_GAP = 4;
/** The tool's own icon (see ToolRegistry.getToolIcon()) — the panel's main image, replacing what used to be a text nameplate ("less text, more images"). */
const TOOL_ICON_SIZE = 48;
/** Size of the "upgrade available" action badge (see SHOP_UPGRADE_AVAILABLE_ICON) pinned at the tool icon's bottom-right corner — same spot/idiom a level number badge would use (BackpackUI's slot count), just flagging the ACTION ("upgrade") instead of a quantity. */
const UPGRADE_BADGE_SIZE = 24;
/** Inset from the tool icon's own corner, in each axis — a small overlap reads as "pinned to the icon" rather than "floating separately beside it." */
const UPGRADE_BADGE_INSET = 4;

/** A separate deposit-trigger rect, in WORLD space — see the constructor's `triggerArea` param doc. Same shape as BuildingZone's BuildingTriggerArea. */
export interface ShopTriggerArea {
    position: THREE.Vector3;
    footprint: { width: number; depth: number };
}

export default class ShopZone extends Entity {
    private readonly screenHost: ScreenAnchorHost;
    private readonly shopId: string;
    private readonly config: ShopConfig;
    /** Overrides HALF_EXTENTS' X/Z from the shop's OWN footprint (a Tiled object's rect) — same reasoning as BuildingZone's own `footprint` param. Undefined means "use HALF_EXTENTS." Ignored when `triggerArea` is given — see that param's own doc. */
    private readonly footprint?: { width: number; depth: number };
    /**
     * Optional separate deposit-trigger area, in WORLD space — from a Tiled "dropper" object
     * targeting this shop (see WorldObjectRegistry.ts's own doc / PizzaScene.setupShops()).
     * When given, the PLAYER-FACING trigger sits here instead of on the shop's own footprint —
     * e.g. a shop stall drawn against a wall the player can't walk up to, with its real
     * drop-off spot placed elsewhere. The shop's own visual mesh and nameplate are UNAFFECTED
     * — they stay exactly where `position`/`footprint` say regardless. Undefined means "trigger
     * the shop's own footprint" (see this file's own doc — "if it doesn't find [a dropper] the
     * shop is the drop area").
     */
    private readonly triggerArea?: ShopTriggerArea;
    /** Where EconomyUI's money icon actually sits on screen right now — a callback (not a fixed point) since UIService repositions that panel every frame. */
    private readonly getWalletOverlayPosition: () => { x: number; y: number };

    /** True while a coin-deposit loop is already running — guards a second overlapping one starting from another onTriggerStay tick. */
    private draining = false;
    /** True for as long as the player's RigidBody is inside this zone's trigger — the deposit loop checks this before every coin and stops the instant it goes false, same convention as BuildingZone/QueueZone. */
    private isPlayerInside = false;
    private player?: MainPlayer;
    /** Where deposited coins fly TO, and where the shop's own panel tracks — see awake(). */
    private labelAnchor!: THREE.Object3D;

    /** Groups toolIcon/upgradeBadge as one block, repositioned as a unit above bodyContainer — see refreshLabel(). */
    private iconRow!: PIXI.Container;
    /** The tool's own icon — the panel's main image (see TOOL_ICON_SIZE's own doc). Static; never rebuilt, unlike bodyContainer below. */
    private toolIcon!: PIXI.Sprite;
    /** Holds either the next level's cost row + progress, a cooldown countdown, or "MAX" — rebuilt wholesale by refreshLabel(), same as BuildingZone's requirementsContainer. Icon-first (money icon + numbers), same "less text, more images" reasoning as toolIcon replacing the old text nameplate. */
    private bodyContainer!: PIXI.Container;
    /** SHOP_UPGRADE_AVAILABLE_ICON — overlaps the tool icon's top-right corner whenever the player already has enough money on hand to fund the rest of the next level right now, so it reads as "come spend here" from a glance rather than needing to walk up and check. Toggled in refreshLabel(); never shown once maxed. */
    private upgradeBadge!: PIXI.Sprite;
    private labelFrame!: AutoFitFrame;

    private shopMesh?: THREE.Mesh;

    private readonly handleShopChanged = (id: string): void => {
        if (id === this.shopId) {
            this.refreshLabel();
        }
    };

    private readonly handleEconomyChanged = (type: CurrencyType): void => {
        if (type === CurrencyType.Money) {
            this.refreshLabel();
        }
    };

    public constructor(
        position: THREE.Vector3,
        screenHost: ScreenAnchorHost,
        shopId: string,
        getWalletOverlayPosition: () => { x: number; y: number },
        footprint?: { width: number; depth: number },
        triggerArea?: ShopTriggerArea,
        config: ShopConfig | undefined = getShopConfig(shopId),
    ) {
        super();
        if (!config) {
            throw new Error(`ShopZone: no ShopConfig registered for shop id "${shopId}" — see ShopTypes.SHOP_CONFIG_BY_ID`);
        }

        this.screenHost = screenHost;
        this.shopId = shopId;
        this.config = config;
        this.getWalletOverlayPosition = getWalletOverlayPosition;
        this.footprint = footprint;
        this.triggerArea = triggerArea;
        this.transform.position.copy(position);
    }

    public override awake(): void {
        // Trigger footprint (X/Z) matches this.triggerArea's footprint when a separate trigger
        // area was given, else the visible mesh's own footprint — same reasoning as
        // BuildingZone.awake()'s identical computation.
        const triggerFootprint = this.triggerArea?.footprint ?? this.footprint;
        const halfExtents = triggerFootprint
            ? new THREE.Vector3(triggerFootprint.width / 2, HALF_EXTENTS.y, triggerFootprint.depth / 2)
            : HALF_EXTENTS;

        // centerOffset is relative to THIS entity's own transform.position (the shop's visual
        // position) — converting triggerArea's ABSOLUTE world position to an X/Z offset from
        // here is what lets the trigger sit somewhere else on the map while the visual
        // mesh/nameplate stay exactly where `position` says — same as BuildingZone.awake().
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

        this.createShopMesh();

        // iconRow groups the tool icon + upgrade badge (anchored relative to the icon) so the
        // whole block repositions as ONE unit above bodyContainer, the same way titleText used
        // to.
        this.iconRow = new PIXI.Container();

        this.toolIcon = new PIXI.Sprite(getToolIcon(this.config.tool));
        this.toolIcon.anchor.set(0.5, 1);
        this.toolIcon.width = TOOL_ICON_SIZE;
        this.toolIcon.height = TOOL_ICON_SIZE;
        this.iconRow.addChild(this.toolIcon);

        this.upgradeBadge = new PIXI.Sprite(PIXI.Texture.from(SHOP_UPGRADE_AVAILABLE_ICON));
        // Anchored (1, 1) — bottom-right corner of the sprite lands exactly at the position
        // set below, same corner-badge placement a level-number tag would have used (see
        // UPGRADE_BADGE_SIZE's own doc).
        this.upgradeBadge.anchor.set(1, 1);
        this.upgradeBadge.width = UPGRADE_BADGE_SIZE;
        this.upgradeBadge.height = UPGRADE_BADGE_SIZE;
        this.upgradeBadge.position.set(TOOL_ICON_SIZE / 2 - UPGRADE_BADGE_INSET, -UPGRADE_BADGE_INSET);
        this.iconRow.addChild(this.upgradeBadge);

        this.bodyContainer = new PIXI.Container();

        const column = new PIXI.Container();
        column.addChild(this.iconRow, this.bodyContainer);
        this.labelFrame = new AutoFitFrame(LABEL_FRAME_PADDING, 'Popup', column);
        this.refreshLabel();

        // The badge depends on EconomyStorage's live balance (see refreshLabel()'s own doc),
        // not just this shop's own state — ShopUpgradeStorage.onChange alone wouldn't catch
        // the moment a queue reward pushes the wallet over this shop's remaining cost.
        EconomyStorage.onChange.add(this.handleEconomyChanged);

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

        ShopUpgradeStorage.onChange.add(this.handleShopChanged);

        rigidBody.onTriggerEnter.add(other => this.tryDeposit(other));
        rigidBody.onTriggerStay.add(other => this.tryDeposit(other));
        rigidBody.onTriggerExit.add(other => this.handleTriggerExit(other));
    }

    public override destroy(): void {
        ShopUpgradeStorage.onChange.remove(this.handleShopChanged);
        EconomyStorage.onChange.remove(this.handleEconomyChanged);
        this.disposeShopMesh();
        super.destroy();
    }

    /** Ticks the cooldown countdown TEXT every frame while on cooldown — same reasoning as QueueZone.update()'s identical tick: nothing else re-dispatches onChange purely because a second elapsed, so the "Ns" readout would otherwise freeze at whatever it said the moment the level completed. Cheap no-op the rest of the time. */
    public override update(delta: number): void {
        super.update(delta);

        if (ShopUpgradeStorage.isOnCooldown(this.shopId)) {
            this.refreshLabel();
        }
    }

    /** The shop's own visible structure — one fixed mesh per shop (no per-level growth, unlike BuildingZone — see ShopMeshConfig's own doc). Same plain THREE.BoxGeometry placeholder BuildingZone.createBuildingMesh() uses. */
    private createShopMesh(): void {
        const material = new THREE.MeshStandardMaterial({ color: this.config.mesh.color });
        BendService.applyBend(material);

        const [configWidth, height, configDepth] = this.config.mesh.size;
        const width = this.footprint?.width ?? configWidth;
        const depth = this.footprint?.depth ?? configDepth;
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
        mesh.position.set(0, height / 2, 0);
        this.transform.add(mesh);
        this.shopMesh = mesh;
    }

    private disposeShopMesh(): void {
        if (!this.shopMesh) {
            return;
        }
        this.shopMesh.geometry.dispose();
        (this.shopMesh.material as THREE.Material).dispose();
        this.shopMesh.removeFromParent();
        this.shopMesh = undefined;
    }

    /**
     * True while the player already has enough money on hand, right now, to fund the rest of
     * the next level in one go — see upgradeBadge's own doc. Never true once maxed or on
     * cooldown; there's nothing left to flag "come buy this" for in either case.
     */
    private isUpgradeAvailable(): boolean {
        if (ShopUpgradeStorage.isMaxLevel(this.shopId, this.config) || ShopUpgradeStorage.isOnCooldown(this.shopId)) {
            return false;
        }

        const state = ShopUpgradeStorage.getState(this.shopId);
        const remaining = 0//this.config.levels[state.level].cost - state.progress;
        return EconomyStorage.getBalance(CurrencyType.Money) >= remaining;
    }

    /** Rewrites the panel's body from ShopUpgradeStorage's current state and re-fits the frame around the new bounds. Icon-first throughout (tool icon, money icon, upgrade-arrow badge) — the only text left is short numbers, not sentences, per this file's own doc. */
    private refreshLabel(): void {
        this.upgradeBadge.visible = this.isUpgradeAvailable();

        this.bodyContainer.removeChildren().forEach(child => child.destroy({ children: true }));

        let bodyHeight: number;
        if (ShopUpgradeStorage.isMaxLevel(this.shopId, this.config)) {
            const maxLevelText = new PIXI.Text('MAX', TextStyleRegistry.Body);
            maxLevelText.anchor.set(0.5, 1);
            this.bodyContainer.addChild(maxLevelText);
            bodyHeight = maxLevelText.height;
        } else if (ShopUpgradeStorage.isOnCooldown(this.shopId)) {
            const cooldownText = new PIXI.Text(formatCooldown(ShopUpgradeStorage.getCooldownRemainingSec(this.shopId)), TextStyleRegistry.Body);
            cooldownText.anchor.set(0.5, 1);
            this.bodyContainer.addChild(cooldownText);
            bodyHeight = cooldownText.height;
        } else {
            const state = ShopUpgradeStorage.getState(this.shopId);
            const cost = this.config.levels[state.level].cost;

            const row = new PIXI.Container();
            const icon = new PIXI.Sprite(getAssetIcon(CURRENCY_CONFIG[CurrencyType.Money].assetKey));
            icon.anchor.set(0, 0.5);
            icon.width = COST_ICON_SIZE;
            icon.height = COST_ICON_SIZE;
            row.addChild(icon);

            const costText = new PIXI.Text(`${state.progress}/${cost}`, TextStyleRegistry.Body);
            costText.anchor.set(0, 0.5);
            costText.position.set(COST_ICON_SIZE + 4, 0);
            row.addChild(costText);

            row.pivot.set(row.width / 2, row.height / 2);
            row.position.set(0, -row.height / 2);
            this.bodyContainer.addChild(row);
            bodyHeight = row.height;
        }

        this.iconRow.position.set(0, -(bodyHeight + ICON_BODY_GAP));
        this.labelFrame.fit();
    }

    private tryDeposit(other: RigidBody): void {
        const player = other.entity;
        if (!(player instanceof MainPlayer)) {
            return;
        }

        this.isPlayerInside = true;
        this.player = player;

        if (ShopUpgradeStorage.isMaxLevel(this.shopId, this.config) || ShopUpgradeStorage.isOnCooldown(this.shopId)) {
            return;
        }

        this.flyInCoins();
    }

    /** Player's RigidBody left this zone's trigger — the deposit loop reads isPlayerInside before every coin, so clearing it here is the ENTIRE "stop depositing" instruction, same shape as BuildingZone/QueueZone's identical handler. */
    private handleTriggerExit(other: RigidBody): void {
        if (other.entity !== this.player) {
            return;
        }

        this.isPlayerInside = false;
        this.player = undefined;
    }

    /**
     * Drains EconomyStorage's Money balance one coin at a time toward this shop's NEXT level,
     * re-checking isPlayerInside/cooldown/max-level before every single coin — not a fixed
     * burst computed once at trigger time. Same self-rescheduling step() shape as
     * BuildingZone.flyInResource()/QueueZone.flyInResource(), except the coin's flight departs
     * from wherever EconomyUI's wallet icon renders on screen right now (an overlay point, not
     * a world position) rather than the player's backpack.
     */
    private flyInCoins(): void {
        if (this.draining) {
            return;
        }
        this.draining = true;

        const icon = getAssetIcon(CURRENCY_CONFIG[CurrencyType.Money].assetKey);
        const toWorld = new THREE.Vector3();

        const step = (): void => {
            const stillWants = this.isPlayerInside
                && !ShopUpgradeStorage.isMaxLevel(this.shopId, this.config)
                && !ShopUpgradeStorage.isOnCooldown(this.shopId)
                && EconomyStorage.getBalance(CurrencyType.Money) > 0;

            if (!stillWants) {
                this.draining = false;
                return;
            }

            this.labelAnchor.getWorldPosition(toWorld);

            spawnFlyingIconFromOverlayPoint(this.screenHost, this.getWalletOverlayPosition, toWorld.clone(), icon, () => {
                EconomyStorage.spend(CurrencyType.Money, 1);
                ShopUpgradeStorage.addProgress(this.shopId, this.config, 1);
                ShopUpgradeStorage.tryCompleteUpgrade(this.shopId, this.config);
            });

            gsap.delayedCall(FLY_IN_STAGGER_SEC, step);
        };

        step();
    }
}

/** "Next upgrade in 5m 0s"/"Next upgrade in 42s" — see refreshLabel(). */
function formatCooldown(totalSec: number): string {
    const minutes = Math.floor(totalSec / 60);
    const seconds = totalSec % 60;
    return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}
