import { ExtractTiledFile } from "@core/tiled/ExtractTiledFile";
import TiledContainer from "@core/tiled/TiledContainer";
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

// New Grid Imports
import { DevGuiManager } from "../utils/DevGuiManager";
import { EntityGridView2 } from "./grid/EntityGridView2";
import { EntityManagerGrid } from "./grid/EntityManagerGrid";
import { MergeInputMergeGridService } from "./grid/MergeInputMergeGridService";

export type MergeMode = 'Free' | 'Grid';

export class MergeMediator {
    // These act as the "Active" references used by the rest of the class
    private readonly gridView: EntityGridView;
    private readonly entities: EntityManager;
    private readonly inputService: MergeInputMergeService;

    private readonly baker: GridBaker;
    private readonly coins: CoinManager;
    private readonly saver: GameSaveManager;
    private activeEntity: BlockMergeEntity | MergeEgg | null = null;

    private readonly MAX_COINS_PER_ENTITY: number = 3;
    private readonly MERGE_RADIUS_PX: number = 100;

    private autoCollectCoins: boolean = true;
    private shopView!: ShopView;
    private input!: InputManager;

    private readonly rooms: RoomService;
    private readonly zoomService: ZoomService;
    private readonly eggGenerator: EggGenerator;
    private readonly ftueService: MergeFtueService;
    private timedRewards!: TimedRewardService;

    private entityContainer: PIXI.Container = new PIXI.Container()
    private tilesContainer: PIXI.Container = new PIXI.Container()

    public constructor(
        private readonly container: PIXI.Container,
        private readonly inputBounds: PIXI.Rectangle,
        private readonly walkBounds: PIXI.Rectangle,
        private readonly coinEffects: CoinEffectLayer,
        private readonly hud: MergeHUD,
        private readonly mode: MergeMode = 'Grid' // Defaulting to Grid
    ) {
        if (mode == "Grid") {
            this.walkBounds.pad(1500, 1500)
            this.walkBounds.y -= 60
            this.inputBounds.pad(1500, 1500)
        }


        this.container.addChild(this.tilesContainer)
        this.container.addChild(this.entityContainer)
        ProgressionStats.instance.recordSessionStart();


        //console.log(this.walkBounds)

        MissionManager.instance.initDynamic({
            nextMissionDelaySec: 20,
            cadence: [1, 1, 1, 1, 2],
            fallbackTier: 1
        });

        // 1. Initialize the correct Grid View

        if (this.mode === 'Grid') {
            const w = 700
            const h = 700
            let add = 0
            DevGuiManager.instance.addButton('addSlot', () => {
                add++
            })
            this.gridView = new EntityGridView2(
                () => InGameProgress.instance.getMaxGridSlots() + add,
                this.walkBounds,
                new PIXI.Rectangle(-w / 2, -h / 2, w, h),
                this.tilesContainer
            );
        } else {
            this.gridView = new EntityGridView();
        }
        this.entityContainer.addChild(this.gridView);

        // Background setup
        this.setupBackground();

        this.baker = new GridBaker(this.walkBounds, 90);
        this.zoomService = new ZoomService(this.container);

        // 2. Initialize the correct Entity Manager
        if (this.mode === 'Grid') {
            this.entities = new EntityManagerGrid(
                this.gridView,
                this.baker,
                this.walkBounds,
                () => InGameProgress.instance.getMaxGridSlots()
            );
        } else {
            this.entities = new EntityManager(
                this.gridView,
                this.baker,
                this.walkBounds,
                () => InGameProgress.instance.getMaxGridSlots()
            );
        }

        this.coins = new CoinManager(
            this.gridView,
            this.walkBounds,
            this.coinEffects,
            this.hud,
            (ownerId) => this.decrementPendingCoin(ownerId),
            () => this.autoCollectCoins
        );

        // 3. Initialize the correct Input Service
        const serviceDeps = {
            gridView: this.gridView,
            entities: this.entities,
            coins: this.coins,
            isUiBlocked: () => this.hud.isAnyUiOpen,
            mergeRadiusPx: this.MERGE_RADIUS_PX,
            eggHoverRadiusPx: 60,
            instantCollectCoinOnGrab: true
        };

        if (this.mode === 'Grid') {
            this.inputService = new MergeInputMergeGridService(serviceDeps);
        } else {
            this.inputService = new MergeInputMergeService(serviceDeps);
        }

        // Standard logic continues using the 'active' versions
        this.saver = new GameSaveManager(this.entities, this.coins);
        this.rooms = new RoomService({
            saver: this.saver,
            canSwitchNow: () => !this.activeEntity && !this.hud.isAnyUiOpen
        });

        // FTUE
        const hintLayer = (this.hud as any).getHintLayer ? (this.hud as any).getHintLayer() : this.hud;
        this.ftueService = new MergeFtueService({
            parentLayer: hintLayer,
            fingerTexture: PIXI.Texture.from(MergeAssets.Textures.Icons.Finger),
            maxPairDistancePx: 260,
            eggHoverOffsetY: -70
        });

        this.wireSignals();
        this.setupGridSpawning(); // Wraps functions if in Grid mode
        this.loadSave();
        this.setupInput();
        this.setupShop();
        this.setupTimedRewards();

        // Initial Start State
        const snap = ProgressionStats.instance.snapshot;
        if (snap.mergesMade < 2 && this.entities.size < 2) {
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

        this.ftueService.markDirty();

        // setTimeout(() => {
        //     this.updateDebugRect()
        // }, 500);
    }

    public updateDebugRect(): void {
        const gr = new PIXI.Graphics()
        gr.clear();
        gr.beginFill(0xFF0000, 0.25);
        // Note: gridFit is likely in "world" or "parent" space
        gr.drawRect(this.walkBounds.x, this.walkBounds.y, this.walkBounds.width, this.walkBounds.height);
        gr.endFill();

        this.container.addChild(gr)
    }

    private setupBackground(): void {
        if (ExtractTiledFile.TiledData) {
            const tiled = new TiledContainer(ExtractTiledFile.getTiledFrom('garden'), ['Background']);
            [...tiled.children].forEach((child) => {
                if (child instanceof PIXI.Container) {
                    [...child.children].forEach((grandChild) => {
                        const worldPos = grandChild.getGlobalPosition();
                        this.gridView.addChild(grandChild);
                        const localPos = this.gridView.toLocal(worldPos);
                        grandChild.position.set(localPos.x, localPos.y);
                    });
                }
            });
        }
    }

    private setupGridSpawning(): void {
        if (this.mode !== 'Grid') return;

        const gridEnt = this.entities as EntityManagerGrid;

        // // Wrap spawnAnimal
        // const originalSpawnAnimal = gridEnt.spawnAnimal.bind(gridEnt);
        // gridEnt.spawnAnimal = (level: number, pos?: PIXI.Point, data?: any) => {
        //     const animal = originalSpawnAnimal(level, pos, data);
        //     const slot = gridEnt.getFirstEmptyIndex();
        //     if (slot !== -1) gridEnt.assignToTile(animal, slot);
        //     return animal;
        // };

        // Wrap spawnEgg
        // const originalSpawnEgg = gridEnt.spawnEgg.bind(gridEnt);
        // gridEnt.spawnEgg = (data?: any, merge?: any, force?: boolean) => {
        //     const egg = originalSpawnEgg(data, merge, force);
        //     if (egg) {
        //         const slot = gridEnt.getFirstEmptyIndex();
        //         if (slot !== -1) {
        //             gridEnt.assignToTile(egg, slot);
        //         }
        //     }
        //     return egg;
        // };
    }

    private wireSignals(): void {
        this.entities.onDirty.add(() => this.saver.markDirty());
        this.coins.onDirty.add(() => this.saver.markDirty());
        this.inputService.onActiveChanged.add((active: any) => this.activeEntity = active);
        this.inputService.onDirty.add(() => this.ftueService.markDirty());

        this.entities.onEntitySpawned.add((view: any) => {
            this.ftueService.onEntitySpawned(view);
            if (view instanceof MergeEgg) ProgressionStats.instance.recordEggSpawned(1);
            else if (view instanceof BlockMergeEntity) ProgressionStats.instance.recordAnimalSpawned(1);
        });

        this.entities.onEntityRemoved.add((view: any) => this.ftueService.onEntityRemoved(view));
        this.entities.onEggHatched.add((egg: any, spawned: any) => {
            ProgressionStats.instance.recordEggHatched(1);
            MissionManager.instance.reportEggHatched(1);
            this.ftueService.onEggHatched(egg, spawned);
        });

        this.inputService.onMergePerformed.add((resultLevel: number) => {
            if (ProgressionStats.instance.snapshot.mergesMade === 1) {
                this.entities.spawnAnimal(resultLevel);
                this.ftueService.markDirty();
            }
        });

        this.ftueService.onStarted.add(() => this.zoomService.setZoom(1.3, 0.6));
        this.ftueService.onCompleted.add(() => {
            this.zoomService.setZoom(1.0, 0.8)
            this.eggGenerator.progress = EggGenerator.MAX_TIME * 0.85;
        });

        // setTimeout(() => {

        //     this.zoomService.setZoom(0.8, 0.8)
        // }, 10);

        this.hud.onRoomSelected.add((roomId: RoomId) => this.rooms.requestSwitch(roomId));
        this.rooms.onRoomChanged.add((roomId: RoomId) => {
            this.hud.setCurrentRoom(roomId);
            this.inputService.clearState();
            this.ftueService.markDirty();
        });
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
        const maxGridAdd = this.mode === "Free" ? 15 : 0
        this.shopView = this.hud.shopView;
        this.shopView.setBoardCallback(() => this.entities.size >= InGameProgress.instance.getMaxGridSlots() + maxGridAdd);
        this.shopView.onBuyConfirmed.add((itemId: string) => {
            const level = ShopManager.instance.tryPurchase(itemId);
            if (level !== null) {
                if (this.entities.spawnEgg(undefined, { level }, true)) {
                    this.ftueService.markDirty();
                    this.shopView.refreshStates();
                }
            }
        });
        InGameEconomy.instance.onCurrencyChanged.add(() => this.shopView.refreshStates());
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
        this.hud.onSpeedUpRequested = () => this.eggGenerator.activateSpeedUp(100);
    }

    private loadSave(): void {
        this.rooms.boot();
    }

    private decrementPendingCoin(ownerId: string): void {
        this.entities.forEach((logic) => {
            if (logic.data.id === ownerId) {
                logic.data.pendingCoins = Math.max(0, logic.data.pendingCoins - 1);
            }
        });
    }

    public update(delta: number): void {
        ProgressionStats.instance.recordPlaySeconds(delta);
        ProgressionStats.instance.update(delta);
        this.inputService.update(delta);
        this.zoomService.update(delta);
        this.entities.update(delta);



        if (this.mode === 'Grid') {
            this.updateDynamicZoom();
            const view = this.gridView as EntityGridView2;

            this.zoomService.setZoom(view.targetScale);
        }

        if (!this.ftueService.ftueEnabled) {
            MissionManager.instance.update(delta);
            this.timedRewards.update(delta);
        }

        this.hud.setFtueState(this.ftueService.isCompleted);
        const inFocus = !this.hud.isAnyUiOpen;
        this.ftueService.setFocus(inFocus);

        if (inFocus) {
            const max = InGameProgress.instance.getMaxGridSlots();
            const isFull = this.entities.size >= max;

            if (!isFull && this.ftueService.isCompleted) {
                this.eggGenerator.update(delta);
                this.hud.updateProgress(this.eggGenerator.ratio);
            } else {
                this.hud.updateProgress(1);
            }

            this.hud.updateEntityCount(this.entities.size, max);
            this.hud.setGeneratorFullState(isFull);
        }

        this.gridView.update(delta, this.walkBounds);

        // Coin Gen
        this.entities.forEach((logic, view) => {
            if (!logic.generator || logic.data.type !== "animal") return;
            if (logic.data.pendingCoins >= this.MAX_COINS_PER_ENTITY) return;

            if (logic.generator.update(delta)) {

                if (!this.autoCollectCoins) {
                    logic.data.pendingCoins++;
                }
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

        this.ftueService.update(delta);
        this.saver.update(delta);
    }

    private updateDynamicZoom(): void {
        const view = this.gridView as EntityGridView2;
        if (!view.tiles || view.tiles.length === 0) return;

        // 1. Get the current bounds of the tiles
        // We want to know how tall the grid actually is
        let minY = Infinity;
        let maxY = -Infinity;

        view.tiles.forEach(tile => {
            minY = Math.min(minY, tile.y);
            maxY = Math.max(maxY, tile.y);
        });

        const gridHeight = (maxY - minY) + 200; // Total height + some padding

        // 2. Define our "Ideal" height (the height where zoom should be 1.0)
        // You can use inputBounds.height or a fixed value like 800
        const idealHeight = 900;

        // 3. Calculate necessary scale
        let calculatedScale = idealHeight / gridHeight;

        // 4. Clamp the scale
        // Min 0.5 (very zoomed out), Max 1.0 (never zoom in more than original)
        // Based on your requirement: "When I have all pieces, the zoom is 0.8"
        const minZoom = 0.8;
        const maxZoom = 1.0;

        const finalTarget = Math.max(minZoom, Math.min(maxZoom, calculatedScale));

        // 5. Apply to service
        // Use a longer duration (1.5s) so the camera move is smooth as slots unlock
        if (Math.abs(this.zoomService.target - finalTarget) > 0.05) {
            //this.zoomService.setZoom(finalTarget, 1.5);
        }
    }
}