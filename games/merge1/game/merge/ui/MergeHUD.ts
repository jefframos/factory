import { Game } from "@core/Game";
import PlatformHandler from "@core/platforms/PlatformHandler";
import BaseButton from "@core/ui/BaseButton";
import SoundToggleButton from "@core/ui/SoundToggleButton";
import { NumberConverter } from "@core/utils/NumberConverter";
import * as PIXI from "pixi.js";
import { Signal } from "signals";
import MergeAssets from "../MergeAssets";
import { CurrencyType } from "../data/InGameEconomy";
import { InGameProgress } from "../data/InGameProgress";
import { MissionClaimResult } from "../missions/MissionManager";
import { RoomId } from "../rooms/RoomRegistry";
import { ProgressionType } from "../storage/GameStorage";
import { TimedRewardService } from "../timedRewards/TimedRewardService";
import { TimedRewardClaimResult, TimedRewardMilestone } from "../timedRewards/TimedRewardTypes";
import { TimedRewardsBar } from "../timedRewards/ui/TimedRewardsBar ";
import { CoinEffectLayer } from "../vfx/CoinEffectLayer";
import { CurrencyBox } from "./CurrencyBox";
import GeneratorHUD from "./GeneratorHUD";
import { MissionHUD } from "./MissionHUD";
import { ProgressHUD } from "./ProgressHUD";
import { NotificationCenter } from "./notifications/NotificationCenter";
import { NotificationRegistry } from "./notifications/NotificationRegistry";
import { RoomSelector } from "./room/RoomSelector";
import { ShopNotificationIcon } from "./shop/ShopNotificationIcon";
import ShopView from "./shop/ShopView";

export default class MergeHUD extends PIXI.Container {

    private timedRewards!: TimedRewardService;
    private timedRewardsBar!: TimedRewardsBar;

    // --- Layers ---
    private readonly effectsLayer = new PIXI.Container();
    private readonly hudLayer = new PIXI.Container();
    private readonly modalLayer = new PIXI.Container();
    private readonly topLayer = new PIXI.Container();
    private readonly hintLayer = new PIXI.Container();

    private readonly notificationLayer: PIXI.Container = new PIXI.Container();

    public notifications!: NotificationCenter;
    public notificationRegistry!: NotificationRegistry;


    // --- Components ---
    public generator: GeneratorHUD;
    public currencyHUD!: CurrencyBox;
    public currencyHUDGem!: CurrencyBox;
    public progressHUD: ProgressHUD;
    public shopView: ShopView;
    public missionHUD: MissionHUD;
    private roomSelector: RoomSelector;

    private soundToggleButton: SoundToggleButton;
    private shopButton!: BaseButton;
    private entityCountText: PIXI.Text;
    private currencyHUDList: Map<CurrencyType, CurrencyBox> = new Map();

    // --- State & Signals ---
    private uiOpenCount: number = 0;
    private currentRoomId: RoomId = "room_0";
    public onSpeedUpRequested: () => void = () => { };
    public readonly onUiOpen: Signal = new Signal();
    public readonly onUiClose: Signal = new Signal();
    public readonly onFocusChanged: Signal = new Signal();
    public readonly onRoomSelected: Signal = new Signal();

    private shopNotificationIcon: ShopNotificationIcon = new ShopNotificationIcon()

    public get isAnyUiOpen(): boolean { return this.uiOpenCount > 0; }

    constructor() {
        super();
        this.setupLayers();

        // 1. Modals
        this.shopView = new ShopView((() => true));
        this.modalLayer.addChild(this.shopView);
        this.shopView.onShown.add(() => this.notifyUiOpened("shop"), this);
        this.shopView.onHidden.add(() => this.notifyUiClosed("shop"), this);

        // 2. Buttons & HUD Elements
        this.soundToggleButton = new SoundToggleButton(
            MergeAssets.Textures.Icons.SoundOn,
            MergeAssets.Textures.Icons.SoundOff
        );
        this.hudLayer.addChild(this.soundToggleButton);

        this.shopButton = new BaseButton({
            standard: {
                width: 80, height: 80, allPadding: 10,
                texture: PIXI.Texture.from(MergeAssets.Textures.Buttons.Blue),
                iconTexture: PIXI.Texture.from(MergeAssets.Textures.Icons.Shop),
                centerIconHorizontally: true, centerIconVertically: true,
                iconSize: { height: 60, width: 60 },
                fontStyle: new PIXI.TextStyle({ ...MergeAssets.MainFont, fontSize: 20 })
            },
            over: { tint: 0xeeeeee },
            click: { callback: () => this.shopView.show() }
        });
        this.hudLayer.addChild(this.shopButton);

        this.shopButton.addChild(this.shopNotificationIcon)
        this.shopNotificationIcon.x = 10
        this.shopNotificationIcon.y = 10

        // 3. Currency
        this.initCurrency();

        // 4. Progress & Generator
        this.progressHUD = new ProgressHUD();
        this.hudLayer.addChild(this.progressHUD);

        this.generator = new GeneratorHUD();
        this.generator.onSpeedUpRequested = () => this.onSpeedUpRequested();
        this.hudLayer.addChild(this.generator);

        this.entityCountText = new PIXI.Text("0/0", { ...MergeAssets.MainFont, fontSize: 22 });
        this.entityCountText.anchor.set(0.5);
        this.hudLayer.addChild(this.entityCountText);

        this.missionHUD = new MissionHUD(350, 86);
        this.hudLayer.addChild(this.missionHUD);

        this.missionHUD.onClaim.add((claim: MissionClaimResult) => {
            if (claim.rewards && claim.rewards.currencies) {
                for (const currencyType in claim.rewards.currencies) {
                    const amount = claim.rewards.currencies[currencyType as CurrencyType];
                    if (amount) {
                        // Handle currency reward
                        let icon: string = MergeAssets.Textures.Icons.CoinPileSmall
                        if (currencyType == CurrencyType.GEMS) {
                            icon = MergeAssets.Textures.Icons.GemPile
                        }
                        this.notifications.toastPrize({ title: "+" + NumberConverter.format(amount), subtitle: "", iconTexture: icon });


                    }
                }
            }
        })

        // 5. Room Selector Integration
        this.roomSelector = new RoomSelector(["room_0", "room_1"]);
        this.roomSelector.onRoomSelected.add((id: RoomId) => this.onRoomSelected.dispatch(id));
        //this.hudLayer.addChild(this.roomSelector);

        // Debug button
        const t = new BaseButton({
            standard: { width: 50, height: 50, texture: PIXI.Texture.WHITE },
            click: { callback: () => PlatformHandler.instance.platform.gameplayStop() }
        });
        t.alpha = 0;
        this.hudLayer.addChild(t);

        // Initial Sync
        InGameProgress.instance.onProgressChanged.add(this.handleProgressUpdate, this);
        InGameProgress.instance.onLevelUp.add(this.handleLevelUp, this);
        this.refreshRoomButtons();

        this.setUpNotifications();
    }

    private setupLayers(): void {
        this.addChild(this.hudLayer);
        this.addChild(this.effectsLayer);
        this.addChild(this.hintLayer);
        this.addChild(this.modalLayer);
        this.addChild(this.topLayer);

        this.addChild(this.notificationLayer);
    }

    setFtueState(ftueEnabled: boolean) {

        //this.hudLayer.visible = ftueEnabled

        this.missionHUD.visible = ftueEnabled
        this.timedRewardsBar.visible = ftueEnabled
        this.shopButton.visible = ftueEnabled

    }


    private setUpNotifications() {
        // -------------------------
        // Notifications setup
        // -------------------------
        this.notificationRegistry = new NotificationRegistry();


        this.notifications = new NotificationCenter(this.notificationRegistry);
        this.notificationLayer.addChild(this.notifications);
        this.notifications.setStack({
            anchor: "topRight",
            marginX: 18,
            marginY: 140,
            offsetX: 50,
            width: 320,
            height: 85,
            spacing: 10,
            direction: "down"
        });


        this.notifications.onOverlayChanged(Game.gameScreenData);
        // Example skins (swap to your own MergeAssets textures)
        this.notificationRegistry.setSkin("prize_toast", {
            bgTexture: MergeAssets.Textures.UI.NotificationPanel, // replace with your toast bg
            bgNineSlice: { left: 25, top: 25, right: 25, bottom: 25 },
            //shinyTexture: MergeAssets.Textures.UI.Shine, // replace with shiny sprite
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
            bgTexture: MergeAssets.Textures.UI.NotificationPanel, // replace with a big panel bg
            bgNineSlice: { left: 20, top: 20, right: 20, bottom: 20 },
            shinyAlpha: 0.10,
            padding: 18,
            iconSize: 120,
            titleStyle: { ...MergeAssets.MainFont, fontSize: 44 },
            subtitleStyle: { ...MergeAssets.MainFont, fontSize: 28 },
            blackoutAlpha: 0.70
        });

        // setTimeout(() => {

        //     this.notifications.toastPrize({ title: "Level Up!", subtitle: "Level " + 2, iconTexture: MergeAssets.Textures.Icons.BadgeMain });
        // }, 100);

    }

    private initCurrency(): void {
        this.currencyHUD = new CurrencyBox(CurrencyType.MONEY, {
            iconId: MergeAssets.Textures.Icons.Coin, fontName: MergeAssets.MainFont.fontFamily,
            fontSize: 22,
            bgId: MergeAssets.Textures.UI.CurrencyPanel, width: 120
        });
        this.currencyHUDGem = new CurrencyBox(CurrencyType.GEMS, {
            iconId: MergeAssets.Textures.Icons.Gem, fontName: MergeAssets.MainFont.fontFamily,
            fontSize: 22,
            bgId: MergeAssets.Textures.UI.CurrencyPanel, width: 120
        });

        this.currencyHUDList.set(CurrencyType.MONEY, this.currencyHUD);
        this.currencyHUDList.set(CurrencyType.GEMS, this.currencyHUDGem);

        this.hudLayer.addChild(this.currencyHUD, this.currencyHUDGem);
    }

    // --- Public API Methods (Restored) ---
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

    public setTimeRewards(timedRewards: TimedRewardService) {
        this.timedRewards = timedRewards;

        this.timedRewards.onRewardClaimed.add((data: TimedRewardClaimResult, milestone: TimedRewardMilestone) => {
            if (data.moneyAdded) {
                this.notifications.toastPrize({ title: "+" + NumberConverter.format(data.moneyAdded), subtitle: "", iconTexture: milestone.definition.icon });
            }
            if (data.gemsAdded) {
                this.notifications.toastPrize({ title: "+" + NumberConverter.format(data.gemsAdded), subtitle: "", iconTexture: milestone.definition.icon });
            }
            if (data.spawnedEntityLevel) {
                this.notifications.toastPrize({ title: "Surprise Egg!", subtitle: "New Egg Dropped!", iconTexture: milestone.definition.icon });
            }
        })
        this.timedRewardsBar = new TimedRewardsBar(this.timedRewards, {
            width: 400, height: 30,
            barBg: { texture: PIXI.Texture.from(MergeAssets.Textures.UI.BarBg), left: 8, top: 8, right: 8, bottom: 8 },
            barFill: { texture: PIXI.Texture.from(MergeAssets.Textures.UI.BarFill), left: 8, top: 8, right: 8, bottom: 8 },
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
    }
    update(delta: number) {
        this.notifications.update(delta);
    }
    public updateLayout(): void {
        const padding = 20;
        const { topLeft, bottomRight, topRight } = Game.overlayScreenData;

        this.x = topLeft.x;
        this.y = topLeft.y;

        // Sound & Currency
        this.soundToggleButton.position.set(topRight.x - this.x - this.soundToggleButton.width / 2 - padding, padding + this.soundToggleButton.height / 2);
        this.currencyHUD.position.set(20, 20);
        this.currencyHUDGem.position.set(20, 80);

        // Top Center Items
        const centerX = (topRight.x - topLeft.x) / 2;
        this.progressHUD.position.set(centerX, padding * 2);
        if (this.timedRewardsBar) this.timedRewardsBar.position.set(centerX, this.progressHUD.y + 50);

        // Bottom Center (Generator)
        this.generator.position.set(centerX - this.generator.width / 2, bottomRight.y - 80 - this.y);
        this.entityCountText.position.set(this.generator.x + this.generator.width / 2, this.generator.y);

        // --- NEW LAYOUT: Bottom Right Column ---
        this.shopButton.x = topRight.x - this.x - 80 - padding;
        this.shopButton.y = bottomRight.y - this.y - 80 - padding;

        // Room Buttons stacked vertically ABOVE the shop button
        this.roomSelector.x = this.shopButton.x;
        this.roomSelector.y = this.shopButton.y - this.roomSelector.height - 10;

        this.missionHUD.position.set(20, 160);
        this.shopView.position.set(centerX, (bottomRight.y - topRight.y) / 2);

        this.notifications.onOverlayChanged(Game.gameScreenData);

        // this.missionHUD.x = 20
        // this.missionHUD.y = bottomRight.y - this.y - 150

        this.refreshRoomButtons();
    }

    private refreshRoomButtons(): void {
        const mainProg = InGameProgress.instance.getProgression(ProgressionType.MAIN);
        this.roomSelector.refresh(mainProg.level, this.currentRoomId);
        this.progressHUD.updateValues(mainProg.level, mainProg.xp, InGameProgress.instance.getXPRequiredForNextLevel(mainProg.level));
    }

    private handleProgressUpdate(type: string): void {
        if (type === ProgressionType.MAIN) this.refreshRoomButtons();
    }

    private handleLevelUp(type: string, newLevel: number): void {
        if (type === ProgressionType.MAIN) {
            this.progressHUD.playLevelUpEffect(newLevel);
            this.notifications.toastPrize({ title: "Level Up!", subtitle: "Level " + newLevel, iconTexture: MergeAssets.Textures.Icons.BadgeMain });

        }
    }

    private notifyUiOpened(uiId: string): void {
        const wasFocused = this.uiOpenCount === 0;
        this.uiOpenCount++;
        this.onUiOpen.dispatch(uiId);
        if (wasFocused) this.onFocusChanged.dispatch(false);
    }

    private notifyUiClosed(uiId: string): void {
        if (this.uiOpenCount <= 0) return;
        this.uiOpenCount--;
        this.onUiClose.dispatch(uiId);
        if (this.uiOpenCount === 0) this.onFocusChanged.dispatch(true);
    }

    public updateEntityCount(current: number, max: number): void {
        this.entityCountText.text = `${current}/${max}`;
    }

    public setGeneratorFullState(isFull: boolean): void {
        this.generator.setFullState(isFull);
        (this.entityCountText.style as any).fill = isFull ? 0xff4444 : 0xffffff;
    }

    public updateProgress(ratio: number): void {
        this.generator.updateProgress(ratio);
    }

    public getCurrencyTargetGlobalPos(currency: CurrencyType): PIXI.Point {
        return this.currencyHUDList.get(currency)!.getIconGlobalPosition();
    }
}