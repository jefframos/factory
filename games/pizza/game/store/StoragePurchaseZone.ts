// StoragePurchaseZone.ts
//
// A priced storage (StorageConfig.price) that hasn't been bought yet — the
// same "for sale" flow as FarmZone: a dotted outline plus a padlock/price
// panel; while the player stands inside, coins fly from the wallet one at a
// time (EconomyStorage is only charged as each one lands). The price shows as
// a popup in the storage's `frame` preset, or — for the 'Floor' frame — painted
// on the floor, centered on (and shrunk to fit) this purchase area. Once fully paid,
// StorageOwnershipStorage marks it owned, `onPurchased` spawns the real
// StorageZone (see PizzaScene.setupStorages()) and this zone removes itself.

import * as THREE from 'three';
import gsap from 'gsap';
import Entity from '../ecs/Entity';
import RigidBody from '../physics/RigidBody';
import { Layers } from '../physics/PhysicsConstants';
import DottedZoneVisualComponent from '../components/DottedZoneVisualComponent';
import ScreenAnchorComponent, { ScreenAnchorHost } from '../components/ScreenAnchorComponent';
import { spawnFlyingIconFromOverlayPoint } from '../components/FlyingResourceIcon';
import { ZONE_LABEL_ANCHOR_OPTIONS } from '../ui/ZoneLabelConfig';
import { buildLockRequirementPanel, LockRequirementPanel } from '../ui/LockRequirementPanel';
import { FrameName } from '../ui/FrameRegistry';
import { isFloorFrame } from '../ui/PopupConfig';
import FloorLabelComponent, { DEFAULT_FLOOR_LABEL_SIZE } from '../components/FloorLabelComponent';
import { UpgradeNotificationManager } from '../ui/notifications/UpgradeNotificationManager';
import { NotificationRarity, NotificationType } from '../ui/notifications/NotificationTypes';
import { getAssetIcon } from '../world/AssetLibraryRegistry';
import { EconomyStorage } from '../data/EconomyStorage';
import { CURRENCY_CONFIG } from '../data/EconomyTypes';
import { StoragePrice } from '../data/StorageTypes';
import { getZoneColor, ZoneColorKind } from '../data/ZoneColorTypes';
import MainPlayer from '../player/MainPlayer';
import { StorageOwnershipStorage } from './StorageOwnershipStorage';

const TRIGGER_HALF_HEIGHT = 0.5;
const CORNER_RADIUS = 0.3;
const POPUP_HEIGHT_OFFSET = 1.2;
/** Coins land here instead (just above the floor label) when the price is painted on the floor. */
const FLOOR_COIN_TARGET_HEIGHT = 0.3;
/** The floor price label fills at most this fraction of the purchase area. */
const FLOOR_LABEL_AREA_FILL = 0.9;
const FLY_IN_STAGGER_SEC = 0.12;

export default class StoragePurchaseZone extends Entity {
    private readonly storageId: string;
    private readonly price: StoragePrice;
    private readonly footprint: { width: number; depth: number };
    private readonly screenHost: ScreenAnchorHost;
    private readonly getWalletOverlayPosition: () => { x: number; y: number };
    private readonly onPurchased: () => void;

    private draining = false;
    private inFlightCoins = 0;
    private player?: MainPlayer;
    private destroying = false;
    private readonly labelAnchor = new THREE.Object3D();
    private readonly frame?: FrameName;
    private readonly floorLabelSize?: number;
    /** Exactly one of these is built, depending on `frame` — see awake(). */
    private pricePanel?: LockRequirementPanel;
    private floorLabel?: FloorLabelComponent;

    private readonly handleProgressChanged = (id: string): void => {
        if (id === this.storageId) {
            this.refreshLabel();
        }
    };

    public constructor(
        storageId: string,
        price: StoragePrice,
        position: THREE.Vector3,
        footprint: { width: number; depth: number },
        screenHost: ScreenAnchorHost,
        getWalletOverlayPosition: () => { x: number; y: number },
        onPurchased: () => void,
        /** StorageConfig.frame — see that field's own doc. */
        frame?: FrameName,
        /** StorageConfig.floorLabelSize — max height of the floor price label. */
        floorLabelSize?: number,
    ) {
        super();
        this.storageId = storageId;
        this.price = price;
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

        const icon = getAssetIcon(CURRENCY_CONFIG[this.price.currency].assetKey);
        this.transform.add(this.labelAnchor);
        if (isFloorFrame(this.frame)) {
            this.labelAnchor.position.set(0, FLOOR_COIN_TARGET_HEIGHT, 0);
            this.floorLabel = this.addComponent(new FloorLabelComponent({
                icon,
                text: this.progressText(),
                size: this.floorLabelSize ?? DEFAULT_FLOOR_LABEL_SIZE,
                maxWidth: width * FLOOR_LABEL_AREA_FILL,
                maxDepth: depth * FLOOR_LABEL_AREA_FILL,
            }));
        } else {
            this.labelAnchor.position.set(0, POPUP_HEIGHT_OFFSET, 0);
            this.pricePanel = buildLockRequirementPanel(icon, { cornerText: this.progressText(), frame: this.frame });
            const labelWorld = new THREE.Vector3();
            this.addComponent(new ScreenAnchorComponent(
                this.screenHost,
                this.pricePanel.frame,
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

    private refreshLabel(): void {
        const text = this.progressText();
        this.pricePanel?.setCornerText(text);
        this.floorLabel?.setText(text);
    }

    private progressText(): string {
        return `${StorageOwnershipStorage.getProgress(this.storageId)}/${this.price.amount}`;
    }

    private tryDeposit(other: RigidBody): void {
        if (!(other.entity instanceof MainPlayer) || this.destroying) {
            return;
        }
        this.player = other.entity;
        this.flyInCoins();
    }

    /** Same self-rescheduling coin drain as FarmZone.flyInCoins() — see that method's own doc. */
    private flyInCoins(): void {
        if (this.draining) {
            return;
        }
        this.draining = true;

        const icon = getAssetIcon(CURRENCY_CONFIG[this.price.currency].assetKey);
        const toWorld = new THREE.Vector3();

        const step = (): void => {
            const stillWants = this.player !== undefined
                && !this.destroying
                && StorageOwnershipStorage.getProgress(this.storageId) + this.inFlightCoins < this.price.amount
                && EconomyStorage.getBalance(this.price.currency) - this.inFlightCoins > 0;
            if (!stillWants) {
                this.draining = false;
                return;
            }

            this.labelAnchor.getWorldPosition(toWorld);
            this.inFlightCoins++;
            spawnFlyingIconFromOverlayPoint(this.screenHost, this.getWalletOverlayPosition, toWorld.clone(), icon, () => {
                this.inFlightCoins--;
                if (this.destroying || !EconomyStorage.spend(this.price.currency, 1)) {
                    return;
                }
                if (StorageOwnershipStorage.addProgress(this.storageId, this.price.amount, 1)) {
                    this.destroying = true;
                    this.announce();
                    this.onPurchased();
                    this.world?.remove(this);
                }
            });

            gsap.delayedCall(FLY_IN_STAGGER_SEC, step);
        };

        step();
    }

    private announce(): void {
        UpgradeNotificationManager.instance.show({
            type: NotificationType.Unlockable,
            rarity: NotificationRarity.Common,
            icon: getAssetIcon(CURRENCY_CONFIG[this.price.currency].assetKey),
            title: 'STORAGE UNLOCKED!',
            subtitle: 'NEW STORAGE',
        });
    }
}
