import TiledContainer from "@core/tiled/TiledContainer";
import PromiseUtils from "@core/utils/PromiseUtils";
import * as PIXI from "pixi.js";

import { GridBaker } from "./core/GridBaker";
import { CurrencyType, InGameEconomy } from "./data/InGameEconomy";
import { InGameProgress } from "./data/InGameProgress";
import { ProgressionStats } from "./data/ProgressionStats";
import { ShopManager } from "./data/ShopManager";
import { StaticData } from "./data/StaticData";

import { BaseMergeEntity } from "./entity/BaseMergeEntity";
import { BlockMergeEntity } from "./entity/BlockMergeEntity";
import { EggGenerator } from "./entity/EggGenerator";
import { EntityGridView } from "./entity/EntityGridView";
import { MergeEgg } from "./entity/MergeEgg";

import { InputManager } from "./input/InputManager";
import { CoinManager } from "./manager/CoinManager";
import { EntityManager } from "./manager/EntityManager";
import { GameSaveManager } from "./manager/GameSaveManager";

import MergeAssets from "./MergeAssets";
import { MissionManager } from "./missions/MissionManager";
import { RoomId, RoomRegistry } from "./rooms/RoomRegistry";
import { RoomService } from "./rooms/RoomService";

import { MergeFtueService } from "./services/MergeFtueService";
import { MergeInputMergeService } from "./services/MergeInputMergeService";
import { ZoomService } from "./services/ZoomService";

import { TimedRewardRegistry } from "./timedRewards/TimedRewardRegistry";
import { TimedRewardService } from "./timedRewards/TimedRewardService";
import { TimedRewardClaimResult, TimedRewardMilestone } from "./timedRewards/TimedRewardTypes";

import MergeHUD from "./ui/hud/MergeHUD";
import ShopView from "./ui/shop/ShopView";
import { CoinEffectLayer } from "./vfx/CoinEffectLayer";

// Grid mode
import { DevGuiManager } from "../utils/DevGuiManager";
import { EntityGridView2 } from "./grid/EntityGridView2";
import { EntityManagerGrid } from "./grid/EntityManagerGrid";
import { MergeInputMergeGridService } from "./grid/MergeInputMergeGridService";

import { ModifierManager, ModifierType } from "./modifiers/ModifierManager";
import { EnvironmentManager } from "./rooms/EnvironmentManager";
import { ProgressionType } from "./storage/GameStorage";

export type MergeMode = "Free" | "Grid";

type ActiveEntity = BlockMergeEntity | MergeEgg | null;

type InputServiceDeps = {
    gridView: EntityGridView;
    entities: EntityManager;
    coins: CoinManager;
    isUiBlocked: () => boolean;
    mergeRadiusPx: number;
    eggHoverRadiusPx: number;
    instantCollectCoinOnGrab: boolean;
};

const MEDIATOR_CFG = {
    maxCoinsPerEntity: 3,
    mergeRadiusPx: 100,
    eggHoverRadiusPx: 60,

    gridPad: 1500,
    gridYOffset: 60,

    // grid view area for tiles
    gridTilesRectW: 700,
    gridTilesRectH: 700,

    // FTUE defaults
    ftue: {
        maxPairDistancePx: 260,
        eggHoverOffsetY: -70
    },

    // timed rewards
    timedRewardsVisibleWindow: 3,

    // shop
    freeModeExtraSlots: 15
};

export class MergeMediator {
    // Containers
    private readonly tilesContainer: PIXI.Container = new PIXI.Container();
    private readonly entityContainer: PIXI.Container = new PIXI.Container();

    // Core
    private readonly baker: GridBaker;
    private readonly zoomService: ZoomService;

    // Active (these become either Grid or Free implementations)
    private readonly gridView: EntityGridView;
    private readonly entities: EntityManager;
    private readonly inputService: MergeInputMergeService;

    // Managers / Services
    private readonly coins: CoinManager;
    private readonly saver: GameSaveManager;
    private readonly rooms: RoomService;
    private readonly ftueService: MergeFtueService;

    private timedRewards!: TimedRewardService;
    private shopView!: ShopView;
    private input!: InputManager;
    private eggGenerator!: EggGenerator;

    // State
    private activeEntity: ActiveEntity = null;
    private autoCollectCoins: boolean = true;

    private backgroundTiles: PIXI.Container[] = [];

    public constructor(
        private readonly container: PIXI.Container,
        private readonly inputBounds: PIXI.Rectangle,
        private readonly walkBounds: PIXI.Rectangle,
        private readonly coinEffects: CoinEffectLayer,
        private readonly hud: MergeHUD,
        private readonly envManager: EnvironmentManager,
        private readonly mode: MergeMode = "Grid"
    ) {
        this.applyModeBoundsTweaks();

        this.container.addChild(this.tilesContainer);
        this.container.addChild(this.entityContainer);

        ProgressionStats.instance.recordSessionStart();
        this.initMissions();

        this.gridView = this.createGridView();
        this.entityContainer.addChild(this.gridView);

        this.baker = new GridBaker(this.walkBounds, 90);
        this.zoomService = new ZoomService(this.container);

        this.entities = this.createEntityManager();
        this.coins = this.createCoinManager();

        this.inputService = this.createInputService();

        this.saver = new GameSaveManager(this.entities, this.coins);
        this.rooms = this.createRoomService();

        this.ftueService = this.createFtueService();

        this.wireSignals();

        this.loadSave();
        this.setupInput();
        this.setupShop();
        this.setupTimedRewards();

        this.initEggGenerator();
        this.bootstrapFTUE();

        this.ftueService.markDirty();

        this.setupDevButtons();
    }

    // ---------------------------------------------------------------------
    // Init helpers
    // ---------------------------------------------------------------------

    private applyModeBoundsTweaks(): void {
        if (this.mode !== "Grid") {
            return;
        }

        this.walkBounds.pad(MEDIATOR_CFG.gridPad, MEDIATOR_CFG.gridPad);
        this.walkBounds.y -= MEDIATOR_CFG.gridYOffset;
        this.inputBounds.pad(MEDIATOR_CFG.gridPad, MEDIATOR_CFG.gridPad);
    }

    private initMissions(): void {
        MissionManager.instance.initDynamic({
            nextMissionDelaySec: 20,
            cadence: [1, 1, 1, 1, 2],
            fallbackTier: 1
        });
    }

    private createGridView(): EntityGridView {
        if (this.mode !== "Grid") {
            return new EntityGridView();
        }

        const w = MEDIATOR_CFG.gridTilesRectW;
        const h = MEDIATOR_CFG.gridTilesRectH;

        // Optional dev add-on slot
        let add = 0;
        DevGuiManager.instance.addButton("addSlot", () => {
            add++;
        });

        return new EntityGridView2(
            () => InGameProgress.instance.getMaxGridSlots() + add,
            this.walkBounds,
            new PIXI.Rectangle(-w / 2, -h / 2, w, h),
            this.tilesContainer
        );
    }

    private createEntityManager(): EntityManager {
        if (this.mode === "Grid") {
            return new EntityManagerGrid(
                this.gridView,
                this.baker,
                this.walkBounds,
                () => InGameProgress.instance.getMaxGridSlots()
            );
        }

        return new EntityManager(
            this.gridView,
            this.baker,
            this.walkBounds,
            () => InGameProgress.instance.getMaxGridSlots()
        );
    }

    private createCoinManager(): CoinManager {
        return new CoinManager(
            this.gridView,
            this.walkBounds,
            this.coinEffects,
            this.hud,
            (ownerId) => this.decrementPendingCoin(ownerId),
            () => this.autoCollectCoins
        );
    }

    private createInputService(): MergeInputMergeService {
        const deps: InputServiceDeps = {
            gridView: this.gridView,
            entities: this.entities,
            coins: this.coins,
            isUiBlocked: () => this.hud.isAnyUiOpen,
            mergeRadiusPx: MEDIATOR_CFG.mergeRadiusPx,
            eggHoverRadiusPx: MEDIATOR_CFG.eggHoverRadiusPx,
            instantCollectCoinOnGrab: true
        };

        if (this.mode === "Grid") {
            return new MergeInputMergeGridService(deps);
        }

        return new MergeInputMergeService(deps);
    }

    private createRoomService(): RoomService {
        return new RoomService({
            saver: this.saver,
            canSwitchNow: () => !this.activeEntity && !this.hud.isAnyUiOpen
        });
    }

    private createFtueService(): MergeFtueService {
        const hintLayer = (this.hud as any).getHintLayer ? (this.hud as any).getHintLayer() : this.hud;

        return new MergeFtueService({
            parentLayer: hintLayer,
            fingerTexture: PIXI.Texture.from(MergeAssets.Textures.Icons.Finger),
            maxPairDistancePx: MEDIATOR_CFG.ftue.maxPairDistancePx,
            eggHoverOffsetY: MEDIATOR_CFG.ftue.eggHoverOffsetY
        });
    }

    private initEggGenerator(): void {
        this.eggGenerator = new EggGenerator(() => {
            const egg = this.entities.spawnEgg();
            if (egg) {
                this.ftueService.markDirty();
                return true;
            }
            return false;
        });
    }

    private async bootstrapFTUE(): Promise<void> {
        const snap = ProgressionStats.instance.snapshot;

        if (snap.mergesMade < 2 && this.entities.size < 2) {
            await PromiseUtils.await(200);

            const centerX = this.walkBounds.x + this.walkBounds.width / 2;
            const centerY = this.walkBounds.y + this.walkBounds.height / 2;

            const entity1 = this.entities.spawnAnimal(1, new PIXI.Point(centerX + 80, centerY));
            entity1.walkSpeed = 0;

            await PromiseUtils.await(500);

            const entity2 = this.entities.spawnAnimal(1, new PIXI.Point(centerX - 80, centerY));
            entity2.walkSpeed = 0;
        }
    }

    // ---------------------------------------------------------------------
    // Public API
    // ---------------------------------------------------------------------

    public updateRoom(): void {
        this.hud.setCurrentRoom(this.rooms.activeRoomId);

        const newBounds = this.envManager.updateEnvironment(this.rooms.activeRoomId);
        this.walkBounds.copyFrom(newBounds);
    }

    public setupBackground(tiled: TiledContainer): void {
        // Cleanup old
        this.backgroundTiles.forEach((tile) => {
            if (tile.parent) {
                tile.parent.removeChild(tile);
            }
            tile.destroy();
        });
        this.backgroundTiles = [];

        if (!tiled) {
            return;
        }

        // Copy tiles into gridView space
        [...tiled.children].forEach((layer) => {
            if (!(layer instanceof PIXI.Container)) {
                return;
            }

            [...layer.children].forEach((tile) => {
                const posX = layer.x + tile.x;
                const posY = layer.y + tile.y;

                this.gridView.addChild(tile);
                this.backgroundTiles.push(tile as any);

                tile.position.set(posX, posY);
            });
        });
    }

    public update(delta: number): void {
        this.updateCore(delta);
        this.updateGameplay(delta);
        this.updateCoinGeneration(delta);
        this.updateUiAndFtue(delta);
        this.updateSaving(delta);
    }

    // ---------------------------------------------------------------------
    // Wiring / Setup
    // ---------------------------------------------------------------------

    private wireSignals(): void {
        this.entities.onDirty.add(() => this.saver.markDirty());
        this.coins.onDirty.add(() => this.saver.markDirty());

        InGameProgress.instance.onLevelUp.add(this.handleLevelUp, this);

        this.inputService.onActiveChanged.add((active: any) => {
            this.activeEntity = active;
        });

        this.inputService.onDirty.add(() => this.ftueService.markDirty());

        this.rooms.onRoomChanged.add((roomId: RoomId) => {
            this.onRoomChanged(roomId);
        });

        this.hud.onRoomSelected.add((roomId: RoomId) => {
            this.rooms.requestSwitch(roomId);
        });

        this.inputService.OnRewardOpen.add((reward) => {
            this.onRewardOpened(reward);
        });

        this.entities.onEntitySpawned.add((view: any) => {
            this.onEntitySpawned(view);
        });

        this.entities.onEntityRemoved.add((view: any) => {
            this.ftueService.onEntityRemoved(view);
        });

        this.entities.onEggHatched.add((egg: any, spawned: any) => {
            this.onEggHatched(egg, spawned);
        });

        this.inputService.onMergePerformed.add((resultLevel: number) => {
            this.onMergePerformed(resultLevel);
        });

        this.wireFtueZoomCallbacks();
    }

    private setupInput(): void {
        this.input = new InputManager(
            this.entityContainer,
            this.inputBounds,
            this.gridView,
            (ent, pos) => this.inputService.handleGrab(ent, pos),
            (pos) => this.inputService.handleMove(pos, this.autoCollectCoins),
            (pos) => this.inputService.handleRelease(pos),
            (target) => this.inputService.handleHover(target),
            (pos) => this.inputService.handleDown(pos, this.autoCollectCoins)
        );
    }

    private setupShop(): void {
        const maxGridAdd = this.mode === "Free" ? MEDIATOR_CFG.freeModeExtraSlots : 0;

        this.shopView = this.hud.shopView;
        this.shopView.setBoardCallback(() => {
            return this.entities.size >= InGameProgress.instance.getMaxGridSlots() + maxGridAdd;
        });

        this.shopView.onBuyConfirmed.add((itemId: string) => {
            const level = ShopManager.instance.tryPurchase(itemId);
            if (level === null) {
                return;
            }

            if (this.entities.spawnEgg(undefined, { level }, true)) {
                this.ftueService.markDirty();
                this.shopView.refreshStates();
            }
        });

        InGameEconomy.instance.onCurrencyChanged.add(() => {
            this.shopView.refreshStates();
        });
    }

    private setupTimedRewards(): void {
        const registry = TimedRewardRegistry.createDefault5m();

        this.timedRewards = new TimedRewardService({
            registry,
            context: {
                getMoney: () => InGameEconomy.instance.getAmount(CurrencyType.MONEY),
                addMoney: (amt) => InGameEconomy.instance.add(CurrencyType.MONEY, amt),
                getGems: () => InGameEconomy.instance.getAmount(CurrencyType.GEMS),
                addGems: (amt) => InGameEconomy.instance.add(CurrencyType.GEMS, amt),
                getHighestEntityLevel: () => this.getHighestAnimalLevel(),
                spawnEntityAtLevel: (level) => !!this.entities.spawnEgg(undefined, { level }, true)
            },
            visibleWindowSize: MEDIATOR_CFG.timedRewardsVisibleWindow
        });

        this.timedRewards.autoClaim = false;

        this.hud.setTimeRewards(this.timedRewards);
        this.hud.onSpeedUpRequested = () => {
            this.eggGenerator.activateSpeedUp(100);
            MergeAssets.tryToPlaySound(MergeAssets.Sounds.UI.Hold);
        };

        this.timedRewards.onRewardClaimed.add((data: TimedRewardClaimResult, milestone: TimedRewardMilestone) => {
            this.onTimedRewardClaimed(data, milestone);
        });
    }

    private loadSave(): void {
        this.rooms.boot();
    }

    // ---------------------------------------------------------------------
    // Update slices
    // ---------------------------------------------------------------------

    private updateCore(delta: number): void {
        ProgressionStats.instance.recordPlaySeconds(delta);
        ProgressionStats.instance.update(delta);

        this.inputService.update(delta);
        this.zoomService.update(delta);
        this.entities.update(delta);

        if (this.mode === "Grid") {
            this.applyGridTargetZoom();
        }

        this.gridView.update(delta, this.walkBounds);
    }

    private updateGameplay(delta: number): void {
        if (!this.ftueService.ftueEnabled) {
            MissionManager.instance.update(delta);
            this.timedRewards.update(delta);
        }

        const inFocus = !this.hud.isAnyUiOpen;
        this.ftueService.setFocus(inFocus);

        if (!inFocus) {
            return;
        }

        const maxSlots = InGameProgress.instance.getMaxGridSlots();
        const isFull = this.entities.size >= maxSlots;

        if (!isFull && this.ftueService.isCompleted) {
            const speedMul = ModifierManager.instance.getNormalizedValue(ModifierType.SpawnSpeed);
            this.eggGenerator.update(delta * speedMul);
            this.hud.updateProgress(this.eggGenerator.ratio);
        } else {
            this.hud.updateProgress(1);
        }

        this.hud.updateEntityCount(this.entities.size, maxSlots);
        this.hud.setGeneratorFullState(isFull);
    }

    private updateCoinGeneration(delta: number): void {
        this.entities.forEach((logic, view) => {
            if (!logic.generator || logic.data.type !== "animal") {
                return;
            }

            if (logic.data.pendingCoins >= MEDIATOR_CFG.maxCoinsPerEntity) {
                return;
            }

            const genMul = ModifierManager.instance.getNormalizedValue(ModifierType.SpeedGeneration);

            if (logic.generator.update(delta * genMul)) {
                if (!this.autoCollectCoins) {
                    logic.data.pendingCoins++;
                }

                const animal = StaticData.getAnimalData(logic.data.level);
                const offset = (view as BaseMergeEntity)?.coinOffset ?? new PIXI.Point();
                const passiveMul = ModifierManager.instance.getNormalizedValue(ModifierType.PassiveIncome);

                this.coins.dropCoin(
                    (view as any).x + offset.x,
                    (view as any).y + offset.y,
                    Math.ceil(animal.coinValue * passiveMul),
                    logic.data.id,
                    false
                );
            }
        });
    }

    private updateUiAndFtue(_delta: number): void {
        this.hud.setFtueState(this.ftueService.isCompleted);
        this.ftueService.update(_delta);
    }

    private updateSaving(delta: number): void {
        this.saver.update(delta);
    }

    // ---------------------------------------------------------------------
    // Event handlers
    // ---------------------------------------------------------------------

    private onRoomChanged(roomId: RoomId): void {
        this.hud.setCurrentRoom(roomId);
        this.inputService.clearState();

        const newBounds = this.envManager.updateEnvironment(roomId);
        this.walkBounds.copyFrom(newBounds);

        this.ftueService.markDirty();
    }

    private handleLevelUp(type: string, newLevel: number): void {
        if (type !== ProgressionType.MAIN) {
            return;
        }

        // 1. Identify newly unlocked rooms
        // We check the registry against the level the player just left (newLevel - 1)
        const previousLevel = newLevel - 1;
        const allRoomIds: RoomId[] = ["room_0", "room_1", "room_2"]; // Add your Room IDs here or get from RoomRegistry

        const newlyUnlockedRooms = allRoomIds.filter(id => {
            const wasLocked = !RoomRegistry.isUnlocked(id, previousLevel);
            const isUnlocked = RoomRegistry.isUnlocked(id, newLevel);
            return wasLocked && isUnlocked;
        });

        // 2. Play Effects
        //this.hud.playLevelUpEffect(newLevel);

        // // 3. Show Notification
        // this.notifications.toastPrize({
        //     title: "Level Up!",
        //     subtitle: "Level " + newLevel,
        //     iconTexture: MergeAssets.Textures.Icons.BadgeMain
        // });

        // 4. Handle Room Unlocks
        if (newlyUnlockedRooms.length > 0) {
            this.onRoomsUnlocked(newlyUnlockedRooms);
        }
    }

    private onRoomsUnlocked(roomIds: RoomId[]): void {
        console.log("New rooms available:", roomIds);

        if (roomIds.length) {
            this.hud.showNewRooms(RoomRegistry.get(roomIds[0]));
        }

        // Refresh the HUD so the lock icons disappear or the "New" badge appears
        //this.hud.refreshRoomList(); 

        // Optional: Show a specific toast for the room
        // roomIds.forEach(id => {
        //     this.notifications.toastPrize({
        //         title: "New Room Unlocked!",
        //         subtitle: "You can now enter " + id,
        //         iconTexture: MergeAssets.Textures.Icons.Door // Use your room icon
        //     });
        // });
    }

    private onRewardOpened(reward: any): void {
        const data = reward.logic.data;
        const view = reward.view as any;

        if (data.rewardType !== CurrencyType.MONEY && data.rewardType !== CurrencyType.GEMS) {
            return;
        }

        const globalPos = view.toGlobal(new PIXI.Point(0, 0));
        const startPos = this.coinEffects.toLocal(globalPos);

        const hudGlobal = this.hud.getCurrencyTargetGlobalPos(data.rewardType);
        const targetPos = this.coinEffects.toLocal(hudGlobal);

        this.coinEffects.popAndFlyToTarget(
            startPos.x + view.coinOffset.x,
            startPos.y + view.coinOffset.y,
            targetPos.x,
            targetPos.y,
            data.rewardType == CurrencyType.MONEY ? MergeAssets.Textures.Icons.Coin : MergeAssets.Textures.Icons.Gem
        );
    }

    private onEntitySpawned(view: any): void {
        this.ftueService.onEntitySpawned(view);

        if (view instanceof MergeEgg) {
            ProgressionStats.instance.recordEggSpawned(1);
        } else if (view instanceof BlockMergeEntity) {
            ProgressionStats.instance.recordAnimalSpawned(1);
        }
    }

    private onEggHatched(egg: any, spawned: any): void {
        ProgressionStats.instance.recordEggHatched(1);
        MissionManager.instance.reportEggHatched(1);
        this.ftueService.onEggHatched(egg, spawned);
    }

    private onMergePerformed(resultLevel: number): void {
        if (ProgressionStats.instance.snapshot.mergesMade === 1) {
            const centerX = this.walkBounds.x + this.walkBounds.width / 2;
            const centerY = this.walkBounds.y + this.walkBounds.height / 2;

            this.entities.spawnAnimal(resultLevel, new PIXI.Point(centerX, centerY - 150));
            this.ftueService.markDirty();
        }
    }

    private onTimedRewardClaimed(data: TimedRewardClaimResult, _milestone: TimedRewardMilestone): void {
        const id = `${Math.random() * 10000}_chest_${Math.random() * 10000}`;

        MergeAssets.tryToPlaySound(MergeAssets.Sounds.Game.DropChest);

        if (data.moneyAdded) {
            this.entities.spawnRewardContainer(id, data.moneyAdded, CurrencyType.MONEY);
        }

        if (data.gemsAdded) {
            // optional: spawn gems reward container when you add a view for it

            this.entities.spawnRewardContainer(id, data.gemsAdded, CurrencyType.GEMS);
        }

        if (data.spawnedEntityLevel) {
            // optional: toast / animation
        }
    }

    private wireFtueZoomCallbacks(): void {
        let ftueStarted = false;

        this.ftueService.onStarted.add(() => {
            ftueStarted = true;
            this.zoomService.setZoom(1.1, 0.6);
        });

        this.ftueService.onCompleted.add(() => {
            this.zoomService.setZoom(1.0, 0.8);

            if (ftueStarted) {
                this.eggGenerator.progress = EggGenerator.MAX_TIME * 0.85;
                this.entities.spawnRewardContainer(`${Math.random() * 100}_ft`, 50, CurrencyType.MONEY);
            }
        });
    }

    // ---------------------------------------------------------------------
    // Small utilities
    // ---------------------------------------------------------------------

    private decrementPendingCoin(ownerId: string): void {
        this.entities.forEach((logic) => {
            if (logic.data.id === ownerId) {
                logic.data.pendingCoins = Math.max(0, logic.data.pendingCoins - 1);
            }
        });
    }

    private getHighestAnimalLevel(): number {
        let highest = 1;

        this.entities.forEach((logic) => {
            if (logic.data.type === "animal") {
                highest = Math.max(highest, logic.data.level);
            }
        });

        return highest;
    }

    private applyGridTargetZoom(): void {
        const view = this.gridView as any as EntityGridView2;
        if (!view || typeof view.targetScale !== "number") {
            return;
        }

        this.zoomService.setZoom(view.targetScale);
    }

    // ---------------------------------------------------------------------
    // Dev / Debug (optional)
    // ---------------------------------------------------------------------

    private setupDevButtons(): void {
        DevGuiManager.instance.addButton("addChest", () => {
            MergeAssets.tryToPlaySound(MergeAssets.Sounds.Game.DropChest);
            this.entities.spawnRewardContainer("test", 20, CurrencyType.MONEY);
        });

        DevGuiManager.instance.addButton("addXp", () => {
            InGameProgress.instance.addXP(80)
        });

        DevGuiManager.instance.addButton("add High", () => {
            this.entities.spawnAnimal(InGameProgress.instance.getProgression('MAIN').highestMergeLevel)
        });
    }

    public updateDebugRect(): void {
        const gr = new PIXI.Graphics();
        gr.clear();
        gr.beginFill(0xff0000, 0.25);
        gr.drawRect(this.walkBounds.x, this.walkBounds.y, this.walkBounds.width, this.walkBounds.height);
        gr.endFill();

        this.container.addChild(gr);
    }
}
