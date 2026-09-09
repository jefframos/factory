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
import { buildSolidArea } from '../physics/SolidArea';
import { BendService } from '../services/BendService';
import ScreenAnchorComponent, { ScreenAnchorHost } from '../components/ScreenAnchorComponent';
import DottedZoneVisualComponent from '../components/DottedZoneVisualComponent';
import { spawnFlyingIconFromOverlayPoint } from '../components/FlyingResourceIcon';
import { TextStyleRegistry } from '../ui/TextStyleRegistry';
import AutoFitFrame, { uniformFitPadding } from '../ui/AutoFitFrame';
import { ZONE_LABEL_ANCHOR_OPTIONS } from '../ui/ZoneLabelConfig';
import { resolvePopupFrameName, resolvePopupAnchorOffset, resolvePopupAvoidViewer } from '../ui/PopupConfig';
import { FrameRegistry } from '../ui/FrameRegistry';
import { EconomyStorage } from '../data/EconomyStorage';
import { CURRENCY_CONFIG, CurrencyType } from '../data/EconomyTypes';
import { getAssetIcon } from '../world/AssetLibraryRegistry';
import { getToolIcon } from '../actions/ToolRegistry';
import { ShopUpgradeStorage } from './ShopUpgradeStorage';
import { UpgradeNotificationManager } from '../ui/notifications/UpgradeNotificationManager';
import { NotificationRarity, NotificationType } from '../ui/notifications/NotificationTypes';
import { getShopConfig, getUpgradeCost, getViewIdForShopLevel, ShopConfig, SHOP_UPGRADE_AVAILABLE_ICON } from './ShopTypes';
import MainPlayer from '../player/MainPlayer';
import GlbVisualComponent from '../components/GlbVisualComponent';
import { resolveEntityView } from '../world/EntityViewRegistry';
import { getZoneColor, ZoneColorKind } from '../data/ZoneColorTypes';

const LABEL_FRAME_PADDING = uniformFitPadding(15);

const HALF_EXTENTS = new THREE.Vector3(1.25, 0.75, 1.25);
/** Corner rounding for the dropper's floor outline — purely cosmetic, the collider itself stays a sharp-cornered box (see RigidBody below). */
const DROPPER_ZONE_CORNER_RADIUS = 0.3;
const COST_ICON_SIZE = 22;
/** Gap between the cost row's money icon and its "progress/cost" text — see refreshLabel(). */
const COST_ICON_TEXT_GAP = 10;
const FLY_IN_STAGGER_SEC = 0.12;
/** Frame texture swapped in via labelFrame.setTexture() while ShopUpgradeStorage.isOnCooldown() — see refreshLabel(). */
const COOLDOWN_FRAME_TEXTURE = 'ResourceBar_Single_Btn_Grey';
/** Frame texture swapped in via labelFrame.setTexture() while isUpgradeAvailable() — see refreshLabel(). */
const AVAILABLE_FRAME_TEXTURE = 'ResourceBar_Single_Btn_Orange1';
const ICON_BODY_GAP = 22;
/** The tool's own icon (see ToolRegistry.getToolIcon()) — the panel's main image, replacing what used to be a text nameplate ("less text, more images"). */
const TOOL_ICON_SIZE = 40;
/** Size of the "upgrade available" action badge (see SHOP_UPGRADE_AVAILABLE_ICON) pinned at the tool icon's bottom-right corner — same spot/idiom a level number badge would use (BackpackUI's slot count), just flagging the ACTION ("upgrade") instead of a quantity. */
const UPGRADE_BADGE_SIZE = 18;
/** Inset from the tool icon's own corner, in each axis — a small overlap reads as "pinned to the icon" rather than "floating separately beside it." */
const UPGRADE_BADGE_INSET = -2;

/** A separate deposit-trigger rect, in WORLD space — see the constructor's `triggerArea` param doc. Same shape as BuildingZone's BuildingTriggerArea. */
export interface ShopTriggerArea {
    position: THREE.Vector3;
    footprint: { width: number; depth: number };
}

export default class ShopZone extends Entity {
    private readonly screenHost: ScreenAnchorHost;
    private readonly shopId: string;
    private readonly config: ShopConfig;
    /** This zone's own intended resting world-Y, captured once from the constructor's `position` — see BuildingZone's identical field for why this must NOT be read back off `this.transform.position.y` later (ZoneVisibilityManager's transient sunk-then-rise animation). */
    private readonly restY: number;
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
    /**
     * How many coins have DEPARTED but not yet LANDED — see flyInCoins()'s own doc for why
     * this exists: EconomyStorage's balance only drops on LANDING (a ~0.45s flight), but a new
     * coin departs every FLY_IN_STAGGER_SEC (0.12s) — reading the live balance alone at
     * departure time would keep seeing "still have money" and send out more coins than the
     * wallet actually holds, over-crediting this shop's progress on landing. Incremented right
     * before a departure, decremented the instant that same coin lands.
     *
     * Deliberately NEVER reset to 0 anywhere (not even at a fresh flyInCoins() call) — same
     * "persistent field, only ever incremented on departure / decremented on landing" shape
     * BuildingZone.inFlightByType/DropZone.inFlightByType/CraftZone.inFlightByType/
     * QueueZone.inFlightByType all use. A drain loop stopping and IMMEDIATELY restarting
     * (onTriggerStay fires every physics tick, well inside a single 0.45s flight) is the normal
     * case, not the exception — resetting this on restart would wipe out the true in-flight
     * count while coins are still mid-air, re-opening the departure gate and sending out more
     * than the wallet/level actually calls for (the exact bug confirmed and fixed in
     * QueueZone.ts's own inFlightByType — see that file's own doc for the worked example).
     */
    private inFlightCoins = 0;
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
    /** labelFrame's own starting texture (from FrameRegistry, per resolvePopupFrameName()'s pick) — what refreshLabel() restores labelFrame to via setTexture() once neither COOLDOWN_FRAME_TEXTURE nor AVAILABLE_FRAME_TEXTURE applies. Undefined for a frame with no background texture at all (e.g. 'Simple', popupMode 'simple') — refreshLabel() leaves those alone entirely rather than painting a background where there was deliberately none. */
    private defaultFrameTexture?: string;

    private shopMesh?: THREE.Mesh;
    /** The real-glb counterpart to `shopMesh` above, used instead of it when the currently-bought level's `view` id resolves to an actual model (see ShopTypes.ts's getViewIdForShopLevel()/EntityViewRegistry.ts's resolveEntityView()). Mutually exclusive with `shopMesh`. */
    private shopVisual?: GlbVisualComponent;
    /** The view id `shopMesh`/`shopVisual` was last built from — lets handleShopChanged() tell "the bought level advanced past a view-bearing entry" (rebuild the mesh) apart from "just the cost/progress display changed" (recompute the label only). */
    private currentViewId?: string;

    private readonly handleShopChanged = (id: string): void => {
        if (id !== this.shopId) {
            return;
        }

        const boughtLevels = ShopUpgradeStorage.getState(this.shopId).level;
        if (getViewIdForShopLevel(this.config, boughtLevels) !== this.currentViewId) {
            this.disposeShopMesh();
            // reveal=true only here — an upgrade swapping in a new mesh — not on the initial
            // awake() build, which should just appear normally.
            this.createShopMesh(true);
        }
        this.refreshLabel();
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
        this.restY = position.y;
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

        const solidArea = buildSolidArea(halfExtents, centerOffset, this.config.solid ?? 0);
        if (solidArea) {
            this.addComponent(solidArea);
        }

        // Traces the ACTUAL deposit trigger's own footprint/position on the floor — same
        // dotted-outline technique as QueueZone/DropZone/BuildingZone. Needed independently of
        // the shop's own visual mesh below since a triggerArea (a Tiled "dropper") can sit
        // anywhere on the map, entirely apart from where the shop itself is drawn.
        this.addComponent(new DottedZoneVisualComponent(
            halfExtents.x * 2,
            halfExtents.z * 2,
            DROPPER_ZONE_CORNER_RADIUS,
            { color: getZoneColor(ZoneColorKind.ShopDropper) },
            centerOffset,
        ));

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
        const frameName = resolvePopupFrameName(this.config.popupMode, 'ShopFrame', this.config.frame);
        this.labelFrame = new AutoFitFrame(LABEL_FRAME_PADDING, frameName, column);
        this.defaultFrameTexture = FrameRegistry[frameName].textureKey;
        this.refreshLabel();

        // The badge depends on EconomyStorage's live balance (see refreshLabel()'s own doc),
        // not just this shop's own state — ShopUpgradeStorage.onChange alone wouldn't catch
        // the moment a queue reward pushes the wallet over this shop's remaining cost.
        EconomyStorage.onChange.add(this.handleEconomyChanged);

        this.labelAnchor = new THREE.Object3D();
        this.labelAnchor.position.copy(resolvePopupAnchorOffset(this.config.popupBobOffset));
        this.transform.add(this.labelAnchor);
        const labelAnchorWorldPosition = new THREE.Vector3();

        this.addComponent(new ScreenAnchorComponent(
            this.screenHost,
            this.labelFrame,
            () => this.labelAnchor.getWorldPosition(labelAnchorWorldPosition),
            { ...ZONE_LABEL_ANCHOR_OPTIONS, ...resolvePopupAvoidViewer(this.config.popupMode) },
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

    /**
     * True as of the last update() tick — lets update() below tell "still counting down"
     * apart from "just finished this frame," so it can fire exactly one extra refreshLabel()
     * the moment the cooldown expires. Without that trailing call, the panel would freeze on
     * whatever it last rendered ("0s") forever: nothing else re-dispatches onChange purely
     * because a second elapsed, and this loop stops calling refreshLabel() the instant
     * isOnCooldown() goes false, one tick too early to ever repaint the next-upgrade view.
     */
    private wasOnCooldown = false;

    /** Ticks the cooldown countdown TEXT every frame while on cooldown — same reasoning as QueueZone.update()'s identical tick — and repaints once more on the transition out, so the panel swaps over to the next upgrade's cost row (or "MAX") the instant the countdown reaches 0 instead of sitting frozen on "0s". Cheap no-op the rest of the time. */
    public override update(delta: number): void {
        super.update(delta);

        const onCooldown = ShopUpgradeStorage.isOnCooldown(this.shopId);
        if (onCooldown || this.wasOnCooldown) {
            this.refreshLabel();
        }
        this.wasOnCooldown = onCooldown;
    }

    /**
     * The shop's own visible structure — the box placeholder (`config.mesh`) by default, or a
     * real glb when the currently-bought level's `view` id resolves to an actual model (see
     * getViewIdForShopLevel()/EntityViewRegistry.ts's resolveEntityView()). Re-called by
     * handleShopChanged() whenever a purchase advances past a view-bearing level.
     */
    private createShopMesh(reveal: boolean = false): void {
        const boughtLevels = ShopUpgradeStorage.getState(this.shopId).level;
        this.currentViewId = getViewIdForShopLevel(this.config, boughtLevels);
        const resolved = resolveEntityView(this.currentViewId);

        if (resolved) {
            const [offsetX, offsetY, offsetZ] = resolved.offset;
            this.shopVisual = this.addComponent(new GlbVisualComponent(
                resolved.model,
                new THREE.Vector3(offsetX, offsetY, offsetZ),
                resolved.scale,
                THREE.MathUtils.degToRad(resolved.rotationDeg),
                // The glb loads asynchronously — the reveal sweep needs the finished mesh's
                // world bounds, so it's set up in onReady rather than right after construction.
                reveal ? () => this.playRevealEffect(this.shopVisual!.mesh) : undefined,
            ));
            return;
        }

        const material = new THREE.MeshStandardMaterial({ color: this.config.mesh.color });
        BendService.applyBend(material);

        const [configWidth, height, configDepth] = this.config.mesh.size;
        const width = this.footprint?.width ?? configWidth;
        const depth = this.footprint?.depth ?? configDepth;
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
        mesh.position.set(0, height / 2, 0);
        this.transform.add(mesh);
        this.shopMesh = mesh;

        if (reveal) {
            this.playRevealEffect(mesh);
        }
    }

    /**
     * Sweeps a bottom-to-top reveal cutout (see BendService.applyReveal's own doc) across
     * every material of `root`, over its own world-space Y bounds — used when a building
     * upgrade swaps in a new mesh, so the new level "grows in" instead of just popping in.
     */
    private playRevealEffect(root: THREE.Object3D): void {
        // See BuildingZone.playRevealEffect()'s own doc — `root` was just parented this same
        // tick, so its matrixWorld chain needs forcing before Box3 reads world positions off it.
        root.updateMatrixWorld(true);
        const bounds = new THREE.Box3().setFromObject(root);
        // See BuildingZone.playRevealEffect()'s own doc — this.transform.position.y can still
        // be mid-rise (ZoneVisibilityManager's sunk-then-rise-into-view animation) the instant
        // this runs, so correct the measured bounds to where they'll end up once it settles at
        // restY, then clamp the bottom to that same restY (some glbs carry a buried
        // foundation/base mesh below their actual visible ground level).
        const riseCorrection = this.restY - this.transform.position.y;
        const correctedMaxY = bounds.max.y + riseCorrection;
        const revealMinY = Math.max(bounds.min.y + riseCorrection, this.restY);
        const progress = { value: 0 };
        root.traverse(child => {
            if (child instanceof THREE.Mesh) {
                const materials = Array.isArray(child.material) ? child.material : [child.material];
                materials.forEach(material => BendService.applyReveal(material, revealMinY, correctedMaxY, progress));
            }
        });
        gsap.to(progress, { value: 1, duration: 0.6, ease: 'power2.out' });
    }

    private disposeShopMesh(): void {
        if (this.shopMesh) {
            this.shopMesh.geometry.dispose();
            (this.shopMesh.material as THREE.Material).dispose();
            this.shopMesh.removeFromParent();
            this.shopMesh = undefined;
        }

        if (this.shopVisual) {
            this.shopVisual.destroy();
            this.shopVisual = undefined;
        }
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
        const remaining = getUpgradeCost(this.config, state.level) - state.progress;
        return EconomyStorage.getBalance(CurrencyType.Money) >= remaining;
    }

    /** Rewrites the panel's body from ShopUpgradeStorage's current state and re-fits the frame around the new bounds. Icon-first throughout (tool icon, money icon, upgrade-arrow badge) — the only text left is short numbers, not sentences, per this file's own doc. `popupMode: 'none'` (see PopupConfig.ts's own doc) skips all of this and keeps the panel permanently hidden; `'simple'` drops the tool-icon header (iconRow), keeping only the cost/cooldown row. */
    private refreshLabel(): void {
        if (this.config.popupMode === 'none') {
            this.iconRow.visible = false;
            this.labelFrame.visible = false;
            this.labelFrame.fit();
            return;
        }

        const showHeader = this.config.popupMode !== 'simple';
        this.iconRow.visible = showHeader;
        this.upgradeBadge.visible = showHeader && this.isUpgradeAvailable();

        // Recolors the whole panel to flag its current state at a glance — grey while on
        // cooldown, orange the moment the player can afford to finish the next level right now
        // (same condition upgradeBadge already keys off), the entity-type's own default
        // otherwise. Skipped entirely for a frame with no background texture to begin with (e.g.
        // 'Simple' popups) rather than painting one in where there was deliberately none.
        if (this.defaultFrameTexture !== undefined) {
            if (ShopUpgradeStorage.isOnCooldown(this.shopId)) {
                this.labelFrame.setTexture(COOLDOWN_FRAME_TEXTURE);
            } else if (this.isUpgradeAvailable()) {
                this.labelFrame.setTexture(AVAILABLE_FRAME_TEXTURE);
            } else {
                this.labelFrame.setTexture(this.defaultFrameTexture);
            }
        }

        this.bodyContainer.removeChildren().forEach(child => child.destroy({ children: true }));

        let bodyHeight: number;
        if (ShopUpgradeStorage.isMaxLevel(this.shopId, this.config)) {
            const maxLevelText = new PIXI.Text('MAX', TextStyleRegistry.Body);
            maxLevelText.anchor.set(0.5, 1);
            this.bodyContainer.addChild(maxLevelText);
            bodyHeight = maxLevelText.height;
        } else if (ShopUpgradeStorage.isOnCooldown(this.shopId)) {
            // Same icon+text row shape as the cost row below — the cooldown box is naturally
            // wider than "MAX" (it carries a "Xm Ys" countdown), so a timer icon fills that extra
            // width with something meaningful instead of empty space.
            const row = new PIXI.Container();
            const icon = new PIXI.Sprite(PIXI.Texture.from('Icon_Timer'));
            icon.anchor.set(0, 0.5);
            icon.width = COST_ICON_SIZE;
            icon.height = COST_ICON_SIZE;
            row.addChild(icon);

            const cooldownText = new PIXI.Text(formatCooldown(ShopUpgradeStorage.getCooldownRemainingSec(this.shopId)), TextStyleRegistry.Body);
            cooldownText.anchor.set(0, 0.5);
            cooldownText.position.set(COST_ICON_SIZE + COST_ICON_TEXT_GAP, 0);
            row.addChild(cooldownText);

            row.pivot.set(row.width / 2, row.height / 2);
            row.position.set(0, -row.height / 2);
            this.bodyContainer.addChild(row);
            bodyHeight = row.height;
        } else {
            const state = ShopUpgradeStorage.getState(this.shopId);
            const cost = getUpgradeCost(this.config, state.level);

            const row = new PIXI.Container();
            const icon = new PIXI.Sprite(getAssetIcon(CURRENCY_CONFIG[CurrencyType.Money].assetKey));
            icon.anchor.set(0, 0.5);
            icon.width = COST_ICON_SIZE;
            icon.height = COST_ICON_SIZE;
            row.addChild(icon);

            const costText = new PIXI.Text(`${state.progress}/${cost}`, TextStyleRegistry.Body);
            costText.anchor.set(0, 0.5);
            costText.position.set(COST_ICON_SIZE + COST_ICON_TEXT_GAP, 0);
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
                // Subtracting inFlightCoins is what actually prevents over-draining a near-empty
                // wallet: EconomyStorage's balance only drops on LANDING, but a coin departs
                // every FLY_IN_STAGGER_SEC — without this, a 1-coin balance would still read
                // getBalance()>0 for every departure that fires before the first one lands.
                && EconomyStorage.getBalance(CurrencyType.Money) - this.inFlightCoins > 0;

            if (!stillWants) {
                this.draining = false;
                return;
            }

            this.labelAnchor.getWorldPosition(toWorld);
            this.inFlightCoins++;

            spawnFlyingIconFromOverlayPoint(this.screenHost, this.getWalletOverlayPosition, toWorld.clone(), icon, () => {
                this.inFlightCoins--;
                if (!EconomyStorage.spend(CurrencyType.Money, 1)) {
                    return;
                }
                ShopUpgradeStorage.addProgress(this.shopId, this.config, 1);
                if (ShopUpgradeStorage.tryCompleteUpgrade(this.shopId, this.config)) {
                    // Rarity is hardcoded to Common for now — ShopConfig has no rarity-by-level
                    // field yet (see ShopTypes.ts). Wire it up to actually vary per level once
                    // that's added.
                    UpgradeNotificationManager.instance.show({
                        type: NotificationType.Upgrade,
                        rarity: NotificationRarity.Common,
                        icon: getToolIcon(this.config.tool),
                        title: 'UPGRADE!',
                        subtitle: `${this.config.tool.toUpperCase()} LEVEL ${ShopUpgradeStorage.getLevel(this.shopId)}`,
                    });
                }
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
