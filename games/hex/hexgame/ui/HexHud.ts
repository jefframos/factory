import { Game } from "@core/Game";
import BaseButton from "@core/ui/BaseButton";
import SoundToggleButton from "@core/ui/SoundToggleButton";
import * as PIXI from "pixi.js";
import { Signal } from "signals";
import { AvatarManager } from "../avatar/AvatarManager";
import { AvatarRegistry } from "../avatar/AvatarRegistry";
import HexAssets from "../HexAssets";
import { ItemBeltButton } from "./ItemBeltButton";
import { AvatarShopPanel } from "./panel/AvatarShopPanel";
import { PanelManager } from "./panel/PanelManager";
import { SettingsPanel } from "./panel/SettingsPanel";
import { TopBar } from "./TopBar";

export enum HUDMode {
    WORLDMAP = "worldmap",
    GAMEPLAY = "gameplay"
}

export class HexHUD extends PIXI.Container {
    public readonly onClose: Signal = new Signal();
    public readonly onSettings: Signal = new Signal();
    public readonly onHint: Signal = new Signal();
    public readonly onErase: Signal = new Signal();
    public readonly onSkip: Signal = new Signal(); // Added missing signal
    public readonly onToggleSound: Signal = new Signal();

    public readonly onCenterMap: Signal = new Signal();
    public readonly onRankings: Signal = new Signal();
    public readonly onFriends: Signal = new Signal();
    public readonly onShop: Signal = new Signal();

    private readonly gameplayLayer: PIXI.Container = new PIXI.Container();
    private readonly worldLayer: PIXI.Container = new PIXI.Container();

    private topBar!: TopBar;
    private soundBtn!: SoundToggleButton;

    // New references for layout
    private gameplayCloseBtn!: ItemBeltButton;
    private gameplayToolsContainer!: PIXI.Container;
    private gameplaySkipBtn!: ItemBeltButton;

    private worldSideBelt!: PIXI.Container;
    private centerMapBtn!: BaseButton;

    private currentMode: HUDMode = HUDMode.WORLDMAP;

    constructor(starSignal: Signal, gemSignal: Signal) {
        super();

        this.topBar = new TopBar(
            starSignal,
            gemSignal,
            () => this.onSettings.dispatch()
        );
        this.addChild(this.topBar);

        this.addChild(this.gameplayLayer);
        this.addChild(this.worldLayer);

        this.buildGameplayUI();
        this.buildWorldUI();

        this.setMode(HUDMode.WORLDMAP);
        this.addChild(PanelManager.instance);

        AvatarManager.instance.onAvatarChanged.add((data: any) => {
            const avatar = AvatarRegistry.getAvatar(data.id);
            this.topBar.updateAvatar(PIXI.Texture.from(avatar.texture));
        });

        this.onShop.add(() => {
            PanelManager.instance.openPanel("shop", AvatarShopPanel);
        });

        this.onSettings.add(() => {
            PanelManager.instance.openPanel("settings", SettingsPanel);
        });

        const current = AvatarManager.instance.currentAvatar;
        this.topBar.updateAvatar(PIXI.Texture.from(current.texture));
    }

    private buildGameplayUI(): void {
        this.soundBtn = new SoundToggleButton(
            HexAssets.Textures.Icons.SoundOn,
            HexAssets.Textures.Icons.SoundOff
        );
        this.gameplayLayer.addChild(this.soundBtn);

        const BUTTON_SPACING = 110;

        // 1. Close Button (Left)
        this.gameplayCloseBtn = new ItemBeltButton({
            icon: 'PictoIcon_Home_1',
            amount: -1,
            isLocked: false,
            blockAds: true,
            onUse: () => this.onClose.dispatch(),
            onWatchAd: () => { }
        });
        this.gameplayLayer.addChild(this.gameplayCloseBtn);

        // 2. Tools Group (Centered)
        this.gameplayToolsContainer = new PIXI.Container();
        const toolsConfig = [
            { icon: 'PictoIcon_Refresh_3', signal: this.onErase, qty: -1, blockAds: true },
            { icon: 'PictoIcon_Bulb', signal: this.onHint, qty: 3, blockAds: true },
        ];

        toolsConfig.forEach((cfg, i) => {
            const btn = new ItemBeltButton({
                icon: cfg.icon,
                amount: cfg.qty,
                isLocked: false,
                blockAds: cfg.blockAds,
                onUse: () => cfg.signal.dispatch(),
                onWatchAd: () => { }
            });
            const totalToolsWidth = (toolsConfig.length - 1) * BUTTON_SPACING;
            btn.x = (i * BUTTON_SPACING) - (totalToolsWidth / 2) - 90 / 2;
            this.gameplayToolsContainer.addChild(btn);
        });
        this.gameplayLayer.addChild(this.gameplayToolsContainer);

        // 3. Skip Button (Right)
        this.gameplaySkipBtn = new ItemBeltButton({
            icon: 'Icon_Skip',
            amount: -1,
            isLocked: false,
            blockAds: true,
            onUse: () => this.onSkip.dispatch(),
            onWatchAd: () => { }
        });
        this.gameplayLayer.addChild(this.gameplaySkipBtn);
    }

    private buildWorldUI(): void {
        this.worldSideBelt = new PIXI.Container();
        const sideConfig = [
            { icon: 'ItemIcon_Medalstand', signal: this.onRankings },
            { icon: 'Icon_MapPoint', signal: this.onFriends },
            { icon: HexAssets.Textures.Icons.CollectionIcon, signal: this.onFriends },
            { icon: HexAssets.Textures.Icons.Shop, signal: this.onShop },
        ];

        sideConfig.forEach((cfg, i) => {
            const btn = new BaseButton({
                standard: { width: 100, height: 100, iconSize: { height: 100, width: 100 }, iconTexture: PIXI.Texture.from(cfg.icon) },
                click: { callback: () => cfg.signal.dispatch() }
            });
            btn.y = i * 120;
            this.worldSideBelt.addChild(btn);
        });
        //this.worldLayer.addChild(this.worldSideBelt);

        this.centerMapBtn = new BaseButton({
            standard: { width: 70, height: 70, iconTexture: PIXI.Texture.from('eye') },
            click: { callback: () => this.onCenterMap.dispatch() }
        });
        this.worldLayer.addChild(this.centerMapBtn);
    }

    public setMode(mode: HUDMode): void {
        this.currentMode = mode;
        this.gameplayLayer.visible = (mode === HUDMode.GAMEPLAY);
        this.worldLayer.visible = (mode === HUDMode.WORLDMAP);
        this.topBar.visible = (mode === HUDMode.WORLDMAP);
        this.layout();
    }

    public layout(): void {
        const padding = 20;
        const topY = Game.overlayScreenData.topLeft.y;
        const bottomY = Game.overlayScreenData.bottomLeft.y;
        const rightX = Game.overlayScreenData.topRight.x;
        const leftX = Game.overlayScreenData.topLeft.x;
        const centerX = Game.DESIGN_WIDTH / 2;

        // TopBar Layout
        this.topBar.y = topY;
        this.topBar.layout(Game.overlayScreenData.width);
        this.topBar.pivot.x = Game.overlayScreenData.width / 2;
        this.topBar.x = centerX;

        if (this.currentMode === HUDMode.GAMEPLAY) {
            // Sound Button
            this.soundBtn.position.set(rightX - this.soundBtn.width / 2 - padding, topY + this.soundBtn.height / 2 + padding);

            // Gameplay Elements Y Position (Bottom alignment)
            const beltY = bottomY - 100; // 60 is roughly half the button height

            // 1. Close Button (Left)
            this.gameplayCloseBtn.x = 40;
            this.gameplayCloseBtn.y = beltY;

            // 2. Tools (Center)
            this.gameplayToolsContainer.x = centerX;
            this.gameplayToolsContainer.y = beltY;
            this.gameplayToolsContainer.pivot.x = 0;
            // 3. Skip Button (Right)
            this.gameplaySkipBtn.x = Game.DESIGN_WIDTH - 60 - 80;
            this.gameplaySkipBtn.y = beltY;

        } else {
            this.worldSideBelt.x = rightX - this.worldSideBelt.width - padding;
            this.worldSideBelt.y = (Game.DESIGN_HEIGHT - this.worldSideBelt.height) / 2;

            this.centerMapBtn.x = rightX - this.centerMapBtn.width - padding;
            this.centerMapBtn.y = bottomY - this.centerMapBtn.height - padding;
        }
    }

    public updatePlayer(level: number, progress: number): void {
        this.topBar.updateLevel(level, progress);
    }
}