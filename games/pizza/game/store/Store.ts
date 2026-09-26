// Store.ts
//
// One grocery store (see StoreTypes.ts / StoreLayout.ts) — owns everything
// that happens inside it:
//   - which storages it sells from: every enabled "storage" on mapSettings
//     whose position is inside the store's area. A storage with a
//     `resourceType` always offers that item (even while empty — clients
//     then wait for a refill); a storage without one offers whatever it
//     currently holds.
//   - spawning clients (StoreClient) at the entrance every
//     spawnIntervalSec, up to maxClients, each asking for a few of the
//     currently offered items.
//   - one waiting line per storage plus one for the cashier (StoreLine).
//   - the cashier (StoreCashier) and money drop (StoreMoneyPile): while the
//     player stands at the cashier, the client at the front of its line pays
//     and the money flies onto the pile.
//
// Progression: level 0 while closed, 1 on opening, then each payment counts
// (money and sales) toward the next StoreLevelConfig — see
// StoreProgressStorage.ts. Anything a level `enables` (and the store's free
// defaultStorageId, at level 1) stays hidden until then — see StoreUnlocks.ts.
// Only AVAILABLE storages (enabled + bought/free) are used, and no client
// spawns until at least one exists.
//
// A store with a "starter" (see StoreLayout.ts) stays closed — no clients,
// cashier/money-drop outlines hidden — until that building reaches level 1
// (BuildingStorage), checked every frame so it opens the moment it's built.
//
// Everything spawned here is parented under `root`, which spawnStores()
// registers with fog of war over the store's own area — so the whole store
// appears/hides together, the same way every other zone does.
//
// Stores never touch any existing entity: they only read StorageInventory
// (and remove what clients pick up), so StorageZone's own pile follows along
// through StorageInventory.onChange like it does for any other change.

import * as THREE from 'three';
import Entity from '../ecs/Entity';
import World from '../ecs/World';
import ScreenAnchorComponent, { ScreenAnchorHost } from '../components/ScreenAnchorComponent';
import { ZONE_LABEL_ANCHOR_OPTIONS } from '../ui/ZoneLabelConfig';
import { UpgradeNotificationManager } from '../ui/notifications/UpgradeNotificationManager';
import { NotificationRarity, NotificationType } from '../ui/notifications/NotificationTypes';
import { RESOURCE_CONFIG, ResourceType } from '../actions/ResourceTypes';
import { StorageInventory } from '../data/StorageInventory';
import { StorageConfig, getStorageConfig } from '../data/StorageTypes';
import { BuildingStorage } from '../data/BuildingStorage';
import { BuildingId } from '../data/BuildingId';
import { pickRandom } from '../world/AssetLibraryRegistry';
import WorldObjectRegistry from '../world/WorldObjectRegistry';
import StoreClient, { StoreClientHost, StoreClientWant, StoreStorageRef } from './StoreClient';
import StoreCashier from './StoreCashier';
import StoreMoneyPile from './StoreMoneyPile';
import StoreLine from './StoreLine';
import { StoreLayout, StoreRect, randomPointInRect, readStoreLayouts, rectContains } from './StoreLayout';
import { StoreMoneyStorage } from './StoreMoneyStorage';
import { StoreConfig, getNextStoreLevel, getStoreConfig, getStorageSpotDirection } from './StoreTypes';
import { StoreProgressStorage } from './StoreProgressStorage';
import { StoreUnlocks } from './StoreUnlocks';
import StoreLevelPanel from './StoreLevelPanel';

/** Height of the level panel above the cashier's own ground position. */
const LEVEL_PANEL_HEIGHT = 3;

/** The first client shows up this long after the store spawns, rather than a full spawnIntervalSec. */
const FIRST_SPAWN_DELAY_SEC = 1;

export interface StoreStorageSource {
    id: string;
    rect: StoreRect;
    config: StorageConfig;
}

interface StoreStorage extends StoreStorageRef {
    readonly config: StorageConfig;
}

export default class Store extends Entity implements StoreClientHost {
    public readonly config: StoreConfig;
    public readonly screenHost: ScreenAnchorHost;
    public readonly cashierLine: StoreLine<StoreClient>;

    private readonly layout: StoreLayout;
    private readonly storages: StoreStorage[];
    private readonly root: THREE.Object3D;
    private readonly getWalletOverlayPosition: () => { x: number; y: number };
    private readonly clients: StoreClient[] = [];
    private cashier?: StoreCashier;
    private moneyPile?: StoreMoneyPile;
    private spawnTimerSec: number;
    private payTimerSec = 0;
    private readonly levelPanel = new StoreLevelPanel();
    private levelPanelAnchor?: ScreenAnchorComponent;

    public constructor(
        layout: StoreLayout,
        config: StoreConfig,
        storages: StoreStorageSource[],
        screenHost: ScreenAnchorHost,
        root: THREE.Object3D,
        getWalletOverlayPosition: () => { x: number; y: number },
    ) {
        super();
        this.layout = layout;
        this.config = config;
        this.screenHost = screenHost;
        this.root = root;
        this.getWalletOverlayPosition = getWalletOverlayPosition;
        this.spawnTimerSec = Math.max(0, config.spawnIntervalSec - FIRST_SPAWN_DELAY_SEC);

        if (layout.starter !== undefined && !(Object.values(BuildingId) as string[]).includes(layout.starter)) {
            console.warn(`[Store] "${layout.id}" starter "${layout.starter}" is not a BuildingId — the store will stay closed`);
        }

        const center = new THREE.Vector3(layout.area.x, 0, layout.area.z);
        this.storages = storages.map(source => ({
            id: source.id,
            config: source.config,
            position: new THREE.Vector3(source.rect.x, 0, source.rect.z),
            line: new StoreLine<StoreClient>(source.rect, center, config.spotSpacing, config.spotMargin, getStorageSpotDirection(config, source.id)),
        }));
        this.cashierLine = new StoreLine<StoreClient>(layout.cashier, center, config.spotSpacing, config.spotMargin, config.cashierSpotDirection);
    }

    public override awake(): void {
        const world = this.world!;
        this.cashier = world.add(new StoreCashier(this.layout.cashier));
        this.root.add(this.cashier.transform);
        this.moneyPile = world.add(new StoreMoneyPile(this.layout.id, this.layout.moneyDrop, this.screenHost, this.config.moneyPerBill, this.config.billsPerPile, this.getWalletOverlayPosition));
        this.root.add(this.moneyPile.transform);
        void StoreMoneyStorage.load();

        const panelPosition = new THREE.Vector3(this.layout.cashier.x, LEVEL_PANEL_HEIGHT, this.layout.cashier.z);
        this.levelPanelAnchor = this.addComponent(new ScreenAnchorComponent(
            this.screenHost,
            this.levelPanel.content,
            () => panelPosition,
            ZONE_LABEL_ANCHOR_OPTIONS,
        ));

        console.log(`[Store] "${this.layout.id}" sells from ${this.storages.length} storage(s): ${this.storages.map(s => s.id).join(', ') || '(none)'}`);
    }

    public override update(delta: number): void {
        super.update(delta);

        for (let i = this.clients.length - 1; i >= 0; i--) {
            if (this.clients[i].isFinished()) {
                this.world!.remove(this.clients[i]);
                this.clients.splice(i, 1);
            }
        }

        const open = this.isOpen();
        if (open) {
            // No-op after the first time — level 0 -> 1 (see StoreProgressStorage.open()).
            StoreProgressStorage.open(this.layout.id);
        }
        this.cashier!.transform.visible = open;
        this.moneyPile!.transform.visible = open;
        this.refreshLevelPanel(open);

        // No clients while closed, still hidden under fog of war (they'd drain storages the player
        // can't reach yet), or with no storage available to buy from.
        if (open && this.isVisible() && this.clients.length < this.config.maxClients && this.getAvailableStorages().length > 0) {
            this.spawnTimerSec += delta;
            if (this.spawnTimerSec >= this.config.spawnIntervalSec) {
                this.spawnTimerSec = 0;
                this.trySpawnClient();
            }
        }

        this.updateCashier(delta);
    }

    public override destroy(): void {
        const world = this.world;
        for (const client of this.clients) {
            world?.remove(client);
        }
        this.clients.length = 0;
        if (this.cashier) {
            world?.remove(this.cashier);
        }
        if (this.moneyPile) {
            world?.remove(this.moneyPile);
        }
        super.destroy();
    }

    /** True once the starter building (if any) has been built — see this file's own doc. */
    public isOpen(): boolean {
        const starter = this.layout.starter;
        if (starter === undefined) {
            return true;
        }
        if (!(Object.values(BuildingId) as string[]).includes(starter)) {
            return false;
        }
        return BuildingStorage.getLevel(starter as BuildingId) >= 1;
    }

    public isVisible(): boolean {
        return this.root.visible;
    }

    /**
     * In-stock storages first; otherwise a storage dedicated to `type` (the client waits there
     * for a refill); otherwise a generic storage that accepts it. Ties go to the shortest line.
     */
    public chooseStorageFor(type: ResourceType): StoreStorageRef | undefined {
        const storages = this.getAvailableStorages();
        const inStock = storages.filter(s => StorageInventory.getCount(s.id, type) > 0);
        const dedicated = storages.filter(s => s.config.resourceType === type);
        const generic = storages.filter(s => s.config.resourceType === undefined && storageAccepts(s.config, type));
        const pool = inStock.length > 0 ? inStock : dedicated.length > 0 ? dedicated : generic;
        let best: StoreStorage | undefined;
        for (const storage of pool) {
            if (!best || storage.line.length < best.line.length) {
                best = storage;
            }
        }
        return best;
    }

    /** Storages clients can use right now — bought (or free), and enabled by the store's level. See StoreUnlocks.isStorageAvailable(). */
    private getAvailableStorages(): StoreStorage[] {
        return this.storages.filter(s => StoreUnlocks.isStorageAvailable(s.id, s.config));
    }

    private refreshLevelPanel(open: boolean): void {
        this.levelPanelAnchor?.setForceHidden(!open || !this.isVisible());
        if (!open) {
            return;
        }
        const level = StoreProgressStorage.getLevel(this.layout.id);
        const next = getNextStoreLevel(this.config, level);
        this.levelPanel.show({
            level,
            next: next && {
                type: next.requirementType,
                progress: next.requirementType === 'sales' ? StoreProgressStorage.getSales(this.layout.id) : StoreProgressStorage.getMoney(this.layout.id),
                amount: next.amount,
            },
        });
    }

    /** Every item a new client may ask for right now — see this file's own doc. */
    private getOfferedTypes(): ResourceType[] {
        const types = new Set<ResourceType>();
        for (const storage of this.getAvailableStorages()) {
            if (storage.config.resourceType !== undefined) {
                types.add(storage.config.resourceType);
            } else {
                for (const type of StorageInventory.getAll(storage.id).keys()) {
                    types.add(type);
                }
            }
        }
        return [...types];
    }

    private trySpawnClient(): void {
        const offered = shuffle(this.getOfferedTypes());
        if (offered.length === 0 || this.config.npcs.length === 0) {
            return;
        }

        const distinct = randomInt(1, Math.min(Math.max(1, this.config.maxDistinctItems), offered.length));
        const wants: StoreClientWant[] = offered.slice(0, distinct).map(type => ({
            type,
            amount: randomInt(1, Math.max(1, this.config.maxAmountPerItem)),
        }));

        const spawn = randomPointInRect(this.layout.entrance);
        const exit = randomPointInRect(this.layout.exit);
        const client = this.world!.add(new StoreClient(
            this,
            new THREE.Vector3(spawn.x, 0, spawn.z),
            new THREE.Vector3(exit.x, 0, exit.z),
            wants,
            pickRandom(this.config.npcs).npcId,
        ));
        this.root.add(client.transform);
        this.clients.push(client);
    }

    /** While the player stands at the cashier, the client at the front of its line pays after payDelaySec. */
    private updateCashier(delta: number): void {
        const front = this.cashierLine.front();
        if (!front?.isReadyToPay() || !this.cashier?.isPlayerInside()) {
            this.payTimerSec = 0;
            return;
        }

        this.payTimerSec += delta;
        if (this.payTimerSec < this.config.payDelaySec) {
            return;
        }
        this.payTimerSec = 0;
        const from = front.getHeadWorldPosition();
        const amount = front.pay();
        this.moneyPile?.receivePayment(amount, from);

        for (const level of StoreProgressStorage.recordSale(this.layout.id, this.config, amount)) {
            UpgradeNotificationManager.instance.show({
                type: NotificationType.Unlockable,
                rarity: NotificationRarity.Common,
                title: 'STORE LEVEL UP!',
                subtitle: `LEVEL ${level}`,
            });
        }
    }
}

/** Same rule as StorageZone.accepts() for a storage with no `resourceType`. */
function storageAccepts(config: StorageConfig, type: ResourceType): boolean {
    return config.accepts === 'all' || (RESOURCE_CONFIG[type]?.category ?? 'main') === config.accepts;
}

function randomInt(min: number, max: number): number {
    return min + Math.floor(Math.random() * (max - min + 1));
}

function shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
}

export interface SpawnStoresDeps {
    world: World;
    threeScene: THREE.Object3D;
    worldObjects: WorldObjectRegistry;
    screenHost: ScreenAnchorHost;
    getWalletOverlayPosition: () => { x: number; y: number };
    /** PizzaScene.registerZoneVisibility() — hides the whole store under fog of war until its zone is revealed. */
    registerZoneVisibility: (object: THREE.Object3D, worldX: number, worldZ: number, width: number, depth: number) => void;
}

/** Builds one Store per fully-drawn store on the map's "stores" layer — PizzaScene's only entry point into this feature. */
export function spawnStores(deps: SpawnStoresDeps): Store[] {
    const stores: Store[] = [];
    for (const layout of readStoreLayouts()) {
        const config = getStoreConfig(layout.id);
        if (config.disabled) {
            continue;
        }

        const storages: StoreStorageSource[] = [];
        for (const [id, placement] of deps.worldObjects.getAllOfType('storage')) {
            const storageConfig = getStorageConfig(id);
            if (!storageConfig.disabled && rectContains(layout.area, placement.x, placement.z)) {
                storages.push({ id, rect: placement, config: storageConfig });
            }
        }

        const root = new THREE.Group();
        root.name = `store:${layout.id}`;
        deps.threeScene.add(root);
        deps.registerZoneVisibility(root, layout.area.x, layout.area.z, layout.area.width, layout.area.depth);

        const store = deps.world.add(new Store(layout, config, storages, deps.screenHost, root, deps.getWalletOverlayPosition));
        stores.push(store);
    }
    return stores;
}
