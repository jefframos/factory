// StoragePurchaseZone.ts
//
// A for-sale storage (StorageConfig.price and/or resourceCost — see
// isStorageForSale()) that hasn't been bought yet — the same "for sale" flow
// as FarmZone: a dotted outline plus a padlock/price panel; while the player
// stands inside, every part of the cost drains at once, one unit at a time:
//   - coins fly from the wallet (EconomyStorage is only charged as each lands);
//   - each resource (e.g. 20 wood) flies from the player's backpack
//     (BackpackStorage is only charged as each lands) — same as BuildingZone.
// The cost shows as one icon + "paid/total" per part — a popup row in the
// storage's `frame` preset, or, for the 'Floor' frame, painted on the floor,
// centered on (and shrunk to fit) this purchase area. Progress is saved per
// part (StorageOwnershipStorage.ts); once EVERY part is paid it marks the
// storage owned, `onPurchased` spawns the real StorageZone (see
// PizzaScene.setupStorages()) and this zone removes itself.

import * as THREE from 'three';
import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import Entity from '../ecs/Entity';
import RigidBody from '../physics/RigidBody';
import { Layers } from '../physics/PhysicsConstants';
import DottedZoneVisualComponent from '../components/DottedZoneVisualComponent';
import CharacterVisualComponent from '../components/CharacterVisualComponent';
import ScreenAnchorComponent, { ScreenAnchorHost } from '../components/ScreenAnchorComponent';
import { spawnFlyingIconFromOverlayPoint, spawnFlyingResourceIcon } from '../components/FlyingResourceIcon';
import { ZONE_LABEL_ANCHOR_OPTIONS } from '../ui/ZoneLabelConfig';
import { buildLockRequirementPanel, LockRequirementPanel } from '../ui/LockRequirementPanel';
import { isFloorFrame, type PopupFrameChoice } from '../ui/PopupConfig';
import FloorLabelComponent, { DEFAULT_FLOOR_LABEL_SIZE, FloorLabelItem } from '../components/FloorLabelComponent';
import { UpgradeNotificationManager } from '../ui/notifications/UpgradeNotificationManager';
import { NotificationRarity, NotificationType } from '../ui/notifications/NotificationTypes';
import { getAssetIcon } from '../world/AssetLibraryRegistry';
import { resolveResourceAssetKey } from '../actions/ResourceRegistry';
import { ResourceType } from '../actions/ResourceTypes';
import { BackpackStorage } from '../data/BackpackStorage';
import { EconomyStorage } from '../data/EconomyStorage';
import { CURRENCY_CONFIG, CurrencyType } from '../data/EconomyTypes';
import { StoragePrice, StorageResourceCost } from '../data/StorageTypes';
import { getZoneColor, ZoneColorKind } from '../data/ZoneColorTypes';
import MainPlayer from '../player/MainPlayer';
import { StorageOwnershipStorage } from './StorageOwnershipStorage';
import DepositPacer from '../utils/DepositPacer';

const TRIGGER_HALF_HEIGHT = 0.5;
const CORNER_RADIUS = 0.3;
const POPUP_HEIGHT_OFFSET = 1.2;
/** Coins/resources land here instead (just above the floor label) when the cost is painted on the floor. */
const FLOOR_COIN_TARGET_HEIGHT = 0.3;
/** The floor cost label fills at most this fraction of the purchase area. */
const FLOOR_LABEL_AREA_FILL = 0.9;
const FLY_IN_STAGGER_SEC = 0.12;
/** Horizontal gap between two cost panels in the popup row, UI pixels. */
const POPUP_PANEL_GAP = 8;
/** Where a resource launches from if the character (and so its backpack) hasn't loaded — roughly chest height. */
const FALLBACK_CARRIER_HEIGHT = 1.2;

/** One part of the cost — see this file's own doc. */
type CostPart =
    | { kind: 'coin'; currency: CurrencyType; amount: number }
    | { kind: 'resource'; type: ResourceType; amount: number };

export default class StoragePurchaseZone extends Entity {
    private readonly storageId: string;
    private readonly price?: StoragePrice;
    private readonly resourceCost: readonly StorageResourceCost[];
    private readonly parts: CostPart[];
    private readonly footprint: { width: number; depth: number };
    private readonly screenHost: ScreenAnchorHost;
    private readonly getWalletOverlayPosition: () => { x: number; y: number };
    private readonly onPurchased: () => void;

    /** Per part (same index as `parts`): whether its drain loop is running, units in the air, and its own speed-up pacer (see DepositPacer.ts). */
    private readonly draining: boolean[];
    private readonly inFlight: number[];
    private readonly pacers: DepositPacer[];
    private player?: MainPlayer;
    private destroying = false;
    private readonly labelAnchor = new THREE.Object3D();
    private readonly frame?: PopupFrameChoice;
    private readonly floorLabelSize?: number;
    /** Exactly one of these is built, depending on `frame` — see awake(). */
    private popupRow?: PIXI.Container;
    private pricePanels: LockRequirementPanel[] = [];
    private floorLabel?: FloorLabelComponent;

    private readonly handleProgressChanged = (id: string): void => {
        if (id === this.storageId) {
            this.refreshLabel();
        }
    };

    public constructor(
        storageId: string,
        price: StoragePrice | undefined,
        resourceCost: readonly StorageResourceCost[],
        position: THREE.Vector3,
        footprint: { width: number; depth: number },
        screenHost: ScreenAnchorHost,
        getWalletOverlayPosition: () => { x: number; y: number },
        onPurchased: () => void,
        /** StorageConfig.frame — see that field's own doc. */
        frame?: PopupFrameChoice,
        /** StorageConfig.floorLabelSize — max height of the floor cost label. */
        floorLabelSize?: number,
    ) {
        super();
        this.storageId = storageId;
        this.price = price && price.amount > 0 ? price : undefined;
        this.resourceCost = resourceCost;
        this.parts = [
            ...(this.price ? [{ kind: 'coin' as const, currency: this.price.currency, amount: this.price.amount }] : []),
            ...resourceCost.map(cost => ({ kind: 'resource' as const, type: cost.resourceType, amount: cost.amount })),
        ];
        this.draining = this.parts.map(() => false);
        this.inFlight = this.parts.map(() => 0);
        this.pacers = this.parts.map(() => new DepositPacer(FLY_IN_STAGGER_SEC));
        this.footprint = footprint;
        this.screenHost = screenHost;
        this.getWalletOverlayPosition = getWalletOverlayPosition;
        this.onPurchased = onPurchased;
        this.frame = frame;
        this.floorLabelSize = floorLabelSize;
        this.transform.position.copy(position);
    }

    public override awake(): void {
        const { width, depth } = this.footprint;
        const rigidBody = this.addComponent(new RigidBody({
            halfExtents: new THREE.Vector3(width / 2, TRIGGER_HALF_HEIGHT, depth / 2),
            isStatic: true,
            isTrigger: true,
            layer: Layers.Trigger,
            centerOffset: new THREE.Vector3(0, TRIGGER_HALF_HEIGHT, 0),
        }));
        this.addComponent(new DottedZoneVisualComponent(width, depth, CORNER_RADIUS, { color: getZoneColor(ZoneColorKind.Farm) }));

        this.transform.add(this.labelAnchor);
        if (isFloorFrame(this.frame)) {
            this.labelAnchor.position.set(0, FLOOR_COIN_TARGET_HEIGHT, 0);
            this.floorLabel = this.addComponent(new FloorLabelComponent({
                items: this.labelItems(),
                size: this.floorLabelSize ?? DEFAULT_FLOOR_LABEL_SIZE,
                maxWidth: width * FLOOR_LABEL_AREA_FILL,
                maxDepth: depth * FLOOR_LABEL_AREA_FILL,
            }));
        } else {
            this.labelAnchor.position.set(0, POPUP_HEIGHT_OFFSET, 0);
            // One padlock panel per cost part, side by side in one row, centered on the anchor.
            const row = new PIXI.Container();
            this.pricePanels = this.parts.map(part => {
                const panel = buildLockRequirementPanel(this.partIcon(part), { cornerText: this.partText(part), frame: this.frame });
                row.addChild(panel.frame);
                return panel;
            });
            this.popupRow = row;
            this.layoutPopupRow();
            const labelWorld = new THREE.Vector3();
            this.addComponent(new ScreenAnchorComponent(
                this.screenHost,
                row,
                () => this.labelAnchor.getWorldPosition(labelWorld),
                ZONE_LABEL_ANCHOR_OPTIONS,
            ));
        }

        StorageOwnershipStorage.onProgressChanged.add(this.handleProgressChanged);
        rigidBody.onTriggerEnter.add(other => this.tryDeposit(other));
        rigidBody.onTriggerStay.add(other => this.tryDeposit(other));
        rigidBody.onTriggerExit.add(other => {
            if (other.entity === this.player) {
                this.player = undefined;
            }
        });
    }

    public override destroy(): void {
        StorageOwnershipStorage.onProgressChanged.remove(this.handleProgressChanged);
        super.destroy();
    }

    // ---- Label

    private partIcon(part: CostPart): PIXI.Texture {
        return part.kind === 'coin'
            ? getAssetIcon(CURRENCY_CONFIG[part.currency].assetKey)
            : getAssetIcon(resolveResourceAssetKey(part.type));
    }

    private partPaid(part: CostPart): number {
        return part.kind === 'coin'
            ? StorageOwnershipStorage.getProgress(this.storageId)
            : StorageOwnershipStorage.getResourceProgress(this.storageId, part.type);
    }

    private partText(part: CostPart): string {
        return `${Math.min(this.partPaid(part), part.amount)}/${part.amount}`;
    }

    private labelItems(): FloorLabelItem[] {
        return this.parts.map(part => ({ icon: this.partIcon(part), text: this.partText(part) }));
    }

    private refreshLabel(): void {
        this.floorLabel?.setItems(this.labelItems());
        this.pricePanels.forEach((panel, index) => panel.setCornerText(this.partText(this.parts[index])));
        this.layoutPopupRow();
    }

    /** Lays the popup panels out left to right (each panel's own bounds + POPUP_PANEL_GAP) and centers the row on its origin. */
    private layoutPopupRow(): void {
        const row = this.popupRow;
        if (!row) {
            return;
        }
        let x = 0;
        for (const panel of this.pricePanels) {
            const bounds = panel.frame.getLocalBounds();
            panel.frame.position.x = x - bounds.x;
            x += bounds.width + POPUP_PANEL_GAP;
        }
        row.pivot.x = Math.max(0, x - POPUP_PANEL_GAP) / 2;
    }

    // ---- Paying

    private tryDeposit(other: RigidBody): void {
        if (!(other.entity instanceof MainPlayer) || this.destroying) {
            return;
        }
        this.player = other.entity;
        this.parts.forEach((_, index) => this.startDrain(index));
    }

    /** One part's self-rescheduling drain — same shape as FarmZone.flyInCoins(), one loop per part so coins and wood fly in together. */
    private startDrain(index: number): void {
        if (this.draining[index]) {
            return;
        }
        this.draining[index] = true;
        const part = this.parts[index];
        const icon = this.partIcon(part);
        const toWorld = new THREE.Vector3();

        const step = (): void => {
            const inFlight = this.inFlight[index];
            const have = part.kind === 'coin' ? EconomyStorage.getBalance(part.currency) : BackpackStorage.getCount(part.type);
            const stillWants = this.player !== undefined
                && !this.destroying
                && this.partPaid(part) + inFlight < part.amount
                && have - inFlight > 0;
            if (!stillWants) {
                this.draining[index] = false;
                return;
            }

            this.labelAnchor.getWorldPosition(toWorld);
            this.inFlight[index]++;
            const onArrive = (): void => {
                this.inFlight[index]--;
                if (this.destroying) {
                    return;
                }
                if (part.kind === 'coin') {
                    if (!EconomyStorage.spend(part.currency, 1)) {
                        return;
                    }
                    StorageOwnershipStorage.addProgress(this.storageId, 1);
                } else {
                    if (!BackpackStorage.removeOne(part.type)) {
                        return;
                    }
                    StorageOwnershipStorage.addResourceProgress(this.storageId, part.type, 1);
                }
                this.tryComplete();
            };

            if (part.kind === 'coin') {
                spawnFlyingIconFromOverlayPoint(this.screenHost, this.getWalletOverlayPosition, toWorld.clone(), icon, onArrive);
            } else {
                const player = this.player!;
                const from = player.getComponent(CharacterVisualComponent)?.character.getCarrierWorldPosition()
                    ?? player.transform.position.clone().setY(player.transform.position.y + FALLBACK_CARRIER_HEIGHT);
                spawnFlyingResourceIcon(this.screenHost, from.clone(), toWorld.clone(), icon, onArrive);
            }

            gsap.delayedCall(this.pacers[index].nextDelaySec(), step);
        };

        step();
    }

    private tryComplete(): void {
        if (!StorageOwnershipStorage.tryCompletePurchase(this.storageId, this.price?.amount ?? 0, this.resourceCost)) {
            return;
        }
        this.destroying = true;
        this.announce();
        this.onPurchased();
        this.world?.remove(this);
    }

    private announce(): void {
        UpgradeNotificationManager.instance.show({
            type: NotificationType.Unlockable,
            rarity: NotificationRarity.Common,
            icon: this.parts[0] ? this.partIcon(this.parts[0]) : undefined,
            title: 'STORAGE UNLOCKED!',
            subtitle: 'NEW STORAGE',
        });
    }
}
