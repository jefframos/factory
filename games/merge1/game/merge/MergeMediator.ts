import { ExtractTiledFile } from "@core/tiled/ExtractTiledFile";
import TiledContainer from "@core/tiled/TiledContainer";
import * as PIXI from "pixi.js";
import { DevGuiManager } from "../utils/DevGuiManager";
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
import { RoomId } from "./rooms/RoomRegistry";
import { RoomService } from "./rooms/RoomService";
import { MergeFtueService } from "./services/MergeFtueService";
import { MergeInputMergeService } from "./services/MergeInputMergeService";
import { ZoomService } from "./services/ZoomService";
import { TimedRewardRegistry } from "./timedRewards/TimedRewardRegistry";
import { TimedRewardService } from "./timedRewards/TimedRewardService";
import MergeHUD from "./ui/MergeHUD";
import ShopView from "./ui/shop/ShopView";
import { CoinEffectLayer } from "./vfx/CoinEffectLayer";

export class MergeMediator {
    private readonly gridView: EntityGridView;
    private readonly baker: GridBaker;

    private readonly entities: EntityManager;
    private readonly coins: CoinManager;
    private readonly saver: GameSaveManager;

    private activeEntity: BlockMergeEntity | MergeEgg | null = null;

    private readonly MAX_COINS_PER_ENTITY: number = 3;
    private readonly MERGE_RADIUS_PX: number = 100;

    private autoCollectCoins: boolean = true;

    private shopView!: ShopView;
    private input!: InputManager;

    private readonly rooms: RoomService;
    private readonly inputService: MergeInputMergeService;
    private readonly zoomService: ZoomService;

    private readonly eggGenerator: EggGenerator;

    private readonly ftueService: MergeFtueService;

    private readonly timedRewards: TimedRewardService;

    public constructor(
        private readonly container: PIXI.Container,
        private readonly inputBounds: PIXI.Rectangle,
        private readonly walkBounds: PIXI.Rectangle,
        private readonly coinEffects: CoinEffectLayer,
        private readonly hud: MergeHUD
    ) {
        ProgressionStats.instance.recordSessionStart();

        MissionManager.instance.initDynamic({
            nextMissionDelaySec: 20,
            cadence: [1, 1, 1, 1, 2],
            fallbackTier: 1
        });

        this.gridView = new EntityGridView();
        this.container.addChild(this.gridView);

        // Tiled Background Initialization
        if (ExtractTiledFile.TiledData) {
            const tiled = new TiledContainer(ExtractTiledFile.getTiledFrom('garden'), ['Background']);
            const topLevelChildren = [...tiled.children];

            topLevelChildren.forEach((child) => {
                if (child instanceof PIXI.Container) {
                    const subChildren = [...child.children];
                    subChildren.forEach((grandChild) => {
                        const worldPos = grandChild.getGlobalPosition();
                        this.gridView.addChild(grandChild);
                        const localPos = this.gridView.toLocal(worldPos);
                        grandChild.position.set(localPos.x, localPos.y);
                    });
                }
            });
        }

        this.baker = new GridBaker(this.walkBounds, 90);
        this.zoomService = new ZoomService(this.container);

        this.entities = new EntityManager(
            this.gridView,
            this.baker,
            this.walkBounds,
            () => InGameProgress.instance.getMaxGridSlots()
        );

        this.coins = new CoinManager(
            this.gridView,
            this.walkBounds,
            this.coinEffects,
            this.hud,
            (ownerId) => this.decrementPendingCoin(ownerId),
            () => this.autoCollectCoins
        );

        this.saver = new GameSaveManager(this.entities, this.coins);

        this.rooms = new RoomService({
            saver: this.saver,
            canSwitchNow: () => !this.activeEntity && !this.hud.isAnyUiOpen
        });

        this.inputService = new MergeInputMergeService({
            gridView: this.gridView,
            entities: this.entities,
            coins: this.coins,
            isUiBlocked: () => this.hud.isAnyUiOpen,
            mergeRadiusPx: this.MERGE_RADIUS_PX,
            eggHoverRadiusPx: 60,
            instantCollectCoinOnGrab: true
        });

        // FTUE Service Initialization
        const hintLayer = (this.hud as any).getHintLayer ? (this.hud as any).getHintLayer() : this.hud;
        this.ftueService = new MergeFtueService({
            parentLayer: hintLayer,
            fingerTexture: PIXI.Texture.from(MergeAssets.Textures.Icons.Finger),
            maxPairDistancePx: 260,
            eggHoverOffsetY: -70
        });

        // --- FTUE & ZOOM WIRING ---
        let started = false;
        this.ftueService.onStarted.add(() => {
            this.zoomService.setZoom(1.3, 0.6);
            started = true;
        });

        this.ftueService.onCompleted.add(() => {
            this.zoomService.setZoom(1.0, 0.8);
            if (started) {
                this.entities.spawnAnimal(1);
                this.entities.spawnAnimal(1);
                this.entities.spawnAnimal(2);
            }
        });

        // Listen for merges to handle the "fast-track" spawns
        this.inputService.onMergePerformed.add((resultLevel: number) => {
            const s = ProgressionStats.instance.snapshot;
            // After first merge (Lvl 1 -> 2), instantly spawn another Lvl 2 for the second merge
            if (s.mergesMade === 1) {
                this.entities.spawnAnimal(resultLevel);
                this.ftueService.markDirty();
            }
        });

        // Signal Wiring
        this.entities.onDirty.add(() => this.saver.markDirty());
        this.coins.onDirty.add(() => this.saver.markDirty());
        this.inputService.onActiveChanged.add((active: any) => this.activeEntity = active);
        this.inputService.onDirty.add(() => this.ftueService.markDirty());

        this.wireEntitySignals();
        this.loadSave();
        this.setupInput();
        this.setupShop();

        // --- START STATE LOGIC ---
        const snap = ProgressionStats.instance.snapshot;
        if (snap.mergesMade < 2 && this.entities.entitiesByView.size < 2) {
            // New player: skip eggs, spawn 2 matching level 1 entities immediately
            this.entities.spawnAnimal(1);
            this.entities.spawnAnimal(1);
        }

        this.eggGenerator = new EggGenerator(() => {
            const egg = this.entities.spawnEgg();
            if (egg) {
                this.ftueService.markDirty();
                return true;
            }
            return false;
        });

        // UI Wiring
        this.hud.onRoomSelected.add((roomId: RoomId) => this.rooms.requestSwitch(roomId));
        this.rooms.onRoomChanged.add((roomId: RoomId) => {
            this.hud.setCurrentRoom(roomId);
            this.inputService.clearState();
            this.ftueService.markDirty();
        });

        // Timed Rewards
        const registry = TimedRewardRegistry.createDefault5m();
        this.timedRewards = new TimedRewardService({
            registry,
            context: {
                getMoney: () => InGameEconomy.instance.getAmount(CurrencyType.MONEY),
                addMoney: (amt) => InGameEconomy.instance.add(CurrencyType.MONEY, amt),
                getGems: () => InGameEconomy.instance.getAmount(CurrencyType.GEMS),
                addGems: (amt) => InGameEconomy.instance.add(CurrencyType.GEMS, amt),
                getHighestEntityLevel: () => {
                    let highest = 1;
                    this.entities.forEach((logic) => {
                        if (logic.data.type === "animal") highest = Math.max(highest, logic.data.level);
                    });
                    return highest;
                },
                spawnEntityAtLevel: (level) => !!this.entities.spawnEgg(undefined, { level }, true)
            },
            visibleWindowSize: 3
        });

        this.hud.setTimeRewards(this.timedRewards);
        this.hud.onSpeedUpRequested = () => {
            this.eggGenerator.activateSpeedUp(100)
        }
        this.ftueService.markDirty();


        DevGuiManager.instance.addButton('spawnHighEntity', () => {
            const p = InGameProgress.instance.getProgression('MAIN');
            //this.entities.spawnAnimal(Math.max(1, p.highestMergeLevel - 2));
            this.entities.spawnEgg(undefined, {
                level: Math.max(1, p.highestMergeLevel - 2)
            }, true);
        })
    }

    private loadSave(): void {
        this.rooms.boot();
        this.ftueService.markDirty();
    }

    private wireEntitySignals(): void {
        this.entities.onEntitySpawned.add((view: any) => {
            this.ftueService.onEntitySpawned(view);
            if (view instanceof MergeEgg) {
                ProgressionStats.instance.recordEggSpawned(1);
            } else if (view instanceof BlockMergeEntity) {
                ProgressionStats.instance.recordAnimalSpawned(1);
            }
        });

        this.entities.onEntityRemoved.add((view: any) => this.ftueService.onEntityRemoved(view));
        this.entities.onEggHatched.add((egg: any, spawned: any) => {
            ProgressionStats.instance.recordEggHatched(1);
            MissionManager.instance.reportEggHatched(1);
            this.ftueService.onEggHatched(egg, spawned);
        });
    }

    private setupInput(): void {
        this.input = new InputManager(
            this.container,
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
        this.shopView = this.hud.shopView;
        this.shopView.setBoardCallback(() => this.entities.size >= InGameProgress.instance.getMaxGridSlots() + 15);
        this.shopView.onBuyConfirmed.add((itemId: string) => {
            const confirmedLevel = ShopManager.instance.tryPurchase(itemId);
            if (confirmedLevel !== null) {
                if (this.entities.spawnEgg(undefined, { level: confirmedLevel }, true)) {
                    this.ftueService.markDirty();
                    this.shopView.refreshStates();
                }
            }
        });
        InGameEconomy.instance.onCurrencyChanged.add(() => this.shopView.refreshStates());
    }

    private decrementPendingCoin(ownerId: string): void {
        this.entities.forEach((logic) => {
            if (logic.data.id === ownerId) {
                logic.data.pendingCoins = Math.max(0, logic.data.pendingCoins - 1);
            }
        });
    }

    public update(delta: number): void {
        const dtSeconds = delta;

        ProgressionStats.instance.recordPlaySeconds(dtSeconds);
        ProgressionStats.instance.update(dtSeconds);
        this.inputService.update(dtSeconds);
        this.zoomService.update(dtSeconds);

        if (!this.ftueService.ftueEnabled) {
            MissionManager.instance.update(dtSeconds);
            this.timedRewards.update(dtSeconds);
        }

        this.hud.setFtueState(this.ftueService.isCompleted);
        const inFocus = !this.hud.isAnyUiOpen;
        this.ftueService.setFocus(inFocus);

        if (inFocus) {
            const maxEntities = InGameProgress.instance.getMaxGridSlots();
            const isFull = this.entities.size >= maxEntities;

            if (!isFull && this.ftueService.isCompleted) {
                this.eggGenerator.update(dtSeconds);
                this.hud.updateProgress(this.eggGenerator.ratio);
            } else {
                this.hud.updateProgress(1);
            }

            this.hud.updateEntityCount(this.entities.size, maxEntities);
            this.hud.setGeneratorFullState(isFull);
        }

        this.gridView.update(dtSeconds, this.walkBounds);

        // Coin Generation Logic
        this.entities.forEach((logic, view) => {
            if (!logic.generator || logic.data.type !== "animal") return;
            if (logic.data.pendingCoins >= this.MAX_COINS_PER_ENTITY) return;

            if (logic.generator.update(dtSeconds)) {
                logic.data.pendingCoins++;
                const config = StaticData.getAnimalData(logic.data.level);
                const offset = (view as BaseMergeEntity)?.coinOffset ?? new PIXI.Point();

                this.coins.dropCoin(
                    (view as any).x + offset.x,
                    (view as any).y + offset.y,
                    config.coinValue,
                    logic.data.id,
                    false
                );
            }
        });

        this.ftueService.update(dtSeconds);
        this.saver.update(dtSeconds);
    }
}