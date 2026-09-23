// FarmZone.ts
//
// The world entity for one farm PLOT (see FarmTypes.ts's own doc) BEFORE it's
// been bought — spawned by PizzaScene.setupFarms() for every "farm" object
// found on the Tiled map's "mapSettings" layer that FarmPlotStorage doesn't
// already have marked owned. A plot already owned from a previous session
// never gets one of these at all — PizzaScene.spawnFarmGrid() spawns
// straight into the owned FarmPlotTile grid instead (see that file's own
// doc), skipping this "for sale" step entirely.
//
// This is ONE big trigger over the plot's WHOLE footprint (not a grid yet —
// see FarmGrid.ts's own doc for why the grid only exists once owned) plus a
// persistent price/progress popup (ScreenAnchorComponent + the same
// lock/requirement panel Gate.ts shows — see LockRequirementPanel.ts), a red dotted outline
// (not bought — see FarmPlotTile.ts's own green for the owned equivalent),
// and a preview grid of FARM_TILE_CONFIG.empty visuals (built off the SAME
// FarmGrid.computeFarmGrid() cells the owned grid will use, so the for-sale
// preview already shows the real per-tile layout).
//
// Buying is a GRADUAL deposit, same shape as ShopZone's tool-upgrade
// funding — NOT a lump-sum instant spend: while the player stands inside,
// money flies from EconomyUI's wallet icon to this plot one coin at a time
// (spawnFlyingIconFromOverlayPoint()), crediting FarmPlotStorage.
// addProgress() as each one lands. Once the full price is deposited,
// FarmPlotStorage.tryCompletePurchase() marks it owned and this entity
// destroys ITSELF (`this.world?.remove(this)`, same "leaves the world for
// good" convention CraftZone's destroyOnComplete uses) — the whole-area
// trigger genuinely goes away — and calls `onPurchased()`, which PizzaScene
// wires to spawnFarmGrid() to bring up the real per-tile FarmPlotTile grid
// in its place.

import * as THREE from 'three';
import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import Entity from '../ecs/Entity';
import RigidBody from '../physics/RigidBody';
import { Layers } from '../physics/PhysicsConstants';
import DottedZoneVisualComponent from '../components/DottedZoneVisualComponent';
import BoxVisualComponent from '../components/BoxVisualComponent';
import GlbVisualComponent from '../components/GlbVisualComponent';
import ScreenAnchorComponent, { ScreenAnchorHost } from '../components/ScreenAnchorComponent';
import { spawnFlyingIconFromOverlayPoint } from '../components/FlyingResourceIcon';
import { ZONE_LABEL_ANCHOR_OPTIONS } from '../ui/ZoneLabelConfig';
import { buildLockRequirementPanel, LockRequirementPanel } from '../ui/LockRequirementPanel';
import { FarmPlotConfig, FARM_TILE_CONFIG } from '../data/FarmTypes';
import { FarmPlotStorage } from '../data/FarmPlotStorage';
import { EconomyStorage } from '../data/EconomyStorage';
import { CURRENCY_CONFIG } from '../data/EconomyTypes';
import { getAssetIcon } from './AssetLibraryRegistry';
import { resolveEntityView } from './EntityViewRegistry';
import { computeFarmGrid, FARM_GRID_CELL_SIZE } from './FarmGrid';
import MainPlayer from '../player/MainPlayer';
import { UpgradeNotificationManager } from '../ui/notifications/UpgradeNotificationManager';
import { NotificationRarity, NotificationType } from '../ui/notifications/NotificationTypes';
import { getZoneColor, ZoneColorKind } from '../data/ZoneColorTypes';

const FARM_ZONE_CORNER_RADIUS = 0.2;
const PLACEHOLDER_HEIGHT = 0.1;
const PLACEHOLDER_EMPTY_COLOR = 0x77aa55;
/** How far above the plot's own ground-level origin the price popup floats — same fixed-constant convention every zone used before PopupConfig.ts's popupBobOffset existed; FarmPlotConfig has no such override field yet. */
const POPUP_HEIGHT_OFFSET = 1.2;
const FLY_IN_STAGGER_SEC = 0.12;

export default class FarmZone extends Entity {
    private readonly screenHost: ScreenAnchorHost;
    private readonly farmId: string;
    private readonly config: FarmPlotConfig;
    private readonly footprint: { width: number; depth: number };
    /** Where EconomyUI's money icon actually sits on screen right now — a callback (not a fixed point) since UIService repositions that panel every frame. Same param QueueZone/ShopZone take. */
    private readonly getWalletOverlayPosition: () => { x: number; y: number };
    private readonly onPurchased: () => void;

    /** True while a coin-deposit loop is already running — guards a second overlapping one starting from another onTriggerStay tick, same convention as ShopZone.draining. */
    private draining = false;
    /** Coins departed but not yet landed — see ShopZone.inFlightCoins' own doc for why this must never reset mid-flight. */
    private inFlightCoins = 0;
    private isPlayerInside = false;
    private player?: MainPlayer;
    private destroying = false;

    private labelAnchor!: THREE.Object3D;
    private pricePanel!: LockRequirementPanel;

    private readonly handleProgressChanged = (id: string): void => {
        if (id === this.farmId) {
            this.refreshLabel();
        }
    };

    public constructor(
        position: THREE.Vector3,
        screenHost: ScreenAnchorHost,
        farmId: string,
        getWalletOverlayPosition: () => { x: number; y: number },
        footprint: { width: number; depth: number },
        config: FarmPlotConfig,
        onPurchased: () => void,
    ) {
        super();
        this.screenHost = screenHost;
        this.farmId = farmId;
        this.getWalletOverlayPosition = getWalletOverlayPosition;
        this.footprint = footprint;
        this.config = config;
        this.onPurchased = onPurchased;
        this.transform.position.copy(position);
    }

    public override awake(): void {
        const { width, depth } = this.footprint;
        const halfExtents = new THREE.Vector3(width / 2, PLACEHOLDER_HEIGHT, depth / 2);
        const centerOffset = new THREE.Vector3(0, halfExtents.y, 0);

        const rigidBody = this.addComponent(new RigidBody({
            halfExtents,
            isStatic: true,
            isTrigger: true,
            layer: Layers.Trigger,
            centerOffset,
        }));

        this.addComponent(new DottedZoneVisualComponent(
            width,
            depth,
            FARM_ZONE_CORNER_RADIUS,
            { color: getZoneColor(ZoneColorKind.Farm) },
        ));

        this.buildEmptyGridPreview(width, depth);
        this.buildPricePopup();

        FarmPlotStorage.onProgressChanged.add(this.handleProgressChanged);

        rigidBody.onTriggerEnter.add(other => this.tryDeposit(other));
        rigidBody.onTriggerStay.add(other => this.tryDeposit(other));
        rigidBody.onTriggerExit.add(other => this.handleTriggerExit(other));
    }

    public override destroy(): void {
        FarmPlotStorage.onProgressChanged.remove(this.handleProgressChanged);
        super.destroy();
    }

    /** One FARM_TILE_CONFIG.empty visual per FarmGrid cell — purely cosmetic (no per-cell colliders yet, that's FarmPlotTile's job once owned) so the for-sale preview already shows the plot's real tile layout. */
    private buildEmptyGridPreview(width: number, depth: number): void {
        const resolved = resolveEntityView(FARM_TILE_CONFIG.empty);

        for (const cell of computeFarmGrid(width, depth)) {
            if (resolved) {
                const [offsetX, offsetY, offsetZ] = resolved.offset;
                this.addComponent(new GlbVisualComponent(
                    resolved.model,
                    new THREE.Vector3(cell.localX + offsetX, offsetY, cell.localZ + offsetZ),
                    resolved.scale,
                    THREE.MathUtils.degToRad(resolved.rotationDeg),
                ));
                continue;
            }

            this.addComponent(new BoxVisualComponent(
                new THREE.Vector3(FARM_GRID_CELL_SIZE, PLACEHOLDER_HEIGHT, FARM_GRID_CELL_SIZE),
                PLACEHOLDER_EMPTY_COLOR,
                new THREE.Vector3(cell.localX, PLACEHOLDER_HEIGHT / 2, cell.localZ),
            ));
        }
    }

    /** Persistent padlock + currency icon + "<progress>/<price>" panel — the exact same lock/requirement panel a Gate shows (see LockRequirementPanel.ts), with the plot's currency as the requirement icon. refreshLabel() (see below) keeps the count current as coins land. */
    private buildPricePopup(): void {
        this.pricePanel = buildLockRequirementPanel(
            getAssetIcon(CURRENCY_CONFIG[this.config.price.currency].assetKey),
            { cornerText: '' },
        );
        this.refreshLabel();

        this.labelAnchor = new THREE.Object3D();
        this.labelAnchor.position.set(0, POPUP_HEIGHT_OFFSET, 0);
        this.transform.add(this.labelAnchor);
        const labelAnchorWorldPosition = new THREE.Vector3();

        this.addComponent(new ScreenAnchorComponent(
            this.screenHost,
            this.pricePanel.frame,
            () => this.labelAnchor.getWorldPosition(labelAnchorWorldPosition),
            ZONE_LABEL_ANCHOR_OPTIONS,
        ));
    }

    /** Rewrites the panel's "<progress>/<price>" count from FarmPlotStorage's current progress (setCornerText() re-fits the frame) — called once at build time and again every time FarmPlotStorage.onProgressChanged fires for this plot. */
    private refreshLabel(): void {
        const progress = FarmPlotStorage.getProgress(this.farmId);
        this.pricePanel.setCornerText(`${progress}/${this.config.price.amount}`);
    }

    private tryDeposit(other: RigidBody): void {
        const player = other.entity;
        if (!(player instanceof MainPlayer) || this.destroying) {
            return;
        }

        this.isPlayerInside = true;
        this.player = player;
        this.flyInCoins();
    }

    /** Player's RigidBody left this zone's trigger — flyInCoins()'s loop reads isPlayerInside before every coin, so clearing it here is the ENTIRE "stop depositing" instruction, same shape as ShopZone/BuildingZone/QueueZone's identical handler. */
    private handleTriggerExit(other: RigidBody): void {
        if (other.entity !== this.player) {
            return;
        }

        this.isPlayerInside = false;
        this.player = undefined;
    }

    /**
     * Drains EconomyStorage's Money balance one coin at a time toward this plot's price,
     * re-checking isPlayerInside/destroying before every single coin — not a fixed burst
     * computed once at trigger time. Same self-rescheduling step() shape as ShopZone.
     * flyInCoins()/CraftZone.flyInResource().
     */
    private flyInCoins(): void {
        if (this.draining) {
            return;
        }
        this.draining = true;

        const icon = getAssetIcon(CURRENCY_CONFIG[this.config.price.currency].assetKey);
        const toWorld = new THREE.Vector3();

        const step = (): void => {
            const stillWants = this.isPlayerInside
                && !this.destroying
                // Subtracting inFlightCoins is what actually prevents over-draining a
                // near-empty wallet — see ShopZone.flyInCoins()'s own doc for the full
                // reasoning (EconomyStorage's balance only drops on LANDING, but a coin departs
                // every FLY_IN_STAGGER_SEC).
                && FarmPlotStorage.getProgress(this.farmId) + this.inFlightCoins < this.config.price.amount
                && EconomyStorage.getBalance(this.config.price.currency) - this.inFlightCoins > 0;

            if (!stillWants) {
                this.draining = false;
                return;
            }

            this.labelAnchor.getWorldPosition(toWorld);
            this.inFlightCoins++;

            spawnFlyingIconFromOverlayPoint(this.screenHost, this.getWalletOverlayPosition, toWorld.clone(), icon, () => {
                this.inFlightCoins--;
                if (this.destroying || !EconomyStorage.spend(this.config.price.currency, 1)) {
                    return;
                }
                FarmPlotStorage.addProgress(this.farmId, this.config, 1);
                if (FarmPlotStorage.tryCompletePurchase(this.farmId, this.config)) {
                    this.announceFarmUnlocked();
                    this.destroying = true;
                    this.onPurchased();
                    this.world?.remove(this);
                }
            });

            gsap.delayedCall(FLY_IN_STAGGER_SEC, step);
        };

        step();
    }

    /** Same "big center-upper callout" ShopZone's Upgrade/CraftZone's NewTool notifications use — see UpgradeNotificationManager.ts's own doc. FARM_TILE_CONFIG.icon is shared across every plot (see that file's own doc), same as this notification itself: it announces farming as a whole getting unlocked, not any one plot's own identity. */
    private announceFarmUnlocked(): void {
        UpgradeNotificationManager.instance.show({
            type: NotificationType.Unlockable,
            rarity: NotificationRarity.Common,
            icon: FARM_TILE_CONFIG.icon ? PIXI.Texture.from(FARM_TILE_CONFIG.icon) : undefined,
            title: 'FARM UNLOCKED!',
            subtitle: 'NEW PLOT',
        });
    }
}
