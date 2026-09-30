// StoreMoneyPile.ts
//
// The store's money drop — paid money piles up here as bills on the floor
// (one bill per StoreConfig.moneyPerBill). The first payment starts a pile;
// it grows up to StoreConfig.billsPerPile bills, then the next pile starts
// beside it, filling the drop area row by row (north to south) — so how much
// money is lying there reads at a glance. Stops drawing more once every spot
// is full (the amount itself keeps counting). Stays until the player
// walks onto it, at which point it all flies to EconomyUI's wallet and is
// credited on arrival (same "storage mutates on landing" convention as
// QueueZone.flyRewardToWallet()). A store's cashier worker collects the same
// way — see collectToWallet() / StoreWorker.ts. The amount itself lives in
// StoreMoneyStorage so uncollected money survives a reload.
//
// With a counter — the map's own model targeting this money drop
// (StoreLayout's moneyDropMesh, see MapMeshVisual.ts), else
// StoreConfig.moneyDropView (StorePropVisual.ts) — the bills pile on the counter's TOP instead of the
// floor: once its model has loaded and been measured, the pile spots are
// re-laid across the top's own footprint and every bill moves up onto it.

import * as THREE from 'three';
import gsap from 'gsap';
import Entity from '../ecs/Entity';
import RigidBody from '../physics/RigidBody';
import { Layers } from '../physics/PhysicsConstants';
import DottedZoneVisualComponent from '../components/DottedZoneVisualComponent';
import { ScreenAnchorHost } from '../components/ScreenAnchorComponent';
import { spawnFlyingIconToOverlayPoint, spawnFlyingResourceIcon } from '../components/FlyingResourceIcon';
import { getAssetIcon } from '../world/AssetLibraryRegistry';
import { BendService } from '../services/BendService';
import { EconomyStorage } from '../data/EconomyStorage';
import { CURRENCY_CONFIG, CurrencyType } from '../data/EconomyTypes';
import { getZoneColor, ZoneColorKind } from '../data/ZoneColorTypes';
import MainPlayer from '../player/MainPlayer';
import { StoreRect } from './StoreLayout';
import { StoreMoneyStorage } from './StoreMoneyStorage';
import { addStorePropVisual } from './StorePropVisual';
import { addMapMeshVisual } from '../world/MapMeshVisual';
import { MeshPlacement } from '../world/MeshLayerSpawner';

const TRIGGER_HALF_HEIGHT = 0.75;
const CORNER_RADIUS = 0.3;
const BILL_SIZE = new THREE.Vector3(0.55, 0.08, 0.3);
const BILL_COLOR = 0x5fb85a;
const BILL_LAYER_HEIGHT = BILL_SIZE.y + 0.01;
/** Distance between two pile centers. */
const PILE_SPACING_X = BILL_SIZE.x + 0.25;
const PILE_SPACING_Z = BILL_SIZE.z + 0.3;
/** Keeps piles off the drop area's own dotted outline. */
const PILE_AREA_INSET = 0.3;
/** Same, on a counter's top — just enough that no bill hangs over its edge. */
const COUNTER_TOP_INSET = 0.05;
/** Fixed per-pile jitter so rows don't look machine-placed (deterministic per pile — piles never shift on refresh). */
const PILE_JITTER_OFFSET = 0.06;
const PILE_JITTER_ROTATION = 0.25;
/** Per-bill twist within a pile. */
const BILL_TWIST = 0.12;
/** New bills drop in from this high above their resting spot. */
const BILL_DROP_HEIGHT = 0.6;
const BILL_DROP_SEC = 0.35;
const BILL_DROP_STAGGER_SEC = 0.03;
/** Most money icons one collect sends to the wallet — the amount is split between them. */
const MAX_COLLECT_ICONS = 6;
const COLLECT_STAGGER_SEC = 0.08;
const ICON_HEIGHT = 0.5;

export default class StoreMoneyPile extends Entity {
    private readonly storeId: string;
    private readonly rect: StoreRect;
    private readonly screenHost: ScreenAnchorHost;
    private readonly moneyPerBill: number;
    private readonly billsPerPile: number;
    /** StoreConfig.moneyDropView — the counter the bills pile on (undefined = on the floor). */
    private readonly viewId?: string;
    /** The map's own counter model for this money drop, if any — wins over viewId. */
    private readonly mesh?: MeshPlacement;
    /** Local X/Z of every pile spot, in fill order — from the drop area's size, or the counter top's once measured (see awake()). */
    private readonly pileSpots: { x: number; z: number; rotation: number }[] = [];
    /** Local height the bills rest on — 0 (the floor) until a counter is measured, then its top. */
    private surfaceY = 0;
    private counterShown = false;
    /** False until the first refresh — bills restored from a save appear in place, only NEW ones drop in. */
    private initialized = false;
    private readonly getWalletOverlayPosition: () => { x: number; y: number };

    private readonly billsRoot = new THREE.Group();
    private readonly billGeometry = new THREE.BoxGeometry(BILL_SIZE.x, BILL_SIZE.y, BILL_SIZE.z);
    private readonly billMaterial = new THREE.MeshStandardMaterial({ color: BILL_COLOR });
    private readonly bills: THREE.Mesh[] = [];

    private readonly handleMoneyChanged = (storeId: string): void => {
        if (storeId === this.storeId) {
            this.refreshBills();
        }
    };

    public constructor(
        storeId: string,
        rect: StoreRect,
        screenHost: ScreenAnchorHost,
        moneyPerBill: number,
        billsPerPile: number,
        getWalletOverlayPosition: () => { x: number; y: number },
        viewId?: string,
        mesh?: MeshPlacement,
    ) {
        super();
        this.viewId = viewId;
        this.mesh = mesh;
        this.storeId = storeId;
        this.rect = rect;
        this.screenHost = screenHost;
        this.moneyPerBill = Math.max(1, moneyPerBill);
        this.billsPerPile = Math.max(1, Math.floor(billsPerPile));
        this.getWalletOverlayPosition = getWalletOverlayPosition;
        this.transform.position.set(rect.x, 0, rect.z);
    }

    public override awake(): void {
        BendService.applyBend(this.billMaterial);
        this.transform.add(this.billsRoot);
        this.buildPileSpots(this.rect.width - PILE_AREA_INSET * 2, this.rect.depth - PILE_AREA_INSET * 2, 0, 0);

        const halfExtents = new THREE.Vector3(this.rect.width / 2, TRIGGER_HALF_HEIGHT, this.rect.depth / 2);
        const rigidBody = this.addComponent(new RigidBody({
            halfExtents,
            isStatic: true,
            isTrigger: true,
            layer: Layers.Trigger,
            centerOffset: new THREE.Vector3(0, TRIGGER_HALF_HEIGHT, 0),
        }));
        this.addComponent(new DottedZoneVisualComponent(this.rect.width, this.rect.depth, CORNER_RADIUS, { color: getZoneColor(ZoneColorKind.DropZone) }));

        rigidBody.onTriggerEnter.add(other => this.tryCollect(other));
        rigidBody.onTriggerStay.add(other => this.tryCollect(other));

        StoreMoneyStorage.onChange.add(this.handleMoneyChanged);
        this.refreshBills();
    }

    /** Draws the counter the bills pile on (and its collider) — Store calls this once the store opens, same reason as StoreCashier.showCounter(). */
    public showCounter(): void {
        if (!this.counterShown) {
            this.counterShown = true;
            const onFitted = (bounds: THREE.Box3): void => this.moveOntoCounter(bounds);
            if (!this.mesh || !addMapMeshVisual(this, this.mesh, { onFitted })) {
                addStorePropVisual(this, this.viewId, onFitted);
            }
        }
    }

    /** A client just paid — money icons fly from `fromWorld` onto the pile and the amount is added once they land. */
    public receivePayment(amount: number, fromWorld: THREE.Vector3): void {
        const from = fromWorld.clone();
        const to = this.getTopWorldPosition();
        const icon = getAssetIcon(CURRENCY_CONFIG[CurrencyType.Money].assetKey);
        this.flyInShares(amount, share => {
            // Credited even if this pile was torn down mid-flight — the money lives in StoreMoneyStorage, not here.
            spawnFlyingResourceIcon(this.screenHost, from, to, icon, () => StoreMoneyStorage.add(this.storeId, share));
        });
    }

    public override destroy(): void {
        StoreMoneyStorage.onChange.remove(this.handleMoneyChanged);
        this.bills.forEach(bill => gsap.killTweensOf(bill.position));
        this.billGeometry.dispose();
        this.billMaterial.dispose();
        super.destroy();
    }

    private tryCollect(other: RigidBody): void {
        if (other.entity instanceof MainPlayer) {
            this.collectToWallet();
        }
    }

    /** Sends the whole pile to the wallet (credited as each icon lands) — the player walking onto it, or the store's cashier worker (StoreWorker.ts). No-op while it's empty. */
    public collectToWallet(): void {
        const amount = StoreMoneyStorage.takeAll(this.storeId);
        if (amount <= 0) {
            return;
        }
        const from = this.getTopWorldPosition();
        const icon = getAssetIcon(CURRENCY_CONFIG[CurrencyType.Money].assetKey);
        this.flyInShares(amount, share => {
            spawnFlyingIconToOverlayPoint(this.screenHost, from.clone(), this.getWalletOverlayPosition, icon, () => {
                EconomyStorage.add(CurrencyType.Money, share);
            });
        });
    }

    /** Splits `amount` into up to MAX_COLLECT_ICONS whole shares and calls `send` for each, staggered. */
    private flyInShares(amount: number, send: (share: number) => void): void {
        const count = Math.max(1, Math.min(MAX_COLLECT_ICONS, amount));
        const base = Math.floor(amount / count);
        let extra = amount - base * count;
        for (let i = 0; i < count; i++) {
            const share = base + (extra > 0 ? 1 : 0);
            extra--;
            gsap.delayedCall(i * COLLECT_STAGGER_SEC, () => send(share));
        }
    }

    /** Where the next bill will land — flying money icons aim here. */
    private getTopWorldPosition(): THREE.Vector3 {
        const index = Math.min(this.bills.length, this.getMaxBills() - 1);
        return this.transform.localToWorld(this.getBillLocalPosition(Math.max(0, index))).setY(this.surfaceY + ICON_HEIGHT + (index % this.billsPerPile) * BILL_LAYER_HEIGHT);
    }

    private getMaxBills(): number {
        return this.pileSpots.length * this.billsPerPile;
    }

    /** The counter finished loading: re-lay the pile spots across its top and move every bill up onto it (no drop animation). */
    private moveOntoCounter(bounds: THREE.Box3): void {
        const size = bounds.getSize(new THREE.Vector3());
        const center = bounds.getCenter(new THREE.Vector3());
        this.surfaceY = bounds.max.y;
        this.pileSpots.length = 0;
        this.buildPileSpots(size.x - COUNTER_TOP_INSET * 2, size.z - COUNTER_TOP_INSET * 2, center.x, center.z);
        this.bills.forEach(bill => {
            gsap.killTweensOf(bill.position);
            bill.removeFromParent();
        });
        this.bills.length = 0;
        this.initialized = false;
        this.refreshBills();
    }

    /** Pile centers across a width x depth area centered on (centerX, centerZ), row-major from its north edge. Always at least one spot. */
    private buildPileSpots(areaWidth: number, areaDepth: number, centerX: number, centerZ: number): void {
        const usableWidth = Math.max(0, areaWidth - BILL_SIZE.x);
        const usableDepth = Math.max(0, areaDepth - BILL_SIZE.z);
        const columns = Math.floor(usableWidth / PILE_SPACING_X) + 1;
        const rows = Math.floor(usableDepth / PILE_SPACING_Z) + 1;
        const startX = centerX - ((columns - 1) * PILE_SPACING_X) / 2;
        const startZ = centerZ - ((rows - 1) * PILE_SPACING_Z) / 2;
        for (let row = 0; row < rows; row++) {
            for (let column = 0; column < columns; column++) {
                const index = this.pileSpots.length;
                this.pileSpots.push({
                    x: startX + column * PILE_SPACING_X + (hash(index, 1) - 0.5) * 2 * PILE_JITTER_OFFSET,
                    z: startZ + row * PILE_SPACING_Z + (hash(index, 2) - 0.5) * 2 * PILE_JITTER_OFFSET,
                    rotation: (hash(index, 3) - 0.5) * 2 * PILE_JITTER_ROTATION,
                });
            }
        }
    }

    private getBillLocalPosition(index: number, target: THREE.Vector3 = new THREE.Vector3()): THREE.Vector3 {
        const spot = this.pileSpots[Math.floor(index / this.billsPerPile)] ?? this.pileSpots[this.pileSpots.length - 1];
        const layer = index % this.billsPerPile;
        return target.set(spot.x, this.surfaceY + BILL_SIZE.y / 2 + layer * BILL_LAYER_HEIGHT, spot.z);
    }

    private refreshBills(): void {
        const amount = StoreMoneyStorage.get(this.storeId);
        const wanted = amount <= 0 ? 0 : Math.min(this.getMaxBills(), Math.ceil(amount / this.moneyPerBill));

        let dropped = 0;
        while (this.bills.length < wanted) {
            const index = this.bills.length;
            const mesh = new THREE.Mesh(this.billGeometry, this.billMaterial);
            this.getBillLocalPosition(index, mesh.position);
            const spot = this.pileSpots[Math.floor(index / this.billsPerPile)];
            mesh.rotation.y = (spot?.rotation ?? 0) + (Math.random() - 0.5) * 2 * BILL_TWIST;
            this.billsRoot.add(mesh);
            this.bills.push(mesh);

            if (this.initialized) {
                const restY = mesh.position.y;
                mesh.position.y = restY + BILL_DROP_HEIGHT;
                gsap.to(mesh.position, { y: restY, duration: BILL_DROP_SEC, delay: dropped * BILL_DROP_STAGGER_SEC, ease: 'bounce.out' });
                dropped++;
            }
        }
        while (this.bills.length > wanted) {
            const bill = this.bills.pop()!;
            gsap.killTweensOf(bill.position);
            bill.removeFromParent();
        }
        this.initialized = true;
    }
}

/** Deterministic 0..1 pseudo-random per (index, salt) — same pile always gets the same jitter. */
function hash(index: number, salt: number): number {
    const x = Math.sin(index * 127.1 + salt * 311.7) * 43758.5453;
    return x - Math.floor(x);
}
