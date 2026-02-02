import { Game } from "@core/Game";
import PlatformHandler from "@core/platforms/PlatformHandler";
import BaseButton from "@core/ui/BaseButton";
import SoundToggleButton from "@core/ui/SoundToggleButton";
import * as PIXI from "pixi.js";
import { Signal } from "signals";
import { DevGuiManager } from "../../../utils/DevGuiManager";
import MergeAssets from "../../MergeAssets";
import { CollectionDataManager } from "../../collections/CollectionDataManager";
import { CollectionPanel } from "../../collections/CollectionPanel";
import { CurrencyType } from "../../data/InGameEconomy";
import { InGameProgress } from "../../data/InGameProgress";
import { ShopManager } from "../../data/ShopManager";
import { StaticData } from "../../data/StaticData";
import { MissionClaimResult } from "../../missions/MissionManager";
import { ModifierManager, ModifierType } from "../../modifiers/ModifierManager";
import { PrizeItem } from "../../prize/PrizeTypes";
import { RoomId } from "../../rooms/RoomRegistry";
import SpinningWheel, { WheelPrize } from "../../spinningWheel/SpinningWheel";
import { ProgressionType } from "../../storage/GameStorage";
import { TimedRewardService } from "../../timedRewards/TimedRewardService";
import { TimedRewardsBar } from "../../timedRewards/ui/TimedRewardsBar ";
import { CoinEffectLayer } from "../../vfx/CoinEffectLayer";
import { NewEntityDiscoveredView } from "../../vfx/NewEntityDiscoveredView";
import { TextureBaker } from "../../vfx/TextureBaker";
import { CurrencyBox } from "../CurrencyBox";
import { NotificationCenter } from "../notifications/NotificationCenter";
import { NotificationRegistry } from "../notifications/NotificationRegistry";
import { RewardManager } from "../prize/RewardManager";
import { RoomSelector } from "../room/RoomSelector";
import { NotificationIcon } from "../shop/NotificationIcon";
import ShopView from "../shop/ShopView";
import GeneratorHUD from "./GeneratorHUD";
import { MissionHUD } from "./MissionHUD";
import { ProgressHUD } from "./ProgressHUD";

type UiId = "shop" | "collection";

export default class MergeHUD extends PIXI.Container {
    // -------------------------
    // Services / external refs
    // -------------------------
    private timedRewards!: TimedRewardService;
    private timedRewardsBar!: TimedRewardsBar;

    // -------------------------
    // Layers
    // -------------------------
    private readonly effectsLayer: PIXI.Container = new PIXI.Container();
    private readonly hudLayer: PIXI.Container = new PIXI.Container();
    private readonly modalLayer: PIXI.Container = new PIXI.Container();
    private readonly topLayer: PIXI.Container = new PIXI.Container();
    private readonly hintLayer: PIXI.Container = new PIXI.Container();
    private readonly notificationLayer: PIXI.Container = new PIXI.Container();

    // -------------------------
    // Notifications
    // -------------------------
    public notifications!: NotificationCenter;
    public notificationRegistry!: NotificationRegistry;

    private readonly shopNotificationIcon: NotificationIcon = new NotificationIcon(
        () => ShopManager.instance.hasAffordableItems(),
        ShopManager.instance.onAvailabilityChanged
    );

    private readonly collectionNotificationIcon: NotificationIcon = new NotificationIcon(
        () => CollectionDataManager.instance.hasUnclaimedRewards(),
        CollectionDataManager.instance.onNotificationChanged
    );

    // -------------------------
    // HUD components
    // -------------------------
    public readonly newDiscovery: NewEntityDiscoveredView = new NewEntityDiscoveredView();
    public readonly generator: GeneratorHUD = new GeneratorHUD();
    public currencyHUD!: CurrencyBox;
    public currencyHUDGem!: CurrencyBox;
    public readonly progressHUD: ProgressHUD = new ProgressHUD();
    public readonly shopView: ShopView = new ShopView((() => true));
    public readonly missionHUD: MissionHUD = new MissionHUD(320, 80);

    private readonly roomSelector: RoomSelector = new RoomSelector(["room_0", "room_1"]);
    private spinningWheel!: SpinningWheel;

    private readonly soundToggleButton: SoundToggleButton = new SoundToggleButton(
        MergeAssets.Textures.Icons.SoundOn,
        MergeAssets.Textures.Icons.SoundOff
    );

    private shopButton!: BaseButton;

    private collectionButton!: BaseButton;
    private collectionPanel!: CollectionPanel;

    private readonly currencyHUDList: Map<CurrencyType, CurrencyBox> = new Map();

    // -------------------------
    // State & Signals
    // -------------------------
    private uiOpenCount: number = 0;
    private currentRoomId: RoomId = "room_0";

    public onSpeedUpRequested: () => void = () => { };

    public readonly onUiOpen: Signal = new Signal();
    public readonly onUiClose: Signal = new Signal();
    public readonly onFocusChanged: Signal = new Signal();
    public readonly onRoomSelected: Signal = new Signal();

    public get isAnyUiOpen(): boolean {
        return this.uiOpenCount > 0;
    }

    public constructor(private readonly coinEffects: CoinEffectLayer) {
        super();

        this.setupLayers();

        this.initShop();
        this.initButtons();
        this.initCurrency();
        this.initProgressAndGenerator();
        this.initMissions();
        this.initCollection();
        this.initNewDiscovery();
        this.initRoomSelector();
        this.initDebugButtons();
        this.initProgressListeners();
        this.initNotifications();
        this.initSpinningWheelDebug();

        this.refreshRoomButtons();
    }

    // =========================================================
    // Setup / init
    // =========================================================

    private setupLayers(): void {
        this.addChild(this.hudLayer);
        this.addChild(this.effectsLayer);
        this.addChild(this.hintLayer);
        this.addChild(this.modalLayer);
        this.addChild(this.topLayer);
        this.addChild(this.notificationLayer);
    }

    private initShop(): void {
        this.modalLayer.addChild(this.shopView);

        this.shopView.onShown.add(() => this.notifyUiOpened("shop"), this);
        this.shopView.onHidden.add(() => this.notifyUiClosed("shop"), this);
    }

    private initButtons(): void {
        this.hudLayer.addChild(this.soundToggleButton);

        this.shopButton = new BaseButton({
            standard: {
                width: 100,
                height: 100,
                allPadding: 10,
                texture: PIXI.Texture.EMPTY,
                iconTexture: PIXI.Texture.from(MergeAssets.Textures.Icons.Shop),
                centerIconHorizontally: true,
                centerIconVertically: true,
                iconSize: { height: 100, width: 100 },
                fontStyle: new PIXI.TextStyle({ ...MergeAssets.MainFont, fontSize: 20 })
            },
            over: { tint: 0xeeeeee },
            click: { callback: () => this.shopView.show() }
        });

        this.hudLayer.addChild(this.shopButton);

        this.shopButton.addChild(this.shopNotificationIcon);
        this.shopNotificationIcon.x = 10;
        this.shopNotificationIcon.y = 10;
    }

    private initCurrency(): void {
        this.currencyHUD = new CurrencyBox(CurrencyType.MONEY, {
            iconId: MergeAssets.Textures.Icons.Coin,
            fontName: MergeAssets.MainFont.fontFamily,
            fontSize: 22,
            bgId: MergeAssets.Textures.UI.CurrencyPanel,
            width: 100
        });

        this.currencyHUDGem = new CurrencyBox(CurrencyType.GEMS, {
            iconId: MergeAssets.Textures.Icons.Gem,
            fontName: MergeAssets.MainFont.fontFamily,
            fontSize: 22,
            bgId: MergeAssets.Textures.UI.CurrencyPanel,
            width: 100
        });

        this.currencyHUDList.set(CurrencyType.MONEY, this.currencyHUD);
        this.currencyHUDList.set(CurrencyType.GEMS, this.currencyHUDGem);

        this.hudLayer.addChild(this.currencyHUD, this.currencyHUDGem);
    }

    private initProgressAndGenerator(): void {
        this.hudLayer.addChild(this.progressHUD);

        this.generator.onSpeedUpRequested = () => this.onSpeedUpRequested();
        this.hudLayer.addChild(this.generator);
    }

    private initMissions(): void {
        this.hudLayer.addChild(this.missionHUD);

        this.missionHUD.onClaim.add((claim: MissionClaimResult) => {
            const prizes = this.mapMissionClaimToPrizes(claim);
            if (prizes.length > 0) {
                RewardManager.instance.showReward(prizes, this.coinEffects, this);
            }
        });

        DevGuiManager.instance.addButton("discoverPopup", () => {
            this.playNewDiscovery(5);
        });

        DevGuiManager.instance.addButton("rewardPopup", () => {
            RewardManager.instance.showReward(
                [
                    { type: CurrencyType.GEMS, value: 5, tier: 1 },
                    { type: CurrencyType.MONEY, value: 250, tier: 1 }
                ],
                this.coinEffects,
                this
            );
        });
    }

    private initCollection(): void {
        this.collectionPanel = new CollectionPanel();
        this.modalLayer.addChild(this.collectionPanel);

        this.collectionPanel.onClaim.add((level: number) => {
            const prizes: PrizeItem[] = [
                { type: CurrencyType.GEMS, value: level, tier: 2 }
            ];

            RewardManager.instance.showReward(prizes, this.coinEffects, this);
        });

        this.collectionPanel.onHidden.add(() => this.notifyUiClosed("collection"));

        this.collectionButton = new BaseButton({
            standard: {
                width: 100,
                height: 100,
                allPadding: 10,
                texture: PIXI.Texture.EMPTY,
                iconTexture: PIXI.Texture.from(MergeAssets.Textures.Icons.CollectionIcon),
                iconSize: { height: 100, width: 100 },
                centerIconHorizontally: true,
                centerIconVertically: true
            },
            click: {
                callback: () => {
                    this.collectionPanel.show();
                    this.notifyUiOpened("collection");
                }
            }
        });

        this.hudLayer.addChild(this.collectionButton);

        this.collectionButton.pivot.set(50);

        this.collectionButton.addChild(this.collectionNotificationIcon);
        this.collectionNotificationIcon.x = 10;
        this.collectionNotificationIcon.y = 10;
    }

    private initNewDiscovery(): void {
        this.hudLayer.addChild(this.newDiscovery);
    }

    private initRoomSelector(): void {
        this.roomSelector.onRoomSelected.add((id: RoomId) => this.onRoomSelected.dispatch(id));
        //this.hudLayer.addChild(this.roomSelector);
    }

    private initDebugButtons(): void {
        const stopBtn = new BaseButton({
            standard: { width: 50, height: 50, texture: PIXI.Texture.WHITE },
            click: { callback: () => PlatformHandler.instance.platform.gameplayStop() }
        });

        stopBtn.alpha = 0;
        this.hudLayer.addChild(stopBtn);
    }

    private initProgressListeners(): void {
        InGameProgress.instance.onProgressChanged.add(this.handleProgressUpdate, this);
        InGameProgress.instance.onLevelUp.add(this.handleLevelUp, this);
    }

    private initNotifications(): void {
        this.notificationRegistry = new NotificationRegistry();
        this.notifications = new NotificationCenter(this.notificationRegistry);

        this.notificationLayer.addChild(this.notifications);

        this.notifications.setStack({
            anchor: "topRight",
            marginX: 18,
            marginY: 200,
            offsetX: 50,
            width: 320,
            height: 85,
            spacing: 10,
            direction: "down"
        });

        this.notifications.onOverlayChanged(Game.gameScreenData);

        this.notificationRegistry.setSkin("prize_toast", {
            bgTexture: MergeAssets.Textures.UI.NotificationPanel,
            bgNineSlice: { left: 25, top: 25, right: 25, bottom: 25 },
            shinyAlpha: 0.12,
            defaultDurationSeconds: 2.4,
            padding: 12,
            iconSize: 64,
            titleStyle: { ...MergeAssets.MainFont, fontSize: 32 },
            subtitleStyle: { ...MergeAssets.MainFont, fontSize: 18 }
        });

        this.notificationRegistry.setSkin("achievement_toast", {
            bgTexture: MergeAssets.Textures.UI.NotificationPanel,
            bgNineSlice: { left: 25, top: 25, right: 25, bottom: 25 },
            shinyAlpha: 0.10,
            defaultDurationSeconds: 3.0,
            padding: 12,
            iconSize: 64,
            titleStyle: { ...MergeAssets.MainFont, fontSize: 24 },
            subtitleStyle: { ...MergeAssets.MainFont, fontSize: 18 }
        });

        this.notificationRegistry.setSkin("shop_item_toast", {
            bgTexture: MergeAssets.Textures.UI.NotificationPanel,
            bgNineSlice: { left: 25, top: 25, right: 25, bottom: 25 },
            defaultDurationSeconds: 3.2,
            padding: 12,
            iconSize: 64,
            titleStyle: { ...MergeAssets.MainFont, fontSize: 24 },
            subtitleStyle: { ...MergeAssets.MainFont, fontSize: 18 }
        });

        this.notificationRegistry.setSkin("levelup_interstitial", {
            bgTexture: MergeAssets.Textures.UI.NotificationPanel,
            bgNineSlice: { left: 20, top: 20, right: 20, bottom: 20 },
            shinyAlpha: 0.10,
            padding: 18,
            iconSize: 120,
            titleStyle: { ...MergeAssets.MainFont, fontSize: 44 },
            subtitleStyle: { ...MergeAssets.MainFont, fontSize: 28 },
            blackoutAlpha: 0.70
        });
    }

    private initSpinningWheelDebug(): void {
        const prizes = [
            { prizeType: CurrencyType.MONEY, amount: 500 },
            { prizeType: CurrencyType.ENTITY, id: "3", level: 3, amount: 1 },
            { prizeType: CurrencyType.ENTITY, id: "1", level: 3, amount: 1 },
            { prizeType: CurrencyType.ENTITY, id: "2", level: 3, amount: 1 },
            { prizeType: CurrencyType.MONEY, amount: 500 },
            { prizeType: CurrencyType.GEMS, amount: 5 },
            { prizeType: CurrencyType.MONEY, amount: 500 }
        ];

        this.spinningWheel = new SpinningWheel(
            prizes,
            [0x117bff, 0x00c1f9],
            (id) => {
                return TextureBaker.getTexture("ENTITY_" + id);
            },
            PIXI.Texture.from("Slider_Basic02_Fill_Green"),
            PIXI.Texture.from("Slider_Basic02_Fill_Green"),
            PIXI.Texture.from("Slider_Handle_Fill_Pink")
        );

        this.addChild(this.spinningWheel);

        this.spinningWheel.x = 500;
        this.spinningWheel.y = 500;
        this.spinningWheel.visible = false;

        DevGuiManager.instance.addButton("spin", () => {
            this.spinningWheel.visible = true;
            this.spinningWheel.spin(0);
        });

        this.spinningWheel.onSpinComplete.add((prize: WheelPrize) => {
            this.spinningWheel.visible = false;

            const prizesToShow = this.mapWheelPrizeToPrizes(prize);
            if (prizesToShow.length > 0) {
                RewardManager.instance.showReward(prizesToShow, this.coinEffects, this);
            }
        });
    }

    // =========================================================
    // Public API
    // =========================================================

    public addEffects(effects: CoinEffectLayer): void {
        this.effectsLayer.addChild(effects);
    }

    public getHintLayer(): PIXI.Container {
        return this.hintLayer;
    }

    public addToHudLayer(child: PIXI.DisplayObject): void {
        this.hudLayer.addChild(child);
    }

    public addToTopLayer(child: PIXI.DisplayObject): void {
        this.topLayer.addChild(child);
    }

    public setCurrentRoom(roomId: RoomId): void {
        this.currentRoomId = roomId;
        this.refreshRoomButtons();
    }

    public setFtueState(ftueEnabled: boolean): void {
        this.missionHUD.visible = ftueEnabled;

        if (this.timedRewardsBar) {
            this.timedRewardsBar.visible = ftueEnabled;
        }

        this.shopButton.visible = ftueEnabled;
        this.collectionButton.visible = ftueEnabled;
        this.generator.visible = ftueEnabled;
    }

    public setTimeRewards(timedRewards: TimedRewardService): void {
        this.timedRewards = timedRewards;

        this.timedRewardsBar = new TimedRewardsBar(this.timedRewards, {
            width: 400,
            height: 30,
            barBg: {
                texture: PIXI.Texture.from(MergeAssets.Textures.UI.BarBg),
                left: 8,
                top: 8,
                right: 8,
                bottom: 8
            },
            barFill: {
                texture: PIXI.Texture.from(MergeAssets.Textures.UI.BarFill),
                left: 8,
                top: 8,
                right: 8,
                bottom: 8
            },
            barFillTint: MergeAssets.Textures.UI.FillColor,
            fontStyleTimer: new PIXI.TextStyle({ ...MergeAssets.MainFont, fontSize: 18 }),
            fontStylePrize: new PIXI.TextStyle({ ...MergeAssets.MainFont, fontSize: 18 }),
            iconMoney: PIXI.Texture.from(MergeAssets.Textures.Icons.Coin),
            iconGems: PIXI.Texture.from(MergeAssets.Textures.Icons.Gem),
            iconFire: PIXI.Texture.from(MergeAssets.Textures.Icons.Gem),
            iconEntity: PIXI.Texture.from(MergeAssets.Textures.Icons.Gem),
            checkIcon: PIXI.Texture.from(MergeAssets.Textures.Icons.Check)
        });

        this.addToHudLayer(this.timedRewardsBar);

        InGameProgress.instance.onMaxEntitiesChanged.add(async (newLevel: number) => {
            this.playNewDiscovery(newLevel);
        });
    }

    public update(delta: number): void {
        this.notifications.update(delta);
        this.newDiscovery.update(delta);
    }

    public playNewDiscovery(newLevel: number): void {
        if (newLevel <= 3) {
            return;
        }

        const { topLeft, bottomRight, topRight } = Game.overlayScreenData;

        const centerX = (topRight.x - topLeft.x) / 2;
        const centerY = (bottomRight.y - topRight.y) / 4 + 50;

        this.newDiscovery.x = centerX;
        this.newDiscovery.y = centerY;

        const data = StaticData.getAnimalData(newLevel);
        this.newDiscovery.playNew(newLevel, data.name, data.colors[0], this.collectionButton);
    }

    public updateLayout(): void {
        const padding = 20;
        const { topLeft, bottomRight, topRight } = Game.overlayScreenData;

        this.x = topLeft.x;
        this.y = topLeft.y;

        // Sound & Currency
        this.soundToggleButton.position.set(
            topRight.x - this.x - this.soundToggleButton.width / 2 - padding,
            padding + this.soundToggleButton.height / 2
        );

        this.currencyHUD.position.set(20, 20);
        this.currencyHUDGem.position.set(160, 20);

        // Top Center Items
        const centerX = (topRight.x - topLeft.x) / 2;

        const targetXProgress = Math.max(
            centerX,
            this.currencyHUDGem.x + this.currencyHUDGem.width + 30 + this.progressHUD.pivot.x
        );

        this.progressHUD.position.set(targetXProgress, padding * 2);

        if (this.timedRewardsBar) {
            this.timedRewardsBar.position.set(centerX, this.progressHUD.y + 50);
        }

        // Bottom Center (Generator)
        this.generator.position.set(
            bottomRight.x - this.generator.width - padding - this.x,
            bottomRight.y - 80 - this.y
        );

        // Right Column
        this.shopButton.x = topRight.x - this.x - 90 - padding;
        this.shopButton.y = topRight.y - this.y + 90 + padding;



        this.missionHUD.position.set(0, bottomRight.y - 120 - this.y);

        this.shopView.position.set(centerX, (bottomRight.y - topRight.y) / 2);

        this.notifications.onOverlayChanged(Game.gameScreenData);

        // Collection under shop
        this.collectionButton.x = this.shopButton.x + this.collectionButton.pivot.x;
        this.collectionButton.y = this.shopButton.y + 100 + this.collectionButton.pivot.y;

        this.roomSelector.x = this.shopButton.x + 50;
        this.roomSelector.y = this.collectionButton.y + 110;

        // Panel center
        this.collectionPanel.position.set(centerX, (bottomRight.y - topRight.y) / 2);

        this.refreshRoomButtons();
    }

    public updateEntityCount(current: number, max: number): void {
        this.generator.setCountLabel(`${current}/${max}`);
    }

    public setGeneratorFullState(isFull: boolean): void {
        this.generator.setFullState(isFull);
    }

    public updateProgress(ratio: number): void {
        this.generator.updateProgress(ratio);
    }

    public getCurrencyTargetGlobalPos(currency: CurrencyType): PIXI.Point {
        if (currency === CurrencyType.ENTITY) {
            return this.collectionButton.getGlobalPosition();
        }

        return this.currencyHUDList.get(currency)!.getIconGlobalPosition();
    }

    // =========================================================
    // Internal helpers
    // =========================================================

    private mapMissionClaimToPrizes(claim: MissionClaimResult): PrizeItem[] {
        const result: PrizeItem[] = [];

        const currencies = claim.rewards?.currencies;
        if (!currencies) {
            return result;
        }

        for (const currencyType in currencies) {
            const amount = currencies[currencyType as CurrencyType];
            if (!amount || amount <= 0) {
                continue;
            }

            const mult = ModifierManager.instance.getNormalizedValue(ModifierType.MissionRewards);
            const value = Math.ceil(amount * mult);

            result.push({
                type: currencyType as CurrencyType,
                value,
                tier: currencyType === CurrencyType.GEMS ? 2 : 0
            });
        }

        return result;
    }

    private mapWheelPrizeToPrizes(prize: WheelPrize): PrizeItem[] {
        // Your current wheel behavior: if it has a level use that, else use amount.
        const value = prize.level || prize.amount;
        if (!value) {
            return [];
        }

        return [
            {
                type: prize.prizeType,
                value,
                tier: prize.prizeType === CurrencyType.GEMS ? 2 : 0
            }
        ];
    }

    private refreshRoomButtons(): void {
        const mainProg = InGameProgress.instance.getProgression(ProgressionType.MAIN);

        this.roomSelector.refresh(mainProg.level, this.currentRoomId);

        this.progressHUD.updateValues(
            mainProg.level,
            mainProg.xp,
            InGameProgress.instance.getXPRequiredForNextLevel(mainProg.level)
        );
    }

    private handleProgressUpdate(type: string): void {
        if (type === ProgressionType.MAIN) {
            this.refreshRoomButtons();
        }
    }

    private handleLevelUp(type: string, newLevel: number): void {
        if (type !== ProgressionType.MAIN) {
            return;
        }

        this.progressHUD.playLevelUpEffect(newLevel);

        this.notifications.toastPrize({
            title: "Level Up!",
            subtitle: "Level " + newLevel,
            iconTexture: MergeAssets.Textures.Icons.BadgeMain
        });
    }

    private notifyUiOpened(uiId: UiId): void {
        const wasFocused = this.uiOpenCount === 0;

        this.uiOpenCount++;
        this.onUiOpen.dispatch(uiId);

        if (wasFocused) {
            this.onFocusChanged.dispatch(false);
        }
    }

    private notifyUiClosed(uiId: UiId): void {
        if (this.uiOpenCount <= 0) {
            return;
        }

        this.uiOpenCount--;
        this.onUiClose.dispatch(uiId);

        if (this.uiOpenCount === 0) {
            this.onFocusChanged.dispatch(true);
        }
    }
}
