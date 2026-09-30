// Store.ts
//
// One grocery store (see StoreTypes.ts / StoreLayout.ts) — owns everything
// that happens inside it:
//   - which storages it sells from: every enabled "storage" on mapSettings
//     whose position is inside the store's area. A storage with a
//     `resourceType` always offers that item (even while empty — clients
//     then wait for a refill); a storage without one offers whatever it
//     currently holds. A crop resource is only offered once the player can
//     actually get it (see isObtainable()) — e.g. no tomato orders before a
//     tomato farm plot is owned, unless tomatoes are already in stock.
//   - spawning clients (StoreClient) at the entrance every
//     spawnIntervalSec, up to maxClients, each asking for a few of the
//     currently offered items. Both (and how patient clients are) scale
//     with how many shelves are available — quiet and forgiving with one,
//     full pace with all of them (see getStorePacing()).
//   - one waiting line per storage plus one for the cashier (StoreLine).
//   - the cashier (StoreCashier) and money drop (StoreMoneyPile): while the
//     player stands at the cashier, the client at the front of its line pays
//     and the money flies onto the pile.
//
// Progression: level 0 while closed, 1 on opening, then each payment counts
// (money and sales) toward the next StoreLevelConfig — see
// StoreProgressStorage.ts. The level/progress is shown by the top-center
// StoreUI (ui/StoreUI.ts) while the player is inside the store's area —
// PizzaScene reads containsPoint()/getHudState() every frame. Anything a level `enables` (and the store's free
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
import { ScreenAnchorHost } from '../components/ScreenAnchorComponent';
import type { StoreUIState } from '../ui/StoreUI';
import { UpgradeNotificationManager } from '../ui/notifications/UpgradeNotificationManager';
import { NotificationRarity, NotificationType } from '../ui/notifications/NotificationTypes';
import { RESOURCE_CONFIG, ResourceType } from '../actions/ResourceTypes';
import { StorageInventory } from '../data/StorageInventory';
import { StorageConfig, getStorageConfig } from '../data/StorageTypes';
import { BuildingStorage } from '../data/BuildingStorage';
import { BuildingId } from '../data/BuildingId';
import { BackpackStorage } from '../data/BackpackStorage';
import { CROP_CONFIG, CropId } from '../data/CropTypes';
import { FarmPlotStorage } from '../data/FarmPlotStorage';
import { getFarmPlotConfig } from '../data/FarmTypes';
import { SeedStorage } from '../data/SeedStorage';
import { SEED_CONFIG, SeedId } from '../data/SeedTypes';
import { pickRandom } from '../world/AssetLibraryRegistry';
import WorldObjectRegistry from '../world/WorldObjectRegistry';
import StoreClient, { StoreClientHost, StoreClientWant, StoreSpot, StoreStorageRef } from './StoreClient';
import StoreNavGrid, { NavBounds } from './nav/StoreNavGrid';
import { NavNeighbor } from './nav/NavAgent';
import StoreNavDebug from './nav/StoreNavDebug';
import { layoutQueueSpots } from './StoreQueueSpots';
import { Layers, PHYSICS_DEBUG } from '../physics/PhysicsConstants';
import RigidBody from '../physics/RigidBody';
import { isWalkable } from '../world/TileWalkability';
import StoreCashier from './StoreCashier';
import StoreMoneyPile from './StoreMoneyPile';
import StoreLine from './StoreLine';
import { StoreLayout, StoreRect, randomPointInRect, readStoreLayouts, rectContains } from './StoreLayout';
import { StoreMoneyStorage } from './StoreMoneyStorage';
import { DEFAULT_CLIENT_RADIUS, DEFAULT_NAV_CELL_SIZE, StoreClientMood, StoreConfig, StorePacing, getNextStoreLevel, getStoreConfig, getStorageSpotDirection, getStorePacing, rollClientMoodStepSec } from './StoreTypes';
import { StoreProgressStorage } from './StoreProgressStorage';
import { StoreUnlocks } from './StoreUnlocks';

/** The first client shows up this long after the store spawns, rather than a full spawnIntervalSec. */
const FIRST_SPAWN_DELAY_SEC = 1;
/**
 * Early store levels are forgiving: a client's mood never drops below this. Level 1 stays happy,
 * level 2 can get annoyed; levels not listed have no floor (sad/angry, walking out, paying less).
 */
const MOOD_FLOOR_BY_LEVEL: Partial<Record<number, StoreClientMood>> = {
    1: 'happy',
    2: 'annoyed',
};
/** The nav grid covers the store area + entrance + exit, grown by this much (world units). */
const NAV_BOUNDS_MARGIN = 1;
/** How often the nav grid checks whether anything solid appeared/disappeared (physics bodies changed). */
const NAV_CHECK_SEC = 1;
/** ... and rebuilds regardless this often (e.g. the tile map published its walkability late). */
const NAV_FULL_CHECK_SEC = 5;
/** Static solids taller than this bottom / shorter than this top don't block walking (overhead / flat on the ground). */
const NAV_BODY_MAX_BOTTOM = 1.8;
const NAV_BODY_MIN_TOP = 0.05;
/** Bigger than this on X or Z = a ground plane or similar, never an obstacle. */
const NAV_BODY_MAX_SIZE = 200;

export interface StoreStorageSource {
    id: string;
    rect: StoreRect;
    config: StorageConfig;
}

interface StoreStorage extends StoreStorageRef {
    readonly config: StorageConfig;
    readonly rect: StoreRect;
}

export default class Store extends Entity implements StoreClientHost {
    public readonly config: StoreConfig;
    public readonly screenHost: ScreenAnchorHost;
    public readonly cashierLine: StoreLine<StoreClient>;

    private readonly layout: StoreLayout;
    private readonly storages: StoreStorage[];
    /** Every enabled farm plot id on the map — see isObtainable(). */
    private readonly farmIds: string[];
    private readonly root: THREE.Object3D;
    private readonly getWalletOverlayPosition: () => { x: number; y: number };
    private readonly clients: StoreClient[] = [];
    private cashier?: StoreCashier;
    private moneyPile?: StoreMoneyPile;
    private spawnTimerSec = 0;
    /** True until the first client spawns — it comes after FIRST_SPAWN_DELAY_SEC instead of a full interval. */
    private firstSpawnPending = true;
    private payTimerSec = 0;

    // Navigation — see buildNavGrid().
    private navGrid?: StoreNavGrid;
    private readonly navBounds: NavBounds;
    private navCheckTimerSec = 0;
    private navFullCheckTimerSec = 0;
    private navPhysicsVersion = -1;
    private readonly navNeighbors: NavNeighbor[] = [];
    private player?: RigidBody;
    private playerNeighbor?: NavNeighbor;
    private navDebug?: StoreNavDebug;

    public constructor(
        layout: StoreLayout,
        config: StoreConfig,
        storages: StoreStorageSource[],
        screenHost: ScreenAnchorHost,
        root: THREE.Object3D,
        getWalletOverlayPosition: () => { x: number; y: number },
        farmIds: string[] = [],
    ) {
        super();
        this.farmIds = farmIds;
        this.layout = layout;
        this.config = config;
        this.screenHost = screenHost;
        this.root = root;
        this.getWalletOverlayPosition = getWalletOverlayPosition;

        if (layout.starter !== undefined && !(Object.values(BuildingId) as string[]).includes(layout.starter)) {
            console.warn(`[Store] "${layout.id}" starter "${layout.starter}" is not a BuildingId — the store will stay closed`);
        }

        const center = new THREE.Vector3(layout.area.x, 0, layout.area.z);
        this.storages = storages.map(source => ({
            id: source.id,
            config: source.config,
            rect: source.rect,
            position: new THREE.Vector3(source.rect.x, 0, source.rect.z),
            line: new StoreLine<StoreClient>(source.rect, center, config.spotSpacing, config.spotMargin, getStorageSpotDirection(config, source.id)),
        }));
        this.cashierLine = new StoreLine<StoreClient>(layout.cashier, center, config.spotSpacing, config.spotMargin, config.cashierSpotDirection);

        const covered = [layout.area, layout.entrance, layout.exit].map(rectBounds);
        this.navBounds = {
            minX: Math.min(...covered.map(b => b.minX)) - NAV_BOUNDS_MARGIN,
            minZ: Math.min(...covered.map(b => b.minZ)) - NAV_BOUNDS_MARGIN,
            maxX: Math.max(...covered.map(b => b.maxX)) + NAV_BOUNDS_MARGIN,
            maxZ: Math.max(...covered.map(b => b.maxZ)) + NAV_BOUNDS_MARGIN,
        };
    }

    public override awake(): void {
        const world = this.world!;
        this.cashier = world.add(new StoreCashier(this.layout.cashier));
        this.root.add(this.cashier.transform);
        this.moneyPile = world.add(new StoreMoneyPile(this.layout.id, this.layout.moneyDrop, this.screenHost, this.config.moneyPerBill, this.config.billsPerPile, this.getWalletOverlayPosition));
        this.root.add(this.moneyPile.transform);
        void StoreMoneyStorage.load();

        if (PHYSICS_DEBUG) {
            this.navDebug = new StoreNavDebug();
            this.root.add(this.navDebug.object);
        }

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

        // No clients while closed, still hidden under fog of war (they'd drain storages the player
        // can't reach yet), or with no storage available to buy from.
        const pacing = this.getPacing();
        if (open && this.isVisible() && this.clients.length < pacing.maxClients && this.getAvailableStorages().length > 0) {
            this.spawnTimerSec += delta;
            if (this.spawnTimerSec >= (this.firstSpawnPending ? FIRST_SPAWN_DELAY_SEC : pacing.spawnIntervalSec)) {
                this.spawnTimerSec = 0;
                if (this.trySpawnClient(pacing)) {
                    this.firstSpawnPending = false;
                }
            }
        }

        this.updateCashier(delta);
        this.updateNav(delta);
    }

    public override destroy(): void {
        this.navDebug?.destroy();
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

    /** Lowest mood a client can drop to at the store's current level — see MOOD_FLOOR_BY_LEVEL. */
    public getMoodFloor(): StoreClientMood | undefined {
        return MOOD_FLOOR_BY_LEVEL[StoreProgressStorage.getLevel(this.layout.id)];
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

    public getNavGrid(): StoreNavGrid | undefined {
        return this.navGrid;
    }

    /** Every client plus the player — refreshed once per frame in updateNav(). */
    public getNavNeighbors(): readonly NavNeighbor[] {
        return this.navNeighbors;
    }

    /** Near another available shelf (looking at it), or — with only one — beside the client's own. */
    public findBrowseSpot(client: StoreClient, line: StoreLine<StoreClient>): StoreSpot | undefined {
        const others = this.getAvailableStorages().filter(storage => storage.line !== line);
        const shelf = others.length > 0 ? pickRandom(others) : this.storages.find(storage => storage.line === line);
        if (!shelf) {
            return undefined;
        }
        const point = this.pickFreePointNear(client, shelf.line.firstSpot, shelf.line.spacing * 0.8, shelf.line.spacing * 2.2);
        return point && { point, lookAt: shelf.position };
    }

    /** Somewhere free inside the store's own area, sometimes looking at a shelf once there. */
    public findWanderSpot(client: StoreClient): StoreSpot | undefined {
        const grid = this.navGrid;
        const area = rectBounds(this.layout.area);
        const inset = { minX: area.minX + 1, minZ: area.minZ + 1, maxX: area.maxX - 1, maxZ: area.maxZ - 1 };
        const fallback = randomPointInRect(this.layout.area, 1);
        const point = grid
            ? grid.randomWalkablePoint(inset, candidate => this.isFreeSpot(client, candidate))
            : new THREE.Vector3(fallback.x, 0, fallback.z);
        if (!point) {
            return undefined;
        }
        const shelves = this.getAvailableStorages();
        return { point, lookAt: shelves.length > 0 && Math.random() < 0.5 ? pickRandom(shelves).position : undefined };
    }

    /**
     * Rebuilds the nav grid when something solid may have changed (throttled — see NAV_CHECK_SEC),
     * refreshes the steering neighbour list, and drives the debug overlay.
     */
    private updateNav(delta: number): void {
        const physics = this.world!.physics;
        this.navCheckTimerSec -= delta;
        this.navFullCheckTimerSec -= delta;
        if (this.navCheckTimerSec <= 0) {
            this.navCheckTimerSec = NAV_CHECK_SEC;
            if (!this.navGrid || physics.version !== this.navPhysicsVersion || this.navFullCheckTimerSec <= 0) {
                this.navFullCheckTimerSec = NAV_FULL_CHECK_SEC;
                if (physics.version !== this.navPhysicsVersion) {
                    this.player = undefined;
                }
                this.navPhysicsVersion = physics.version;
                this.rebuildNavGrid();
            }
        }

        if (!this.player) {
            physics.forEachBody(body => {
                if (!this.player && (body.layer & Layers.Player) !== 0 && !body.isTrigger && !body.isStatic) {
                    this.player = body;
                    // Always "moving": clients sidestep the player but don't replan around them.
                    this.playerNeighbor = { position: body.entity.transform.position, isNavMoving: () => true };
                }
            });
        }
        this.navNeighbors.length = 0;
        this.navNeighbors.push(...this.clients);
        if (this.player && this.playerNeighbor) {
            this.navNeighbors.push(this.playerNeighbor);
        }

        this.navDebug?.update(this.navGrid, [...this.storages.map(storage => storage.line), this.cashierLine], this.clients);
    }

    /**
     * Blocked: every storage of this store (bought or not), the cashier and money-drop spots,
     * every static solid physics body in reach (walls, buildings, solid storages, ...), and
     * unwalkable tiles — all grown by the client radius. Kept as-is (no replans) when the
     * result is identical to the current grid; otherwise swapped in and the queue spots re-laid.
     */
    private rebuildNavGrid(): void {
        const radius = this.config.clientRadius ?? DEFAULT_CLIENT_RADIUS;
        const grid = new StoreNavGrid(this.navBounds, this.config.navCellSize ?? DEFAULT_NAV_CELL_SIZE);
        for (const storage of this.storages) {
            grid.blockRect(rectBounds(storage.rect), radius);
        }
        grid.blockRect(rectBounds(this.layout.cashier), radius);
        grid.blockRect(rectBounds(this.layout.moneyDrop), radius);

        const min = new THREE.Vector3();
        const max = new THREE.Vector3();
        this.world!.physics.forEachBody(body => {
            if (!body.isStatic || body.isTrigger || (body.layer & Layers.Player) !== 0) {
                return;
            }
            body.getMin(min);
            body.getMax(max);
            if (max.y < NAV_BODY_MIN_TOP || min.y > NAV_BODY_MAX_BOTTOM || max.x - min.x > NAV_BODY_MAX_SIZE || max.z - min.z > NAV_BODY_MAX_SIZE) {
                return;
            }
            if (max.x < this.navBounds.minX || min.x > this.navBounds.maxX || max.z < this.navBounds.minZ || min.z > this.navBounds.maxZ) {
                return;
            }
            grid.blockRect({ minX: min.x, minZ: min.z, maxX: max.x, maxZ: max.z }, radius);
        });
        grid.blockWhere((x, z) => !isWalkable(x, z));

        if (this.navGrid && this.navGrid.sameBlockedAs(grid)) {
            return;
        }
        this.navGrid = grid;
        layoutQueueSpots(grid, [...this.storages.map(storage => storage.line), this.cashierLine], this.config.waitStyle ?? 'cluster', this.config.maxClients);
    }

    /** A random walkable point between minRadius and maxRadius of `center`, clear of other clients and queue spots. */
    private pickFreePointNear(client: StoreClient, center: THREE.Vector3, minRadius: number, maxRadius: number): THREE.Vector3 | undefined {
        const grid = this.navGrid;
        if (!grid) {
            return undefined;
        }
        const candidates = grid.walkableCellsNear(center.x, center.z, maxRadius)
            .filter(cell => cell.distanceTo(center) >= minRadius && this.isFreeSpot(client, cell));
        return candidates.length > 0 ? pickRandom(candidates) : undefined;
    }

    /** Not on top of another client (where it stands or is heading), nor on any line's queue spot. */
    private isFreeSpot(client: StoreClient, point: THREE.Vector3): boolean {
        const radius = this.config.clientRadius ?? DEFAULT_CLIENT_RADIUS;
        const personal = radius * 4;
        for (const other of this.clients) {
            if (other !== client && other.position.distanceTo(point) < personal) {
                return false;
            }
        }
        for (const line of [...this.storages.map(storage => storage.line), this.cashierLine]) {
            const clearance = line.spacing * 0.6;
            if (line.getSpots().some(spot => spot.distanceTo(point) < clearance) || line.firstSpot.distanceTo(point) < clearance) {
                return false;
            }
        }
        return true;
    }

    /** Busier (and less forgiving) with every shelf the player has made available — see getStorePacing(). */
    private getPacing(): StorePacing {
        return getStorePacing(this.config, this.getAvailableStorages().length, this.storages.length);
    }

    /** Storages clients can use right now — bought (or free), and enabled by the store's level. See StoreUnlocks.isStorageAvailable(). */
    private getAvailableStorages(): StoreStorage[] {
        return this.storages.filter(s => StoreUnlocks.isStorageAvailable(s.id, s.config));
    }

    /** True when world point (x, z) is inside this store's own area (the "store" rect on the map). */
    public containsPoint(x: number, z: number): boolean {
        return rectContains(this.layout.area, x, z);
    }

    /** What the top-center StoreUI shows for this store — undefined while it's closed or still hidden under fog of war. */
    public getHudState(): StoreUIState | undefined {
        if (!this.isOpen() || !this.isVisible()) {
            return undefined;
        }
        const level = StoreProgressStorage.getLevel(this.layout.id);
        const next = getNextStoreLevel(this.config, level);
        return {
            level,
            next: next && {
                type: next.requirementType,
                progress: next.requirementType === 'sales' ? StoreProgressStorage.getSales(this.layout.id) : StoreProgressStorage.getMoney(this.layout.id),
                amount: next.amount,
            },
        };
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
        return [...types].filter(type => this.isObtainable(type));
    }

    /**
     * Can the player fill an order for `type` right now? True when some is already in one of this
     * store's storages or in the backpack, when no crop yields it (not farm-gated — any other
     * source is assumed reachable), or when an owned farm plot can grow a crop that yields it:
     * its assignedCropId, or — for a free plot — an allowed crop the player holds a seed for.
     */
    private isObtainable(type: ResourceType): boolean {
        if (BackpackStorage.getCount(type) > 0 || this.storages.some(s => StorageInventory.getCount(s.id, type) > 0)) {
            return true;
        }
        const crops = (Object.keys(CROP_CONFIG) as CropId[]).filter(id => CROP_CONFIG[id].yield.resourceType === type);
        if (crops.length === 0) {
            return true;
        }
        return this.farmIds.some(farmId => {
            if (!FarmPlotStorage.isOwned(farmId)) {
                return false;
            }
            const plot = getFarmPlotConfig(farmId);
            if (plot.assignedCropId !== undefined) {
                return crops.includes(plot.assignedCropId);
            }
            return crops.some(crop =>
                (plot.allowedCrops === undefined || plot.allowedCrops.includes(crop)) &&
                (Object.keys(SEED_CONFIG) as SeedId[]).some(seed => SEED_CONFIG[seed].cropId === crop && SeedStorage.getCount(seed) > 0));
        });
    }

    /** Returns false when nothing could spawn (nothing offered / no looks configured). */
    private trySpawnClient(pacing: StorePacing): boolean {
        const offered = shuffle(this.getOfferedTypes());
        if (offered.length === 0 || this.config.npcs.length === 0) {
            return false;
        }

        const distinct = randomInt(1, Math.min(Math.max(1, this.config.maxDistinctItems), offered.length));
        const wants: StoreClientWant[] = offered.slice(0, distinct).map(type => ({
            type,
            amount: randomInt(1, Math.max(1, this.config.maxAmountPerItem)),
        }));

        const spawn = randomPointInRect(this.layout.entrance);
        const exit = randomPointInRect(this.layout.exit);
        const spawnAt = new THREE.Vector3(spawn.x, 0, spawn.z);
        const exitAt = new THREE.Vector3(exit.x, 0, exit.z);
        // Never start inside a wall/shelf.
        this.navGrid?.snapToWalkable(spawnAt);
        this.navGrid?.snapToWalkable(exitAt);
        const client = this.world!.add(new StoreClient(
            this,
            spawnAt,
            exitAt,
            wants,
            this.pickNpcId(),
            rollClientMoodStepSec(this.config, pacing),
        ));
        this.root.add(client.transform);
        this.clients.push(client);
        return true;
    }

    /** A random look, preferring ones nobody inside the store is wearing yet so the crowd stays varied. */
    private pickNpcId(): string {
        const inside = new Set(this.clients.map(client => client.npcId));
        const unused = this.config.npcs.filter(entry => !inside.has(entry.npcId));
        return pickRandom(unused.length > 0 ? unused : this.config.npcs).npcId;
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

function rectBounds(rect: StoreRect): NavBounds {
    return { minX: rect.x - rect.width / 2, minZ: rect.z - rect.depth / 2, maxX: rect.x + rect.width / 2, maxZ: rect.z + rect.depth / 2 };
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

        const farmIds: string[] = [];
        for (const [id] of deps.worldObjects.getAllOfType('farm')) {
            if (!getFarmPlotConfig(id).disabled) {
                farmIds.push(id);
            }
        }

        const root = new THREE.Group();
        root.name = `store:${layout.id}`;
        deps.threeScene.add(root);
        deps.registerZoneVisibility(root, layout.area.x, layout.area.z, layout.area.width, layout.area.depth);

        const store = deps.world.add(new Store(layout, config, storages, deps.screenHost, root, deps.getWalletOverlayPosition, farmIds));
        stores.push(store);
    }
    return stores;
}
