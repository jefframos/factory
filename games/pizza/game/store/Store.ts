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
//     spawnIntervalSec, each asking for a few of the currently offered items.
//     How many can be inside is a RANGE, not a hard cap: a soft max that grows
//     with the available shelves, hired workers and the store's level (see
//     getStorePacing()), plus up to overflowClients more let in one at a time
//     while the store is stuck — full with nobody paying for stuckSec (see
//     updateOverflow()). A payment closes the extra slots again.
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
// StoreConfig.openRequirement opens it EARLY instead (the FTUE: sell before the
// shop exists) — while open early, at most earlyMaxClients clients come, each
// wants one unit of one item, and none of them gets upset (see isOpenEarly()).
//
// Everything spawned here is parented under `root`, which spawnStores()
// registers with fog of war over the store's own area — so the whole store
// appears/hides together, the same way every other zone does.
//
// Workers (StoreWorker.ts): the store's roster — StoreConfig.workers, saved in
// StoreWorkerStorage.ts the first time the store opens (so levels can be
// upgraded later) — spawns once it's open (see restoreWorkers()):
//   - a cashier (StoreCashierWorker.ts): serving at the cashier counts exactly
//     like the player standing there (see updateCashier()), and it collects
//     the money drop to the player's wallet on its own;
//   - cleaners (StoreCleanerWorker.ts): pick garbage off the floor and throw it
//     in the nearest trash storage (claimNearestGarbage() / getTrashTarget());
//   - restockers (StoreRestockerWorker.ts): refill the emptiest shelf from the
//     farms. Shelves and farm cells are claimed here (findRestockJob() /
//     claimReadySource()) so two restockers never chase the same one, and the
//     nav grid also covers every farm plot so they can walk there.
//
// Garbage (StoreGarbage.ts): a client that stays ANGRY too long drops what it
// carries on the floor (dropGarbage() — each piece on its own free spot, never
// overlapping). The player walking over a piece picks it up as
// ResourceType.Garbage (if their stack has room) for the trash. It's saved
// (StoreGarbageStorage.ts). Every piece makes clients come a little less
// often (garbageSpawnSlowdown), and with maxGarbage pieces no new client comes
// until it's cleaned up.
//
// Clients that already picked something are saved (StoreClientStorage.ts) and
// respawned on load, so a reload never loses items taken off a shelf — see
// restoreClients() / saveClients().
//
// Stores never touch any existing entity: they only read StorageInventory
// (and remove what clients pick up), so StorageZone's own pile follows along
// through StorageInventory.onChange like it does for any other change.

import * as THREE from 'three';
import Entity from '../ecs/Entity';
import World from '../ecs/World';
import { ScreenAnchorHost } from '../components/ScreenAnchorComponent';
import * as PIXI from 'pixi.js';
import { STORE_ICON, type StoreUIState } from '../ui/StoreUI';
import { storeBadgeTextureFor } from '../ui/StoreBadgeProgress';
import { UpgradeNotificationManager } from '../ui/notifications/UpgradeNotificationManager';
import { NotificationRarity, NotificationType } from '../ui/notifications/NotificationTypes';
import { RESOURCE_CONFIG, ResourceType } from '../actions/ResourceTypes';
import { StorageInventory } from '../data/StorageInventory';
import { StorageConfig, getStorageConfig } from '../data/StorageTypes';
import { BuildingStorage } from '../data/BuildingStorage';
import { BuildingId } from '../data/BuildingId';
import { BUILDING_CONFIG } from '../data/BuildingTypes';
import { BackpackStorage } from '../data/BackpackStorage';
import { CROP_CONFIG, CropId } from '../data/CropTypes';
import { FarmPlotStorage } from '../data/FarmPlotStorage';
import { getFarmPlotConfig } from '../data/FarmTypes';
import { SeedStorage } from '../data/SeedStorage';
import { SEED_CONFIG, SeedId } from '../data/SeedTypes';
import { pickRandom } from '../world/AssetLibraryRegistry';
import WorldObjectRegistry, { boundsOfShape, isPointInShape } from '../world/WorldObjectRegistry';
import StoreClient, { StoreClientHost, StoreClientWant, StoreSpot, StoreStorageRef } from './StoreClient';
import StoreWorker from './StoreWorker';
import { WORKER_NPC_ID, type StoreWorkerRole } from './StoreTypes';
import { getNpcConfig, hatSpecOf, NpcLook, rollNpcLook } from '../data/NpcTypes';
import StoreCashierWorker, { StoreCashierHost } from './StoreCashierWorker';
import StoreRestockerWorker, { RestockJob, StoreRestockerHost } from './StoreRestockerWorker';
import StoreCleanerWorker, { StoreCleanerHost, TrashTarget } from './StoreCleanerWorker';

/** A trash storage's TrashTarget plus which storage it is — see Store.trashTargets. */
type StoreTrashSpot = TrashTarget & { storageId: string };
import { SavedStoreWorker, StoreWorkerStorage } from './StoreWorkerStorage';
import StoreGarbage from './StoreGarbage';
import { SavedGarbage, StoreGarbageStorage } from './StoreGarbageStorage';
import { GARBAGE_DARKEN, GarbageCarryStorage } from '../data/GarbageCarryStorage';
import MainPlayer from '../player/MainPlayer';
import { CarryStack } from '../player/CarryStack';
import { flyResourceModel, flyResourceToStack } from '../components/FlyToStack';
import { stackItemScale } from '../components/CarrierStackVisual';
import { getPileScale } from '../components/ItemPile';
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
import { StoreLayout, StorePoint, StoreRect, randomPointInRect, readStoreLayouts, rectContains } from './StoreLayout';
import { StoreMoneyStorage } from './StoreMoneyStorage';
import { SavedStoreClient, StoreClientStorage } from './StoreClientStorage';
import { DEFAULT_CASHIER_VIEW, DEFAULT_CLIENT_RADIUS, DEFAULT_NAV_CELL_SIZE, DEFAULT_RESTOCKER_WANDER_RADIUS, DEFAULT_GARBAGE_SPAWN_SLOWDOWN, DEFAULT_MAX_GARBAGE, DEFAULT_WORKER_COLLECT_EVERY_SALES, DEFAULT_WORKER_WANDER_RADIUS, getCashierLevelStats, getCleanerLevelStats, getRestockerLevelStats, StoreClientMood, StoreConfig, StorePacing, getNextStoreLevel, getStoreConfig, getStorageSpotDirection, getStorePacing, rollClientMoodStepSec } from './StoreTypes';
import { StoreProgressStorage } from './StoreProgressStorage';
import { StoreUnlocks } from './StoreUnlocks';
import { FloorLayers } from '../world/FloorLayers';
import { BuildReveal } from '../player/BuildReveal';
import { isMilestoneRequirementMet } from '../data/MilestoneRequirement';
import { GameAnalytics } from '../analytics/GameAnalytics';
import { ProducedGoods } from '../data/ProducedGoods';
import { RestockSource, RestockSupply } from './RestockSupply';

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
/** Extra waiting spots laid out past the busiest the store can be right now — covers workers hired / levels gained before the next nav rebuild. */
const QUEUE_SPOT_HEADROOM = 3;
/** Two pieces of garbage never sit closer than this (center to center), world units. */
const GARBAGE_SPACING = 1.1;
/** Rings of candidate spots tried around a dropping client, and how far apart they are. */
const GARBAGE_SPOT_RINGS = 6;
/** The player picks garbage up within this distance (world units, on the ground). */
const GARBAGE_PICKUP_RADIUS = 0.9;
/** An angry client compares this many random spots in the store when looking for a clean place to dump — see findCleanDropSpot(). */
const CLEAN_SPOT_CANDIDATES = 24;
/** Garbage further than this from a spot doesn't make it any "cleaner" — past it, closer to the client wins. */
const CLEAN_SPOT_REACH = 6;
/** How much walking distance counts against a spot's cleanness (per world unit). */
const CLEAN_SPOT_WALK_PENALTY = 0.25;
/** Gap between two pickups while standing on a pile. */
const GARBAGE_PICKUP_STAGGER_SEC = 0.12;
/** Picked-up garbage launches from this high above the floor. */
const GARBAGE_PICKUP_HEIGHT = 0.2;
/** The nav grid covers the store area + entrance + exit, grown by this much (world units). */
const NAV_BOUNDS_MARGIN = 1;
/** Random tries findWanderSpot() makes for a point inside the clientArea(s) — more than randomWalkablePoint()'s default, since an irregular area (or one partly over an unbuilt section) rejects many. */
const WANDER_SPOT_TRIES = 48;
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
    /** The dropper rect targeting this storage, if any — where a restocker stands to fill it. */
    dropRect?: StoreRect;
}

interface StoreStorage extends StoreStorageRef {
    readonly config: StorageConfig;
    readonly rect: StoreRect;
    /** Where a restocker stands to fill it — its dropper's center, else its own (see StoreStorageSource.dropRect). */
    readonly dropPoint: THREE.Vector3;
}

export default class Store extends Entity implements StoreClientHost, StoreCashierHost, StoreRestockerHost, StoreCleanerHost {
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
    /** Every spawned worker — see restoreWorkers(). */
    private readonly workers: StoreWorker[] = [];
    /** See getWorkerLook(). */
    private workerLook?: NpcLook;
    /** The one cashier among them (a second cashier entry is kept in the roster but not spawned). */
    private cashierWorker?: StoreCashierWorker;
    /** Roster loaded/seeded and workers spawned — see restoreWorkers(). Nothing is saved before this. */
    private workersRestored = false;
    /** A worker reported a change (see notifyWorkerChanged()) — saveWorkers() runs at the end of this frame. */
    private workersDirty = false;
    /** Shelf / farm cell claims, so two restockers never chase the same one. */
    /** Shelf id -> the restockers currently working it — several may share one shelf while it has room (see findRestockJob()). */
    private readonly claimedStorages = new Map<string, Set<StoreRestockerWorker>>();
    /** Source (farm cell / stall box / dispenser — see RestockSupply.ts) -> the restocker headed there. */
    private readonly claimedTiles = new Map<RestockSource, StoreRestockerWorker>();
    /** Garbage claimed by a cleaner — see claimNearestGarbage(). */
    private readonly claimedGarbage = new Map<StoreGarbage, StoreCleanerWorker>();
    /** Every trash storage on the map — where cleaners throw garbage (see getTrashTarget()). Only the AVAILABLE ones count (bought, store level reached — StoreUnlocks.isStorageAvailable()), checked live since a trash bin can be for sale. */
    private readonly trashTargets: StoreTrashSpot[];
    /** Every store section on the map (id + area) — the parts of the clientArea(s) inside one that isn't built yet are off-limits for wandering (see isClientAreaPoint()). */
    private readonly sections: StoreSectionArea[];
    private readonly handleWorkerLevelChanged = (storeId: string): void => {
        if (storeId === this.layout.id) {
            this.applyWorkerLevels();
        }
    };
    /** isStarterBuilt() as of last frame — undefined before the first one (so a store already built on load doesn't announce). See announceShopOpen(). */
    private starterBuiltLastFrame?: boolean;
    private spawnTimerSec = 0;
    /** True until the first client spawns — it comes after FIRST_SPAWN_DELAY_SEC instead of a full interval. */
    private firstSpawnPending = true;
    private payTimerSec = 0;
    /** Garbage on the floor — see dropGarbage(). */
    private readonly garbage: StoreGarbage[] = [];
    /** Saved garbage respawned yet — nothing is saved before this, so an early save can't wipe it. */
    private garbageRestored = false;
    /** Spots promised to garbage still flying to the floor — so two drops never pick the same spot. */
    private readonly garbageReserved: THREE.Vector3[] = [];
    private garbagePickupTimerSec = 0;
    /** Extra clients currently allowed past the soft max, and how long the store has been full with nobody paying — see updateOverflow(). */
    private overflowAllowed = 0;
    private stuckTimerSec = 0;
    /** Saved clients respawned yet — see restoreClients(). Nothing is saved before this, so an early save can't wipe them. */
    private clientsRestored = false;
    /** A client reported a change (see notifyClientChanged()) — saveClients() runs at the end of this frame. */
    private clientsDirty = false;
    /** Last list written to StoreClientStorage, to skip identical writes. */
    private lastSavedClients = '';

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
        farmRects: StoreRect[] = [],
        trashTargets: StoreTrashSpot[] = [],
        sections: StoreSectionArea[] = [],
    ) {
        super();
        this.farmIds = farmIds;
        this.trashTargets = trashTargets;
        this.sections = sections;
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
            dropPoint: new THREE.Vector3(source.dropRect?.x ?? source.rect.x, 0, source.dropRect?.z ?? source.rect.z),
            line: new StoreLine<StoreClient>(source.rect, center, config.spotSpacing, config.spotMargin, getStorageSpotDirection(config, source.id)),
        }));
        this.cashierLine = new StoreLine<StoreClient>(layout.cashier, center, config.spotSpacing, config.spotMargin, config.cashierSpotDirection);

        // Farm plots too — restocker workers walk there (see StoreRestockerWorker.ts).
        const covered = [layout.area, layout.entrance, layout.exit, ...farmRects].map(rectBounds);
        this.navBounds = {
            minX: Math.min(...covered.map(b => b.minX)) - NAV_BOUNDS_MARGIN,
            minZ: Math.min(...covered.map(b => b.minZ)) - NAV_BOUNDS_MARGIN,
            maxX: Math.max(...covered.map(b => b.maxX)) + NAV_BOUNDS_MARGIN,
            maxZ: Math.max(...covered.map(b => b.maxZ)) + NAV_BOUNDS_MARGIN,
        };
    }

    public override awake(): void {
        const world = this.world!;
        this.cashier = world.add(new StoreCashier(this.layout.cashier, this.config.cashierView ?? DEFAULT_CASHIER_VIEW, this.layout.cashierMesh, !this.config.hideCashierDropperView, this.screenHost));
        this.root.add(this.cashier.transform);
        this.moneyPile = world.add(new StoreMoneyPile(this.layout.id, this.layout.moneyDrop, this.screenHost, this.config.moneyPerBill, this.config.billsPerPile, this.getWalletOverlayPosition, this.config.moneyDropView, this.layout.moneyDropMesh, !this.config.hideMoneyDropDropperView));
        this.root.add(this.moneyPile.transform);
        void StoreMoneyStorage.load();
        void StoreClientStorage.load();
        void StoreWorkerStorage.load();
        void StoreGarbageStorage.load();
        StoreWorkerStorage.onLevelChanged.add(this.handleWorkerLevelChanged);

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

        // The starter just finished building (its build animation included) — announce the shop.
        const starterBuilt = this.isStarterBuilt();
        if (this.starterBuiltLastFrame === false && starterBuilt) {
            this.announceShopOpen();
        }
        this.starterBuiltLastFrame = starterBuilt;

        const open = this.isOpen();
        if (open) {
            // No-op after the first time — level 0 -> 1 (see StoreProgressStorage.open()).
            if (StoreProgressStorage.getLevel(this.layout.id) < 1) {
                GameAnalytics.storeLevelReached(this.layout.id, 1, getNextStoreLevel(this.config, 1) !== undefined);
            }
            StoreProgressStorage.open(this.layout.id);
        }
        this.cashier!.transform.visible = open;
        this.moneyPile!.transform.visible = open;
        if (open) {
            // No-ops after the first time — counters (and their colliders) only exist once open.
            this.cashier!.showCounter();
            this.moneyPile!.showCounter();
            // Once, as soon as the saved roster has loaded.
            if (!this.workersRestored && StoreWorkerStorage.isLoaded()) {
                this.restoreWorkers();
            }
        }

        // No clients while closed, still hidden under fog of war (they'd drain storages the player
        // can't reach yet), or with no storage available to buy from.
        const pacing = this.getPacing();
        this.updateOverflow(delta, pacing);
        if (!this.garbageRestored && StoreGarbageStorage.isLoaded()) {
            this.restoreGarbage();
        }
        this.updateGarbagePickup(delta);
        // A dirty floor (maxGarbage pieces) keeps new clients away until it's cleaned up.
        if (open && this.isVisible() && !this.isTooDirty() && this.clients.length < pacing.maxClients + this.overflowAllowed && this.getAvailableStorages().length > 0) {
            this.spawnTimerSec += delta;
            if (this.spawnTimerSec >= (this.firstSpawnPending ? FIRST_SPAWN_DELAY_SEC : pacing.spawnIntervalSec * this.garbageSpawnFactor())) {
                this.spawnTimerSec = 0;
                if (this.trySpawnClient(pacing)) {
                    this.firstSpawnPending = false;
                }
            }
        }

        this.updateCashier(delta);
        this.updateNav(delta);

        if (open && !this.clientsRestored && StoreClientStorage.isLoaded()) {
            this.restoreClients();
        }
        if (this.clientsDirty && this.clientsRestored) {
            this.saveClients();
        }
        if (this.workersDirty && this.workersRestored) {
            this.saveWorkers();
        }
    }

    public notifyClientChanged(): void {
        this.clientsDirty = true;
    }

    public override destroy(): void {
        this.navDebug?.destroy();
        const world = this.world;
        for (const client of this.clients) {
            world?.remove(client);
        }
        this.clients.length = 0;
        StoreWorkerStorage.onLevelChanged.remove(this.handleWorkerLevelChanged);
        for (const worker of this.workers) {
            world?.remove(worker);
        }
        this.workers.length = 0;
        for (const piece of this.garbage) {
            world?.remove(piece);
        }
        this.garbage.length = 0;
        this.cashierWorker = undefined;
        if (this.cashier) {
            world?.remove(this.cashier);
        }
        if (this.moneyPile) {
            world?.remove(this.moneyPile);
        }
        super.destroy();
    }

    /** True once the starter building (if any) has been built — see this file's own doc. */
    /** This store's map id (the "store" object's `id` on the stores layer). */
    public getId(): string {
        return this.layout.id;
    }

    public isOpen(): boolean {
        return this.isStarterBuilt() || this.isOpenEarly();
    }

    /** True when there's no starter, or it's built — see this file's own doc. */
    private isStarterBuilt(): boolean {
        const starter = this.layout.starter;
        if (starter === undefined) {
            return true;
        }
        if (!(Object.values(BuildingId) as string[]).includes(starter)) {
            return false;
        }
        // Built, and its build animation finished — no cashier/storages/clients popping in mid-build.
        return BuildingStorage.getLevel(starter as BuildingId) >= 1 && !BuildReveal.isRunning(starter);
    }

    /** Open through StoreConfig.openRequirement while the starter isn't built yet — see this file's own doc. */
    private isOpenEarly(): boolean {
        return this.config.openRequirement !== undefined && !this.isStarterBuilt() && isMilestoneRequirementMet(this.config.openRequirement);
    }

    public isVisible(): boolean {
        return this.root.visible;
    }

    /** See StoreClientHost.isCashierUnattended(). */
    public isCashierUnattended(): boolean {
        return !(this.cashier?.isPlayerInside() ?? false) && !this.cashierWorker?.isServing();
    }

    /** Lowest mood a client can drop to at the store's current level — see MOOD_FLOOR_BY_LEVEL. */
    public getMoodFloor(): StoreClientMood | undefined {
        // Open early (the FTUE) — nobody walks out while the player is still learning.
        if (this.isOpenEarly()) {
            return 'happy';
        }
        // The current level's own floor (StoreLevelConfig.moodFloor), else the opt-in built-in
        // ladder (StoreConfig.forgivingEarlyLevels) — by default clients can always get angry.
        const level = StoreProgressStorage.getLevel(this.layout.id);
        const levelFloor = this.config.levels?.find(entry => entry.level === level)?.moodFloor;
        return levelFloor ?? (this.config.forgivingEarlyLevels ? MOOD_FLOOR_BY_LEVEL[level] : undefined);
    }

    // ---- Garbage

    /** See StoreClientHost.dropGarbage() — each unit flies from `from` to its own free floor spot and becomes a StoreGarbage there. */
    public dropGarbage(from: THREE.Vector3, types: ResourceType[]): void {
        for (const type of types) {
            const spot = this.pickGarbageSpot(from);
            this.garbageReserved.push(spot);
            const yaw = Math.random() * Math.PI * 2;
            const land = (): void => {
                const index = this.garbageReserved.indexOf(spot);
                if (index !== -1) {
                    this.garbageReserved.splice(index, 1);
                }
                this.addGarbage({ type, x: spot.x, z: spot.z, yaw });
                this.saveGarbage();
            };
            const scale = stackItemScale() * getPileScale(type);
            flyResourceModel({
                parent: this.root,
                type,
                from: from.clone(),
                startScale: scale,
                endScale: scale,
                orientation: 'lying',
                yawDeg: THREE.MathUtils.radToDeg(yaw),
                resolveTarget: out => out.copy(spot),
                onArrive: land,
            });
        }
    }

    /** x on the spawn interval: every piece of garbage on the floor makes clients come a bit less often (StoreConfig.garbageSpawnSlowdown). */
    private garbageSpawnFactor(): number {
        return 1 + this.garbage.length * Math.max(0, this.config.garbageSpawnSlowdown ?? DEFAULT_GARBAGE_SPAWN_SLOWDOWN);
    }

    /**
     * See StoreClientHost.findCleanDropSpot() — the cleanest of CLEAN_SPOT_CANDIDATES random free
     * spots in the store: furthest from any garbage (up to CLEAN_SPOT_REACH), minus a little for
     * the walk there. undefined without a nav grid / no free spot.
     */
    public findCleanDropSpot(client: StoreClient): THREE.Vector3 | undefined {
        const grid = this.navGrid;
        if (!grid) {
            return undefined;
        }
        const area = rectBounds(this.layout.area);
        const inset = { minX: area.minX + 1, minZ: area.minZ + 1, maxX: area.maxX - 1, maxZ: area.maxZ - 1 };
        const taken = [...this.garbage.map(piece => piece.transform.position), ...this.garbageReserved];
        let best: THREE.Vector3 | undefined;
        let bestScore = -Infinity;
        for (let i = 0; i < CLEAN_SPOT_CANDIDATES; i++) {
            const candidate = grid.randomWalkablePoint(inset, point => this.isFreeSpot(client, point));
            if (!candidate) {
                continue;
            }
            const nearestGarbage = taken.reduce((min, other) => Math.min(min, Math.hypot(other.x - candidate.x, other.z - candidate.z)), CLEAN_SPOT_REACH);
            const score = nearestGarbage - CLEAN_SPOT_WALK_PENALTY * client.position.distanceTo(candidate);
            if (score > bestScore) {
                best = candidate;
                bestScore = score;
            }
        }
        return best;
    }

    /** True with maxGarbage (or more) pieces on the floor — no new clients until it's cleaned up. */
    public isTooDirty(): boolean {
        return this.garbage.length >= Math.max(1, this.config.maxGarbage ?? DEFAULT_MAX_GARBAGE);
    }

    /**
     * The nearest free spot around `near`: rings of candidates GARBAGE_SPACING apart, each on a
     * walkable nav cell (when there's a grid) and at least GARBAGE_SPACING from every piece already
     * down or on its way — so garbage never overlaps. Falls back to `near` itself.
     */
    private pickGarbageSpot(near: THREE.Vector3): THREE.Vector3 {
        const taken = [...this.garbage.map(piece => piece.transform.position), ...this.garbageReserved];
        const grid = this.navGrid;
        for (let ring = 0; ring < GARBAGE_SPOT_RINGS; ring++) {
            const radius = ring * GARBAGE_SPACING;
            const count = ring === 0 ? 1 : ring * 6;
            const startAngle = Math.random() * Math.PI * 2;
            for (let i = 0; i < count; i++) {
                const angle = startAngle + (i / count) * Math.PI * 2;
                const spot = new THREE.Vector3(near.x + Math.cos(angle) * radius, 0, near.z + Math.sin(angle) * radius);
                if (grid && !grid.isWalkableAt(spot.x, spot.z)) {
                    continue;
                }
                if (taken.some(other => Math.hypot(other.x - spot.x, other.z - spot.z) < GARBAGE_SPACING)) {
                    continue;
                }
                return spot;
            }
        }
        return new THREE.Vector3(near.x, 0, near.z);
    }

    private addGarbage(saved: SavedGarbage): void {
        const piece = this.world!.add(new StoreGarbage(saved, this.screenHost));
        this.root.add(piece.transform);
        this.garbage.push(piece);
    }

    /** Respawns the saved garbage — once, as soon as the save has loaded. */
    private restoreGarbage(): void {
        this.garbageRestored = true;
        for (const saved of StoreGarbageStorage.get(this.layout.id)) {
            this.addGarbage(saved);
        }
    }

    private saveGarbage(): void {
        if (this.garbageRestored) {
            StoreGarbageStorage.set(this.layout.id, this.garbage.map(piece => piece.toSave()));
        }
    }

    /** The player walking over garbage picks it up (one piece per GARBAGE_PICKUP_STAGGER_SEC) — it flies onto their stack as ResourceType.Garbage, if there's room. */
    private updateGarbagePickup(delta: number): void {
        this.garbagePickupTimerSec -= delta;
        const player = this.player?.entity;
        if (this.garbagePickupTimerSec > 0 || !(player instanceof MainPlayer) || this.garbage.length === 0) {
            return;
        }
        const { x, z } = player.transform.position;
        const index = this.garbage.findIndex(piece => Math.hypot(piece.transform.position.x - x, piece.transform.position.z - z) <= GARBAGE_PICKUP_RADIUS);
        if (index === -1) {
            return;
        }
        if (!CarryStack.hasRoomFor(1)) {
            CarryStack.notifyFull(player);
            return;
        }
        const [piece] = this.garbage.splice(index, 1);
        this.claimedGarbage.delete(piece);
        const from = piece.transform.position.clone().setY(GARBAGE_PICKUP_HEIGHT);
        this.world!.remove(piece);
        this.saveGarbage();
        // Keeps looking like the darkened item it was, on the way and on the back (see GarbageCarryStorage.ts).
        const was = piece.type;
        flyResourceToStack(this.root, player, ResourceType.Garbage, from, undefined, {
            type: was,
            darken: GARBAGE_DARKEN,
            beforeBank: () => GarbageCarryStorage.push(was),
        });
        this.garbagePickupTimerSec = GARBAGE_PICKUP_STAGGER_SEC;
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

    /**
     * Somewhere free inside the store's clientArea(s) — minus any part over a section not built
     * yet — or, with none drawn, inside the store's own area. Sometimes looking at a shelf once there.
     */
    public findWanderSpot(client: StoreClient): StoreSpot | undefined {
        const grid = this.navGrid;
        const areas = this.layout.clientAreas;
        let bounds: NavBounds;
        if (areas.length > 0) {
            const shapeBounds = areas.map(boundsOfShape);
            bounds = {
                minX: Math.min(...shapeBounds.map(b => b.minX)),
                minZ: Math.min(...shapeBounds.map(b => b.minZ)),
                maxX: Math.max(...shapeBounds.map(b => b.maxX)),
                maxZ: Math.max(...shapeBounds.map(b => b.maxZ)),
            };
        } else {
            const area = rectBounds(this.layout.area);
            bounds = { minX: area.minX + 1, minZ: area.minZ + 1, maxX: area.maxX - 1, maxZ: area.maxZ - 1 };
        }
        let point: THREE.Vector3 | undefined;
        if (grid) {
            point = grid.randomWalkablePoint(bounds, candidate => this.isClientAreaPoint(candidate.x, candidate.z) && this.isFreeSpot(client, candidate), WANDER_SPOT_TRIES);
        } else {
            const fallback = randomPointInRect(this.layout.area, 1);
            point = this.isClientAreaPoint(fallback.x, fallback.z) ? new THREE.Vector3(fallback.x, 0, fallback.z) : undefined;
        }
        if (!point) {
            return undefined;
        }
        const shelves = this.getAvailableStorages();
        return { point, lookAt: shelves.length > 0 && Math.random() < 0.5 ? pickRandom(shelves).position : undefined };
    }

    /** Inside one of the store's clientArea(s) (any point, if none drawn) and not inside a section that isn't built yet. */
    private isClientAreaPoint(x: number, z: number): boolean {
        const areas = this.layout.clientAreas;
        if (areas.length > 0 && !areas.some(shape => isPointInShape(shape, x, z))) {
            return false;
        }
        return !this.sections.some(section => !isSectionBuilt(section.id) && rectContains(section.rect, x, z));
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
        this.navNeighbors.push(...this.workers);
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
        const pacing = getStorePacing(this.config, this.storages.length, this.storages.length, this.workers.length, StoreProgressStorage.getLevel(this.layout.id));
        layoutQueueSpots(grid, [...this.storages.map(storage => storage.line), this.cashierLine], this.config.waitStyle ?? 'cluster', pacing.maxClients + pacing.overflowClients + QUEUE_SPOT_HEADROOM);
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

    /** Busier (and less forgiving) with every shelf the player has made available, every hired worker and every store level — see getStorePacing(). */
    private getPacing(): StorePacing {
        const pacing = getStorePacing(this.config, this.getAvailableStorages().length, this.storages.length, this.workers.length, StoreProgressStorage.getLevel(this.layout.id));
        if (!this.isOpenEarly()) {
            return pacing;
        }
        // Open early (the FTUE): its own client cap and arrival pace, no overflow — see
        // StoreConfig.earlyMaxClients / earlySpawnIntervalSec.
        const earlyMax = this.config.earlyMaxClients;
        const earlyInterval = this.config.earlySpawnIntervalSec;
        return {
            ...pacing,
            maxClients: earlyMax !== undefined ? Math.max(1, earlyMax) : pacing.maxClients,
            spawnIntervalSec: earlyInterval !== undefined && earlyInterval > 0 ? earlyInterval : pacing.spawnIntervalSec,
            overflowClients: earlyMax !== undefined ? 0 : pacing.overflowClients,
        };
    }

    /**
     * Full (at the soft max plus whatever overflow is already open) with nobody paying for
     * stuckSec -> one more client may come in, up to overflowClients. Dropping back under the
     * soft max closes the extra slots; so does any payment (see recordSale()).
     */
    private updateOverflow(delta: number, pacing: StorePacing): void {
        if (this.clients.length < pacing.maxClients) {
            this.overflowAllowed = 0;
            this.stuckTimerSec = 0;
            return;
        }
        if (this.overflowAllowed >= pacing.overflowClients || this.clients.length < pacing.maxClients + this.overflowAllowed) {
            this.stuckTimerSec = 0;
            return;
        }
        this.stuckTimerSec += delta;
        if (this.stuckTimerSec >= pacing.stuckSec) {
            this.stuckTimerSec = 0;
            this.overflowAllowed++;
        }
    }

    /** Storages clients can use right now — bought (or free), and enabled by the store's level. See StoreUnlocks.isStorageAvailable(). */
    private getAvailableStorages(): StoreStorage[] {
        return this.storages.filter(s => StoreUnlocks.isStorageAvailable(s.id, s.config));
    }

    /** True when world point (x, z) is inside this store's own area (the "store" rect on the map). */
    public containsPoint(x: number, z: number): boolean {
        return rectContains(this.layout.area, x, z);
    }

    /** What the top-center StoreUI shows for this store — undefined while it's closed, open early (starter not built), or still hidden under fog of war. */
    public getHudState(): StoreUIState | undefined {
        // Not while open early (the FTUE) — only once the shop itself is built.
        if (!this.isStarterBuilt() || !this.isVisible()) {
            return undefined;
        }
        const level = StoreProgressStorage.getLevel(this.layout.id);
        const next = getNextStoreLevel(this.config, level);
        return {
            name: this.config.name ?? 'Store',
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
            // Something only a producer makes (eggs, butter): only once one making it has been built.
            return !ProducedGoods.isProduced(type) || ProducedGoods.isProducing(type);
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

        // Open early (the FTUE): one unit of one item, so one deposit always makes one sale.
        const early = this.isOpenEarly();
        const distinct = early ? 1 : randomInt(1, Math.min(Math.max(1, this.config.maxDistinctItems), offered.length));
        const wants: StoreClientWant[] = offered.slice(0, distinct).map(type => ({
            type,
            amount: early ? 1 : randomInt(1, Math.max(1, this.config.maxAmountPerItem)),
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

    // ---- Workers

    /**
     * Loads this store's saved roster (StoreWorkerStorage.ts) — seeding it from StoreConfig.workers
     * the first time, and appending any config entry the save doesn't have yet — then spawns
     * every worker in it. Runs once, as soon as the store is open and the save has loaded.
     */
    private restoreWorkers(): void {
        this.workersRestored = true;
        const saved = StoreWorkerStorage.getRoster(this.layout.id);
        const roster: SavedStoreWorker[] = saved ? saved.map(entry => ({ ...entry })) : [];
        for (const entry of this.config.workers ?? []) {
            if (entry.id && !roster.some(existing => existing.id === entry.id)) {
                roster.push({ id: entry.id, role: entry.role, level: Math.max(1, Math.floor(entry.level ?? 1)) });
            }
        }
        StoreWorkerStorage.setRoster(this.layout.id, roster);

        for (const entry of roster) {
            this.spawnWorker(entry);
        }
    }

    /**
     * Hires one more worker (level 1) — added to the saved roster and spawned right away. Returns
     * false (with a warning) when the store isn't open yet, or for a second cashier (one per store).
     */
    public hireWorker(role: StoreWorkerRole): boolean {
        if (!this.workersRestored) {
            console.warn(`[Store] "${this.layout.id}" isn't open yet — can't hire a ${role}`);
            return false;
        }
        if (role === 'cashier' && this.cashierWorker) {
            console.warn(`[Store] "${this.layout.id}" already has a cashier`);
            return false;
        }
        const roster = [...(StoreWorkerStorage.getRoster(this.layout.id) ?? [])];
        let index = 1;
        while (roster.some(entry => entry.id === `${role}${index}`)) {
            index++;
        }
        const entry: SavedStoreWorker = { id: `${role}${index}`, role, level: 1 };
        roster.push(entry);
        StoreWorkerStorage.setRoster(this.layout.id, roster);
        this.spawnWorker(entry);
        return true;
    }

    private spawnWorker(entry: SavedStoreWorker): void {
        const radius = this.config.clientRadius ?? DEFAULT_CLIENT_RADIUS;
        let worker: StoreWorker;
        if (entry.role === 'cashier') {
            if (this.cashierWorker) {
                console.warn(`[Store] "${this.layout.id}": only one cashier worker is spawned — "${entry.id}" stays in the roster unused`);
                return;
            }
            const cashierConfig = this.config.cashierWorker ?? {};
            const stats = getCashierLevelStats(this.config, entry.level);
            const toPoint = (point: StorePoint | undefined, rect: StoreRect): THREE.Vector3 =>
                new THREE.Vector3(point?.x ?? rect.x, 0, point?.z ?? rect.z);
            const cashierPoint = toPoint(this.layout.cashierNpcPoint, this.layout.cashier);
            this.cashierWorker = new StoreCashierWorker(this, {
                id: entry.id,
                level: entry.level,
                moveSpeed: stats.moveSpeed,
                radius,
                look: this.getWorkerLook(),
                spawnAt: cashierPoint,
                payDelaySec: stats.payDelaySec,
                collectEverySales: Math.max(1, Math.floor(cashierConfig.collectEverySales ?? DEFAULT_WORKER_COLLECT_EVERY_SALES)),
                wanderRadius: cashierConfig.wanderRadius ?? DEFAULT_WORKER_WANDER_RADIUS,
                cashierPoint,
                collectPoint: toPoint(this.layout.moneyDropNpcPoint, this.layout.moneyDrop),
            });
            worker = this.cashierWorker;
        } else if (entry.role === 'restocker') {
            const stats = getRestockerLevelStats(this.config, entry.level);
            const spawnAt = this.getHomePoint().clone();
            this.navGrid?.snapToWalkable(spawnAt);
            worker = new StoreRestockerWorker(this, {
                id: entry.id,
                level: entry.level,
                moveSpeed: stats.moveSpeed,
                radius,
                look: this.getWorkerLook(),
                spawnAt,
                carryCapacity: stats.carryCapacity,
                wanderRadius: this.config.restockerWorker?.wanderRadius ?? DEFAULT_RESTOCKER_WANDER_RADIUS,
                carried: entry.carried,
            });
        } else if (entry.role === 'cleaner') {
            const stats = getCleanerLevelStats(this.config, entry.level);
            const spawnAt = this.getHomePoint().clone();
            this.navGrid?.snapToWalkable(spawnAt);
            worker = new StoreCleanerWorker(this, {
                id: entry.id,
                level: entry.level,
                moveSpeed: stats.moveSpeed,
                radius,
                look: this.getWorkerLook(),
                spawnAt,
                carryCapacity: stats.carryCapacity,
                wanderRadius: this.config.cleanerWorker?.wanderRadius ?? DEFAULT_RESTOCKER_WANDER_RADIUS,
                carried: entry.carried,
            });
        } else {
            console.warn(`[Store] "${this.layout.id}": worker "${entry.id}" has unknown role "${String(entry.role)}" — skipping`);
            return;
        }
        this.world!.add(worker);
        this.root.add(worker.transform);
        this.workers.push(worker);
    }

    /**
     * This store's staff look — every worker wears the same one: the NPCs tab's "worker" setup,
     * with this store's workerColor and workerHat over it (so each store's staff looks different).
     * Rolled once per store and reused.
     */
    private getWorkerLook(): NpcLook {
        if (!this.workerLook) {
            const workerNpc = getNpcConfig(WORKER_NPC_ID);
            const base = workerNpc ? rollNpcLook(workerNpc) : {};
            this.workerLook = {
                ...base,
                color: this.config.workerColor || base.color,
                hat: hatSpecOf(this.config.workerHat) ?? base.hat,
            };
        }
        return this.workerLook;
    }

    /** Re-saves the roster: every spawned worker's current state, plus any saved entry that isn't spawned (e.g. a second cashier). */
    private saveWorkers(): void {
        this.workersDirty = false;
        const saved = StoreWorkerStorage.getRoster(this.layout.id) ?? [];
        const roster = saved.map(entry => {
            const worker = this.workers.find(candidate => candidate.workerId === entry.id);
            if (worker instanceof StoreRestockerWorker || worker instanceof StoreCleanerWorker) {
                return worker.toSave();
            }
            return worker ? { ...entry, level: worker.getLevel() } : entry;
        });
        StoreWorkerStorage.setRoster(this.layout.id, roster);
    }

    /** StoreWorkerStorage.setLevel() changed someone's level — hand each live worker its saved level. */
    private applyWorkerLevels(): void {
        const roster = StoreWorkerStorage.getRoster(this.layout.id) ?? [];
        for (const worker of this.workers) {
            const entry = roster.find(candidate => candidate.id === worker.workerId);
            if (entry && entry.level !== worker.getLevel()) {
                worker.applyLevel(entry.level);
            }
        }
    }

    public getCashierStats(level: number): { moveSpeed: number; payDelaySec: number } {
        return getCashierLevelStats(this.config, level);
    }

    public getRestockerStats(level: number): { moveSpeed: number; carryCapacity: number } {
        return getRestockerLevelStats(this.config, level);
    }

    public hasMoneyToCollect(): boolean {
        return StoreMoneyStorage.get(this.layout.id) > 0;
    }

    public collectMoney(): void {
        this.moneyPile?.collectToWallet();
    }

    /** Middle of the store's shelves (the store area's center with none). */
    public getHomePoint(): THREE.Vector3 {
        if (this.storages.length === 0) {
            return new THREE.Vector3(this.layout.area.x, 0, this.layout.area.z);
        }
        const sum = new THREE.Vector3();
        this.storages.forEach(storage => sum.add(storage.position));
        return sum.divideScalar(this.storages.length);
    }

    /** See StoreRestockerHost.findRestockJob() — the emptiest available, not-full shelf with a ready, unclaimed farm cell for its item. */
    /**
     * The shelf this restocker should fill next. Several restockers may work the same shelf as long
     * as what it holds plus everything the OTHERS working it can carry still leaves room — so a
     * second restocker helps with a big shelf instead of standing around. A shelf nobody else is
     * serving wins first (spreads them out), then the emptiest.
     */
    public findRestockJob(worker: StoreRestockerWorker): RestockJob | undefined {
        const pick = this.getAvailableStorages()
            .filter(storage => storage.config.resourceType !== undefined)
            .map(storage => {
                const others = this.otherClaimers(storage.id, worker);
                return {
                    storage,
                    type: storage.config.resourceType!,
                    count: StorageInventory.getCount(storage.id, storage.config.resourceType!),
                    others: others.length,
                    promised: others.reduce((sum, other) => sum + other.getCarryCapacity(), 0),
                };
            })
            .filter(candidate => candidate.count + candidate.promised < storageCapacity(candidate.storage.config) && this.hasReadyTile(candidate.type, worker))
            .sort((a, b) => a.others - b.others || a.count - b.count)[0];
        return pick && this.claimStorage(pick.storage, pick.type, worker);
    }

    /** Every restocker other than `worker` currently working shelf `storageId`. */
    private otherClaimers(storageId: string, worker: StoreRestockerWorker): StoreRestockerWorker[] {
        return [...(this.claimedStorages.get(storageId) ?? [])].filter(owner => owner !== worker);
    }

    /** See StoreRestockerHost.findShelfFor() — a shelf dedicated to `type` (an unclaimed one first), else any shelf that accepts it. */
    public findShelfFor(worker: StoreRestockerWorker, type: ResourceType): RestockJob | undefined {
        const shelves = this.getAvailableStorages();
        const dedicated = shelves.filter(storage => storage.config.resourceType === type);
        const generic = shelves.filter(storage => storage.config.resourceType === undefined && storageAccepts(storage.config, type));
        const pick = dedicated.find(storage => this.otherClaimers(storage.id, worker).length === 0) ?? dedicated[0] ?? generic[0];
        return pick && this.claimStorage(pick, type, worker);
    }

    /** See StoreRestockerHost.claimReadySource() — the nearest ready, unclaimed source (farm cell, stall box, dispenser) of `type`; replaces this worker's previous source claim. */
    public claimReadySource(worker: StoreRestockerWorker, type: ResourceType, near: THREE.Vector3): RestockSource | undefined {
        for (const [source, owner] of this.claimedTiles) {
            if (owner === worker) {
                this.claimedTiles.delete(source);
            }
        }
        let best: RestockSource | undefined;
        let bestDistance = Infinity;
        for (const source of RestockSupply.getAll()) {
            if (source.getReadyYield()?.resourceType !== type || this.isClaimedByOther(this.claimedTiles.get(source), worker)) {
                continue;
            }
            const distance = source.walkPoint.distanceToSquared(near);
            if (distance < bestDistance) {
                best = source;
                bestDistance = distance;
            }
        }
        if (best) {
            this.claimedTiles.set(best, worker);
        }
        return best;
    }

    public getCleanerStats(level: number): { moveSpeed: number; carryCapacity: number } {
        return getCleanerLevelStats(this.config, level);
    }

    /** See StoreCleanerHost.claimNearestGarbage() — the nearest unclaimed piece on this store's floor; replaces the cleaner's previous claim. */
    public claimNearestGarbage(worker: StoreCleanerWorker, near: THREE.Vector3): StoreGarbage | undefined {
        this.releaseGarbageClaims(worker);
        let best: StoreGarbage | undefined;
        let bestDistance = Infinity;
        for (const piece of this.garbage) {
            const owner = this.claimedGarbage.get(piece);
            if (owner && owner !== worker) {
                continue;
            }
            const distance = piece.transform.position.distanceToSquared(near);
            if (distance < bestDistance) {
                best = piece;
                bestDistance = distance;
            }
        }
        if (best) {
            this.claimedGarbage.set(best, worker);
        }
        return best;
    }

    public hasGarbage(piece: StoreGarbage): boolean {
        return this.garbage.includes(piece);
    }

    /** See StoreCleanerHost.takeGarbage() — off the floor (and the save); false if it's gone already. */
    public takeGarbage(worker: StoreCleanerWorker, piece: StoreGarbage): boolean {
        const index = this.garbage.indexOf(piece);
        if (index === -1) {
            return false;
        }
        this.garbage.splice(index, 1);
        this.claimedGarbage.delete(piece);
        this.world!.remove(piece);
        this.saveGarbage();
        return true;
    }

    /** See StoreCleanerHost.getTrashTarget() — the nearest trash storage on the map. */
    public getTrashTarget(near: THREE.Vector3): TrashTarget | undefined {
        let best: TrashTarget | undefined;
        let bestDistance = Infinity;
        for (const target of this.trashTargets) {
            if (!StoreUnlocks.isStorageAvailable(target.storageId, getStorageConfig(target.storageId))) {
                continue;
            }
            const distance = target.dropPoint.distanceToSquared(near);
            if (distance < bestDistance) {
                best = target;
                bestDistance = distance;
            }
        }
        return best && { dropPoint: best.dropPoint.clone(), binPosition: best.binPosition.clone() };
    }

    public releaseGarbageClaims(worker: StoreCleanerWorker): void {
        for (const [piece, owner] of this.claimedGarbage) {
            if (owner === worker) {
                this.claimedGarbage.delete(piece);
            }
        }
    }

    public releaseClaims(worker: StoreRestockerWorker): void {
        for (const [id, owners] of this.claimedStorages) {
            owners.delete(worker);
            if (owners.size === 0) {
                this.claimedStorages.delete(id);
            }
        }
        for (const [source, owner] of this.claimedTiles) {
            if (owner === worker) {
                this.claimedTiles.delete(source);
            }
        }
    }

    public getFlightParent(): THREE.Object3D | undefined {
        return this.root;
    }

    public notifyWorkerChanged(): void {
        this.workersDirty = true;
    }

    private claimStorage(storage: StoreStorage, type: ResourceType, worker: StoreRestockerWorker): RestockJob {
        // One shelf per worker at a time — drop any previous shelf claim first.
        for (const [id, owners] of this.claimedStorages) {
            owners.delete(worker);
            if (owners.size === 0) {
                this.claimedStorages.delete(id);
            }
        }
        const owners = this.claimedStorages.get(storage.id) ?? new Set<StoreRestockerWorker>();
        owners.add(worker);
        this.claimedStorages.set(storage.id, owners);
        return { storageId: storage.id, type, dropPoint: storage.dropPoint.clone(), shelfPosition: storage.position.clone() };
    }

    private hasReadyTile(type: ResourceType, worker: StoreRestockerWorker): boolean {
        return RestockSupply.getAll().some(source => source.getReadyYield()?.resourceType === type && !this.isClaimedByOther(this.claimedTiles.get(source), worker));
    }

    private isClaimedByOther(owner: StoreRestockerWorker | undefined, worker: StoreRestockerWorker): boolean {
        return owner !== undefined && owner !== worker;
    }

    /** Respawns every client saved with picked items (see StoreClientStorage.ts) where it was, with the same list, progress and mood. Runs once, as soon as the store is open and the save has loaded. */
    private restoreClients(): void {
        this.clientsRestored = true;
        for (const saved of StoreClientStorage.get(this.layout.id)) {
            const wants = saved.wants.filter(want => RESOURCE_CONFIG[want.type] !== undefined);
            if (!wants.some(want => want.bought > 0)) {
                continue;
            }
            const spawnAt = new THREE.Vector3(saved.x, 0, saved.z);
            const exitAt = new THREE.Vector3(saved.exitX, 0, saved.exitZ);
            this.navGrid?.snapToWalkable(spawnAt);
            this.navGrid?.snapToWalkable(exitAt);
            const client = this.world!.add(new StoreClient(
                this,
                spawnAt,
                exitAt,
                wants.map(want => ({ type: want.type, amount: want.remaining + want.bought })),
                saved.npcId,
                saved.moodStepSec,
                saved.look,
            ));
            client.restoreProgress(wants, saved.moodIndex);
            this.root.add(client.transform);
            this.clients.push(client);
        }
        // Re-save right away — drops anything that couldn't be restored.
        this.clientsDirty = true;
    }

    /** Writes every client worth keeping (see StoreClient.toSave()) to StoreClientStorage. */
    private saveClients(): void {
        this.clientsDirty = false;
        const list = this.clients.map(client => client.toSave()).filter((saved): saved is SavedStoreClient => saved !== undefined);
        const json = JSON.stringify(list);
        if (json === this.lastSavedClients) {
            return;
        }
        this.lastSavedClients = json;
        StoreClientStorage.set(this.layout.id, list);
    }

    /** A random look, preferring ones nobody inside the store is wearing yet so the crowd stays varied. */
    private pickNpcId(): string {
        const inside = new Set(this.clients.map(client => client.npcId));
        const unused = this.config.npcs.filter(entry => !inside.has(entry.npcId));
        return pickRandom(unused.length > 0 ? unused : this.config.npcs).npcId;
    }

    /**
     * While the player stands at the cashier — or the cashier worker is serving there — the client
     * at the front of its line pays after payDelaySec (the worker's own, when only it is there; the
     * quicker of the two when both are).
     */
    private updateCashier(delta: number): void {
        const front = this.cashierLine.front();
        const playerServing = this.cashier?.isPlayerInside() ?? false;
        const worker = this.cashierWorker?.isServing() ? this.cashierWorker : undefined;
        // A client waiting at the front with nobody serving — the '!' over the counter calls the player.
        this.cashier?.setNeedsService(!!front?.isReadyToPay() && !playerServing && !worker);
        if (!front?.isReadyToPay() || (!playerServing && !worker)) {
            this.payTimerSec = 0;
            return;
        }

        const delaySec = worker
            ? (playerServing ? Math.min(this.config.payDelaySec, worker.getPayDelaySec()) : worker.getPayDelaySec())
            : this.config.payDelaySec;
        this.payTimerSec += delta;
        if (this.payTimerSec < delaySec) {
            return;
        }
        this.payTimerSec = 0;
        const from = front.getHeadWorldPosition();
        GameAnalytics.clientPaid(front.getMood());
        const amount = front.pay();
        this.moneyPile?.receivePayment(amount, from);
        this.recordSale(amount);
        worker?.onServed();
    }

    /** Debug/test — counts `amount` as one paid sale toward the next level (see PizzaScene's "Add 50 To Store" button). No-op while the store is closed. */
    public debugRecordSale(amount: number): void {
        this.recordSale(amount);
    }

    /** Same Unlockable callout a bought storage gets (see StoragePurchaseZone.announce()). */
    private announceShopOpen(): void {
        UpgradeNotificationManager.instance.show({
            type: NotificationType.Unlockable,
            rarity: NotificationRarity.Common,
            icon: PIXI.Texture.from(STORE_ICON),
            badgeTexture: storeBadgeTextureFor(Math.max(1, StoreProgressStorage.getLevel(this.layout.id))),
            title: 'SHOP OPEN!',
            subtitle: (this.config.name ?? 'New shop').toUpperCase(),
        });
    }

    private recordSale(amount: number): void {
        // Someone paid — the store isn't stuck any more (see updateOverflow()).
        this.overflowAllowed = 0;
        this.stuckTimerSec = 0;
        for (const level of StoreProgressStorage.recordSale(this.layout.id, this.config, amount)) {
            GameAnalytics.storeLevelReached(this.layout.id, level, getNextStoreLevel(this.config, level) !== undefined);
            UpgradeNotificationManager.instance.show({
                type: NotificationType.Unlockable,
                rarity: NotificationRarity.Common,
                icon: PIXI.Texture.from(STORE_ICON),
                badgeTexture: storeBadgeTextureFor(level),
                title: 'STORE LEVEL UP!',
                subtitle: `LEVEL ${level}`,
            });
        }
    }
}

/** Same rule as BuildingZone's own isSectionBuilt(): a section is active once its building reaches level 1. */
function isSectionBuilt(sectionId: string): boolean {
    return BUILDING_CONFIG[sectionId as BuildingId] !== undefined && BuildingStorage.getLevel(sectionId as BuildingId) >= 1;
}

function rectBounds(rect: StoreRect): NavBounds {
    return { minX: rect.x - rect.width / 2, minZ: rect.z - rect.depth / 2, maxX: rect.x + rect.width / 2, maxZ: rect.z + rect.depth / 2 };
}

/** How many items a storage's pile shows — a restocker treats a shelf at this count as full. Same fallback as StorageZone.buildLayout(). */
function storageCapacity(config: StorageConfig): number {
    const pile = config.pile ?? { columns: 3, rows: 3, layers: 4 };
    return pile.columns * pile.rows * pile.layers;
}

/** Same rule as StorageZone.accepts() for a storage with no `resourceType`. */
function storageAccepts(config: StorageConfig, type: ResourceType): boolean {
    if (type === ResourceType.Garbage) {
        return false;
    }
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

/** A store section's id (its building id) and area — see Store.sections. */
export interface StoreSectionArea {
    id: string;
    rect: StoreRect;
}

export interface SpawnStoresDeps {
    world: World;
    threeScene: THREE.Object3D;
    worldObjects: WorldObjectRegistry;
    screenHost: ScreenAnchorHost;
    getWalletOverlayPosition: () => { x: number; y: number };
    /** PizzaScene.registerZoneVisibility() — hides the whole store under fog of war until its cashier's zone is revealed. */
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
            if (!storageConfig.disabled && !storageConfig.trash && rectContains(layout.area, placement.x, placement.z)) {
                storages.push({ id, rect: placement, config: storageConfig, dropRect: deps.worldObjects.getDropperFor(id) });
            }
        }

        const farmIds: string[] = [];
        const farmRects: StoreRect[] = [];
        for (const [id, placement] of deps.worldObjects.getAllOfType('farm')) {
            if (!getFarmPlotConfig(id).disabled) {
                farmIds.push(id);
                farmRects.push(placement);
            }
        }
        // Restockers also pick up at animal stalls' boxes and mix stations' dispensers (see
        // RestockSupply.ts) — the nav grid has to reach those too.
        for (const [id] of deps.worldObjects.getAllOfType('animalStall')) {
            farmRects.push(...deps.worldObjects.getPartsFor(id, 'storage'));
        }
        for (const [id] of deps.worldObjects.getAllOfType('mixStation')) {
            farmRects.push(...deps.worldObjects.getPartsFor(id, 'dispenser'), ...deps.worldObjects.getPartsFor(id, 'collectArea'));
        }

        // Every trash storage on the map (stores never sell from one — see above) — where cleaners throw garbage.
        const trashTargets: StoreTrashSpot[] = [];
        for (const [id, placement] of deps.worldObjects.getAllOfType('storage')) {
            const storageConfig = getStorageConfig(id);
            if (storageConfig.disabled || !storageConfig.trash) {
                continue;
            }
            const dropper = deps.worldObjects.getDropperFor(id);
            trashTargets.push({
                storageId: id,
                dropPoint: new THREE.Vector3(dropper?.x ?? placement.x, 0, dropper?.z ?? placement.z),
                // Its drop point (StorageZone: dropOffset, default y 0.4) — the bin's opening.
                binPosition: new THREE.Vector3(placement.x + (storageConfig.dropOffset?.x ?? 0), FloorLayers.baseY + (storageConfig.dropOffset?.y ?? 0.4), placement.z + (storageConfig.dropOffset?.z ?? 0)),
            });
        }

        const sections: StoreSectionArea[] = deps.worldObjects.getStoreSections().map(section => ({ id: section.id, rect: section.placement }));

        const root = new THREE.Group();
        root.name = `store:${layout.id}`;
        deps.threeScene.add(root);
        // By the cashier's zone, not the whole store area — a store may overlap a zone that only
        // opens later (its expansion, see ZoneTypes.ts), and its clients/cashier/workers (all
        // under `root`) must show while that one is still locked.
        deps.registerZoneVisibility(root, layout.cashier.x, layout.cashier.z, layout.cashier.width, layout.cashier.depth);

        const store = deps.world.add(new Store(layout, config, storages, deps.screenHost, root, deps.getWalletOverlayPosition, farmIds, farmRects, trashTargets, sections));
        stores.push(store);
    }
    return stores;
}
