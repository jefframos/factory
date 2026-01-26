// MergeMediator.ts
// Refactored to use services:
// - RoomService handles boot + switching (save/restore/shuffle) via signals
// - MergeInputMergeService handles input + merge + highlight + egg hover hatch
// Keeps:
// - FTUE driver
// - Coin generator loop
// - Shop wiring
// - Save debounce wiring

import * as PIXI from "pixi.js";
import { GridBaker } from "./core/GridBaker";
import { InGameEconomy } from "./data/InGameEconomy";
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
import { MergeInputMergeService } from "./services/MergeInputMergeService";
import { MergeFTUE } from "./ui/ftue/MergeFTUE";
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
    private readonly MERGE_RADIUS_PX: number = 90;

    private autoCollectCoins: boolean = false;

    private readonly ftue: MergeFTUE;
    private ftueEnabled: boolean = true;
    private ftueDirty: boolean = true;
    private lastAllowEgg: boolean = false;
    private lastAllowMerge: boolean = false;

    private shopView!: ShopView;
    private input!: InputManager;

    private readonly rooms: RoomService;
    private readonly inputService: MergeInputMergeService;

    private readonly eggGenerator: EggGenerator;

    public constructor(
        private readonly container: PIXI.Container,
        private readonly inputBounds: PIXI.Rectangle,
        private readonly walkBounds: PIXI.Rectangle,
        private readonly coinEffects: CoinEffectLayer,
        private readonly hud: MergeHUD
    ) {
        ProgressionStats.instance.recordSessionStart();

        MissionManager.instance.initDynamic({
            nextMissionDelaySec: 20, // set to 0 for instant
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

        this.inputService.onDirty.add(() => {
            this.ftueDirty = true;
        });

        // FTUE
        const hintLayer = (this.hud as any).getHintLayer ? (this.hud as any).getHintLayer() : this.hud;
        this.ftue = new MergeFTUE(hintLayer, {
            fingerTexture: PIXI.Texture.from(MergeAssets.Textures.Icons.Finger),
            maxPairDistancePx: 260,
            eggHoverOffsetY: -70,
            completeOnFirstMerge: true
        });

        this.ftue.setFocus(true);
        this.ftue.setAllowedHints(false, false);

        this.wireEntitySignals();

        // Boot room system (restores active room into runtime)
        this.loadSave();

        this.setupInput();
        this.setupShop();

        // Ensure at least one egg for brand-new player
        const p = InGameProgress.instance.getProgression("MAIN");
        if (p.xp <= 0) {
            this.entities.spawnEgg();
        }

        this.eggGenerator = new EggGenerator(() => {
            const egg = this.entities.spawnEgg();
            if (egg) {
                this.ftueDirty = true;
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

            this.ftueDirty = true;
        });

        this.ftueDirty = true;
    }

    // -------------------------
    // Setup
    // -------------------------

    private loadSave(): void {
        this.rooms.boot();
        this.ftueDirty = true;
    }

    private wireEntitySignals(): void {
        this.entities.onEntitySpawned.add((view: any) => {
            this.ftue.onEntitySpawned(view);
            this.ftueDirty = true;

            if (view instanceof MergeEgg) {
                ProgressionStats.instance.recordEggSpawned(1);
                return;
            }

            if (view instanceof BlockMergeEntity) {
                ProgressionStats.instance.recordAnimalSpawned(1);
            }
        });

        this.entities.onEntityRemoved.add((view: any) => {
            this.ftue.onEntityRemoved(view);
            this.ftueDirty = true;
        });

        this.entities.onEggHatched.add((egg: any, spawned: any) => {
            ProgressionStats.instance.recordEggHatched(1);
            MissionManager.instance.reportEggHatched(1);

            this.ftue.onEggHatched(egg, spawned);
            this.ftueDirty = true;
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

            this.ftueDirty = true;
            this.shopView.refreshStates();
        });

        InGameEconomy.instance.onCurrencyChanged.add(() => {
            this.shopView.refreshStates();
        });
    }

    // -------------------------
    // Coins bookkeeping
    // -------------------------

    private decrementPendingCoin(ownerId: string): void {
        this.entities.forEach((logic) => {
            if (logic.data.id === ownerId) {
                logic.data.pendingCoins = Math.max(0, logic.data.pendingCoins - 1);
            }
        });
    }

    // -------------------------
    // FTUE driver (stats-based, gated)
    // -------------------------

    private handleFtueState(): void {
        if (!this.ftueDirty) {
            return;
        }

        const s = ProgressionStats.instance.snapshot;

        if (s.mergesMade >= 2) {
            if (this.ftueEnabled) {
                this.ftueEnabled = false;
                this.ftue.setAllowedHints(false, false);
            }
            this.ftueDirty = false;
            return;
        }

        const eggsExist = this.ftue.getTrackedEggCount ? (this.ftue.getTrackedEggCount() > 0) : true;
        const blocksCount = this.ftue.getTrackedBlockCount ? this.ftue.getTrackedBlockCount() : 0;

        const allowEgg = (s.eggsHatched === 0) && eggsExist;

        const allowMergePrefilter = (s.mergesMade === 0) && (blocksCount >= 2);
        const allowMerge = allowMergePrefilter && !allowEgg;

        if (allowEgg === this.lastAllowEgg && allowMerge === this.lastAllowMerge) {
            this.ftueDirty = false;
            return;
        }

        this.lastAllowEgg = allowEgg;
        this.lastAllowMerge = allowMerge;

        const anyAllowed = allowEgg || allowMerge;

        this.ftueEnabled = anyAllowed;
        this.ftue.setAllowedHints(allowEgg, allowMerge);

        this.ftueDirty = false;
    }

    // -------------------------
    // Update loop
    // -------------------------

    public update(delta: number): void {
        const dtSeconds = delta;

        ProgressionStats.instance.recordPlaySeconds(dtSeconds);
        ProgressionStats.instance.update(dtSeconds);
        MissionManager.instance.update(dtSeconds);

        const inFocus = !this.hud.isAnyUiOpen;

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

        // FTUE
        this.handleFtueState();
        if (this.ftueEnabled && inFocus) {
            this.ftue.update(dtSeconds);
        } else {
            this.ftue.setAllowedHints(false, false);
        }

        // Save debounce
        this.saver.update(dtSeconds);
    }
}
