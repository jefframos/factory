// MergeMediator.ts
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
import { TimedRewardRegistry } from "./timedRewards/TimedRewardRegistry";
import { TimedRewardService } from "./timedRewards/TimedRewardService";
import { TimedRewardsBar } from "./timedRewards/ui/TimedRewardsBar ";
import MergeHUD from "./ui/MergeHUD";
import ShopView from "./ui/shop/ShopView";
import { CoinEffectLayer } from "./vfx/CoinEffectLayer";

export class MergeMediator {
    private readonly gridView: EntityGridView;
    private readonly baker: GridBaker;

    private readonly entities: EntityManager;
    private readonly coins: CoinManager;
    private readonly saver: GameSaveManager;

    // Used only for gating room switches and UI rules. Owned by inputService.
    private activeEntity: BlockMergeEntity | MergeEgg | null = null;

    private readonly MAX_COINS_PER_ENTITY: number = 3;
    private readonly MERGE_RADIUS_PX: number = 100;

    private autoCollectCoins: boolean = false;

    private shopView!: ShopView;
    private input!: InputManager;

    private readonly rooms: RoomService;
    private readonly inputService: MergeInputMergeService;

    private readonly eggGenerator: EggGenerator;

    private readonly ftueService: MergeFtueService;

    private readonly timedRewards: TimedRewardService;
    private readonly timedRewardsBar: TimedRewardsBar;

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

        this.baker = new GridBaker(this.walkBounds, 90);

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
            canSwitchNow: () => {
                if (this.activeEntity) {
                    return false;
                }
                if (this.hud.isAnyUiOpen) {
                    return false;
                }
                return true;
            }
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

        // Dirty -> save
        this.entities.onDirty.add(() => this.saver.markDirty());
        this.coins.onDirty.add(() => this.saver.markDirty());

        // Service -> mediator state
        this.inputService.onActiveChanged.add((active: any) => {
            this.activeEntity = active;
        });

        // FTUE service
        const hintLayer = (this.hud as any).getHintLayer ? (this.hud as any).getHintLayer() : this.hud;
        this.ftueService = new MergeFtueService({
            parentLayer: hintLayer,
            fingerTexture: PIXI.Texture.from(MergeAssets.Textures.Icons.Finger),
            maxPairDistancePx: 260,
            eggHoverOffsetY: -70,
            completeOnFirstMerge: true
        });

        // Any gameplay interaction that changes entities/highlights should re-evaluate FTUE
        this.inputService.onDirty.add(() => {
            this.ftueService.markDirty();
        });

        this.wireEntitySignals();

        // Boot room system (restores active room into runtime)
        this.loadSave();

        this.setupInput();
        this.setupShop();

        // Ensure at least one egg for brand-new player
        const p = InGameProgress.instance.getProgression("MAIN");
        if (p.xp <= 0) {
            this.entities.spawnEgg();
            this.entities.spawnEgg();
        }

        this.eggGenerator = new EggGenerator(() => {
            const egg = this.entities.spawnEgg();
            if (egg) {
                this.ftueService.markDirty();
                return true;
            }
            return false;
        });

        // Rooms UI wiring
        this.hud.onRoomSelected.add((roomId: RoomId) => {
            this.rooms.requestSwitch(roomId);
        });

        this.rooms.onRoomChanged.add((roomId: RoomId) => {
            this.hud.setCurrentRoom(roomId);

            // Ensure no dangling highlight/drag state after restore
            this.inputService.clearState();

            this.ftueService.markDirty();
        });

        this.ftueService.markDirty();

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
                        if (logic.data.type !== "animal") {
                            return;
                        }
                        highest = Math.max(highest, logic.data.level);
                    });
                    return highest;
                },

                spawnEntityAtLevel: (level) => {
                    // If you later want “direct animal spawn”, replace this call.
                    const egg = this.entities.spawnEgg(undefined, { level }, true);
                    return !!egg;
                }
            },
            visibleWindowSize: 3
        });

        this.hud.setTimeRewards(this.timedRewards)


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
                return;
            }

            if (view instanceof BlockMergeEntity) {
                ProgressionStats.instance.recordAnimalSpawned(1);
            }
        });

        this.entities.onEntityRemoved.add((view: any) => {
            this.ftueService.onEntityRemoved(view);
        });

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
            if (confirmedLevel === null) {
                return;
            }

            const egg = this.entities.spawnEgg(undefined, { level: confirmedLevel });
            if (!egg) {
                return;
            }

            this.ftueService.markDirty();
            this.shopView.refreshStates();
        });

        InGameEconomy.instance.onCurrencyChanged.add(() => {
            this.shopView.refreshStates();
        });
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

        if (!this.ftueService.ftueEnabled) {

            MissionManager.instance.update(dtSeconds);
            this.timedRewards.update(dtSeconds);
        }

        this.hud.setFtueState(this.ftueService.isCompleted)

        const inFocus = !this.hud.isAnyUiOpen;

        // Keep FTUE focus in sync (service handles show/hide)
        this.ftueService.setFocus(inFocus);

        // Generator / HUD
        if (inFocus) {
            const maxEntities = InGameProgress.instance.getMaxGridSlots();
            const isFull = this.entities.size >= maxEntities;

            if (!isFull) {
                this.eggGenerator.update(dtSeconds);
                this.hud.updateProgress(this.eggGenerator.ratio);
            } else {
                this.hud.updateProgress(1);
            }

            this.hud.updateEntityCount(this.entities.size, maxEntities);
            this.hud.setGeneratorFullState(isFull);
        }

        // Gameplay update
        this.gridView.update(dtSeconds, this.walkBounds);

        // Coins from generators
        this.entities.forEach((logic, view) => {
            if (!logic.generator || logic.data.type !== "animal") {
                return;
            }

            if (logic.data.pendingCoins >= this.MAX_COINS_PER_ENTITY) {
                return;
            }

            const willCoin = logic.generator.update(dtSeconds);
            if (willCoin) {
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

        // FTUE (driver + visuals inside the service)
        this.ftueService.update(dtSeconds);

        // Save debounce
        this.saver.update(dtSeconds);
    }
}
