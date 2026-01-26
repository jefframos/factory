import { Game } from "@core/Game";
import PlatformHandler from "@core/platforms/PlatformHandler";
import BaseButton from "@core/ui/BaseButton";
import SoundToggleButton from "@core/ui/SoundToggleButton";
import * as PIXI from "pixi.js";
import { Signal } from "signals";
import MergeAssets from "../MergeAssets";
import { CurrencyType } from "../data/InGameEconomy";
import { InGameProgress } from "../data/InGameProgress";
import { RoomId, RoomRegistry } from "../rooms/RoomRegistry";
import { ProgressionType } from "../storage/GameStorage";
import { CoinEffectLayer } from "../vfx/CoinEffectLayer";
import { CurrencyBox } from "./CurrencyBox";
import GeneratorHUD from "./GeneratorHUD";
import { MissionHUD } from "./MissionHUD";
import { ProgressHUD } from "./ProgressHUD";
import ShopView from "./shop/ShopView";

export default class MergeHUD extends PIXI.Container {
    // --- Fixed layering (bottom -> top) ---
    private readonly effectsLayer: PIXI.Container = new PIXI.Container(); // coin VFX, always behind UI
    private readonly hudLayer: PIXI.Container = new PIXI.Container();     // normal HUD (buttons, progress, generator)
    private readonly modalLayer: PIXI.Container = new PIXI.Container();   // shop + future modal UIs
    private readonly topLayer: PIXI.Container = new PIXI.Container();     // currency always on top
    private readonly hintLayer: PIXI.Container = new PIXI.Container();
    private soundToggleButton: SoundToggleButton;

    private entityCountText: PIXI.Text;
    public generator: GeneratorHUD;
    public currencyHUD: CurrencyBox;
    public currencyHUDGem: CurrencyBox;
    public progressHUD: ProgressHUD;
    public shopView: ShopView;

    public onSpeedUpRequested: () => void = () => { };

    public readonly onUiOpen: Signal = new Signal();         // dispatch(uiId: string)
    public readonly onUiClose: Signal = new Signal();        // dispatch(uiId: string)
    public readonly onFocusChanged: Signal = new Signal();   // dispatch(isInFocus: boolean)

    private currencyHUDList: Map<CurrencyType, CurrencyBox> = new Map();

    private uiOpenCount: number = 0;

    private shopButton!: BaseButton;
    public missionHUD: MissionHUD;

    public readonly onRoomSelected: Signal = new Signal(); // dispatch(roomId: RoomId)

    private roomBtn0!: BaseButton;
    private roomBtn1!: BaseButton;

    private currentRoomId: RoomId = "room_0";


    public get isAnyUiOpen(): boolean {
        return this.uiOpenCount > 0;
    }

    public constructor() {
        super();

        this.setupLayers();

        const commonStyle = { ...MergeAssets.MainFont };

        // --- Modal UI(s) first so buttons can reference them safely ---
        this.shopView = new ShopView((() => true));
        this.modalLayer.addChild(this.shopView);

        this.shopView.onShown.add(() => {
            this.notifyUiOpened("shop");
        }, this);

        this.shopView.onHidden.add(() => {
            this.notifyUiClosed("shop");
        }, this);

        // 1) Sound Toggle (HUD layer)
        this.soundToggleButton = new SoundToggleButton(
            MergeAssets.Textures.Icons.SoundOn,
            MergeAssets.Textures.Icons.SoundOff
        );
        this.hudLayer.addChild(this.soundToggleButton);

        // 2) Shop button (HUD layer)
        this.shopButton = new BaseButton({
            standard: {
                width: 80,
                height: 80,
                allPadding: 10,
                texture: PIXI.Texture.from(MergeAssets.Textures.Buttons.Blue),
                iconTexture: PIXI.Texture.from(MergeAssets.Textures.Icons.Shop),
                centerIconHorizontally: true,
                centerIconVertically: true,
                iconSize: { height: 60, width: 60 },
                fontStyle: new PIXI.TextStyle({ ...MergeAssets.MainFont, fontSize: 20 })
            },
            over: { tint: 0xeeeeee },
            click: {
                callback: () => this.shopView.show()
            }
        });
        this.hudLayer.addChild(this.shopButton);

        // 3) Currency (TOP layer, always above modals and effects)
        this.currencyHUD = new CurrencyBox(CurrencyType.MONEY, {
            iconId: MergeAssets.Textures.Icons.Coin,
            fontName: MergeAssets.MainFont.fontFamily,
            bgId: MergeAssets.Textures.UI.CurrencyPanel,
            width: 150
        });
        this.currencyHUD.position.set(20, 20);
        this.topLayer.addChild(this.currencyHUD);

        this.currencyHUDGem = new CurrencyBox(CurrencyType.GEMS, {
            iconId: MergeAssets.Textures.Icons.Gem,
            fontName: MergeAssets.MainFont.fontFamily,
            bgId: MergeAssets.Textures.UI.CurrencyPanel,
            width: 150
        });
        this.currencyHUDGem.position.set(20, 90);
        this.topLayer.addChild(this.currencyHUDGem);

        this.currencyHUDList.set(CurrencyType.MONEY, this.currencyHUD)
        this.currencyHUDList.set(CurrencyType.GEMS, this.currencyHUDGem)

        // 4) Progress HUD (HUD layer)
        this.progressHUD = new ProgressHUD();
        this.hudLayer.addChild(this.progressHUD);
        this.progressHUD.position.set(220, 20);

        InGameProgress.instance.onProgressChanged.add(this.handleProgressUpdate, this);
        InGameProgress.instance.onLevelUp.add(this.handleLevelUp, this);

        const mainProg = InGameProgress.instance.getProgression(ProgressionType.MAIN);
        this.progressHUD.updateValues(
            mainProg.level,
            mainProg.xp,
            InGameProgress.instance.getXPRequiredForNextLevel(mainProg.level)
        );

        // 5) Generator HUD (HUD layer)
        this.generator = new GeneratorHUD();
        this.generator.onSpeedUpRequested = () => this.onSpeedUpRequested();
        this.hudLayer.addChild(this.generator);

        // 6) Entity Counter (HUD layer)
        this.entityCountText = new PIXI.Text("0/0", { ...commonStyle, fontSize: 22 });
        this.entityCountText.anchor.set(0.5);
        this.hudLayer.addChild(this.entityCountText);

        // Debug hidden button (kept from your code)
        const t = new BaseButton({
            standard: { width: 50, height: 50, texture: PIXI.Texture.WHITE },
            click: { callback: () => PlatformHandler.instance.platform.gameplayStop() }
        });
        t.alpha = 0;
        this.hudLayer.addChild(t);

        this.missionHUD = new MissionHUD(420, 86);
        this.hudLayer.addChild(this.missionHUD);


        // --- Room buttons (HUD layer) ---
        this.roomBtn0 = this.createRoomButton("room_0");
        this.roomBtn1 = this.createRoomButton("room_1");

        this.hudLayer.addChild(this.roomBtn0);
        this.hudLayer.addChild(this.roomBtn1);

        // Initial lock state based on current level
        const mainProg2 = InGameProgress.instance.getProgression(ProgressionType.MAIN);
        this.refreshRoomButtons(mainProg2.level);
        this.setCurrentRoom(this.currentRoomId);

    }

    private setupLayers(): void {
        this.addChild(this.hudLayer);
        this.addChild(this.effectsLayer);
        this.addChild(this.hintLayer);   // between HUD and modals
        this.addChild(this.modalLayer);
        this.addChild(this.topLayer);
    }
    public getHintLayer(): PIXI.Container {
        return this.hintLayer;
    }
    /**
     * Effects are always behind modals and the currency.
     * Call this once when you create the CoinEffectLayer.
     */
    public addEffects(effects: CoinEffectLayer): void {
        this.effectsLayer.addChild(effects);
    }

    private notifyUiOpened(uiId: string): void {
        const wasFocused = this.uiOpenCount === 0;
        this.uiOpenCount++;

        this.onUiOpen.dispatch(uiId);

        if (wasFocused && this.uiOpenCount === 1) {
            this.onFocusChanged.dispatch(false);
        }
    }

    private notifyUiClosed(uiId: string): void {
        if (this.uiOpenCount <= 0) {
            return;
        }

        this.uiOpenCount--;
        this.onUiClose.dispatch(uiId);

        if (this.uiOpenCount === 0) {
            this.onFocusChanged.dispatch(true);
        }
    }
    private createRoomButton(roomId: RoomId): BaseButton {
        const def = RoomRegistry.get(roomId);

        const btn = new BaseButton({
            standard: {
                width: 80,
                height: 48,
                allPadding: 8,
                texture: PIXI.Texture.from(MergeAssets.Textures.Buttons.Blue),
                // If you have room icons, use them:
                // iconTexture: def.iconTexture,
                // iconSize: { width: 28, height: 28 },
                // centerIconHorizontally: true,
                // centerIconVertically: true,
                fontStyle: new PIXI.TextStyle({ ...MergeAssets.MainFont, fontSize: 16 })
            },
            over: { tint: 0xeeeeee },
            click: {
                callback: () => {
                    const mainProg = InGameProgress.instance.getProgression(ProgressionType.MAIN);
                    if (!RoomRegistry.isUnlocked(roomId, mainProg.level)) {
                        // Locked: ignore click (you can show a popup later)
                        return;
                    }
                    this.onRoomSelected.dispatch(roomId);
                }
            }
        });

        // Label
        const label = new PIXI.Text(def.name, { ...MergeAssets.MainFont, fontSize: 16 });
        label.anchor.set(0.5);
        label.position.set(btn.width / 2, btn.height / 2);
        btn.addChild(label);

        (btn as any).__roomLabel = label;
        (btn as any).__roomId = roomId;

        return btn;
    }

    public setCurrentRoom(roomId: RoomId): void {
        this.currentRoomId = roomId;

        // Simple highlight: tint active button
        const setActive = (btn: BaseButton, active: boolean) => {
            (btn as any).tint = active ? 0xffffff : 0xdddddd;
            btn.alpha = active ? 1.0 : 0.95;
        };

        setActive(this.roomBtn0, roomId === "room_0");
        setActive(this.roomBtn1, roomId === "room_1");
    }

    private refreshRoomButtons(playerLevel: number): void {
        const applyLockState = (btn: BaseButton) => {
            const roomId = (btn as any).__roomId as RoomId;
            const def = RoomRegistry.get(roomId);
            const unlocked = RoomRegistry.isUnlocked(roomId, playerLevel);

            const label = (btn as any).__roomLabel as PIXI.Text;

            if (!unlocked) {
                btn.alpha = 0.55;
                label.text = `Locked ${def.unlockLevel}`;
            } else {
                btn.alpha = 1.0;
                label.text = def.name;
            }
        };

        applyLockState(this.roomBtn0);
        applyLockState(this.roomBtn1);
    }

    private handleProgressUpdate(type: string, level: number, xp: number, required: number): void {
        if (type === ProgressionType.MAIN) {
            this.progressHUD.updateValues(level, xp, required);
            this.refreshRoomButtons(level);
        }
    }

    private handleLevelUp(type: string, newLevel: number): void {
        if (type === ProgressionType.MAIN) {
            this.progressHUD.playLevelUpEffect(newLevel);
        }
    }

    public setGeneratorFullState(isFull: boolean): void {
        this.generator.setFullState(isFull);

        // Visual polish: Change counter color when full
        // Note: PIXI.TextStyle.fill typing can be strict; keep as number if your typings allow it.
        (this.entityCountText.style as any).fill = isFull ? 0xff4444 : 0xffffff;
    }

    public updateEntityCount(current: number, max: number): void {
        this.entityCountText.text = `${current}/${max}`;
    }

    public updateProgress(ratio: number): void {
        this.generator.updateProgress(ratio);
    }

    public updateLayout(): void {
        const padding = 20;

        const topLeft = Game.overlayScreenData.topLeft;
        const bottomRight = Game.overlayScreenData.bottomRight;
        const topRight = Game.overlayScreenData.topRight;

        this.x = topLeft.x;
        this.y = topLeft.y;

        // Sound (top right)
        this.soundToggleButton.x = topRight.x - this.x - this.soundToggleButton.width / 2 - padding;
        this.soundToggleButton.y = padding + this.soundToggleButton.height / 2;

        // Progress (top center)
        this.progressHUD.x = (topRight.x - topLeft.x) / 2;
        this.progressHUD.y = padding * 2;

        // Generator (bottom center)
        this.generator.x = (topRight.x - topLeft.x) / 2 - this.generator.width / 2;
        this.generator.y = bottomRight.y - 80 - this.y;

        // Entity count sits on generator
        this.entityCountText.position.set(this.generator.x + this.generator.width / 2, this.generator.y);

        // Shop modal centered
        this.shopView.x = (topRight.x - topLeft.x) / 2;
        this.shopView.y = (bottomRight.y - topRight.y) / 2;

        // Shop button under sound toggle
        this.shopButton.x = topRight.x - this.x - this.shopButton.width - padding;
        this.shopButton.y = this.soundToggleButton.y + this.soundToggleButton.height / 2 + 20;

        this.missionHUD.x = 20;
        this.missionHUD.y = 160;

        // Room buttons stacked under Shop
        this.roomBtn0.x = this.shopButton.x;
        this.roomBtn0.y = this.shopButton.y + this.shopButton.height + 14;

        this.roomBtn1.x = this.shopButton.x;
        this.roomBtn1.y = this.roomBtn0.y + this.roomBtn0.height + 10;


    }

    public getCurrencyTargetGlobalPos(currency: CurrencyType): PIXI.Point {
        return this.currencyHUDList.get(currency)!.getIconGlobalPosition();
    }
}
