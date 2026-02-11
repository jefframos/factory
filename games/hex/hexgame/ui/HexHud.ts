import { Game } from "@core/Game";
import BaseButton from "@core/ui/BaseButton";
import SoundToggleButton from "@core/ui/SoundToggleButton";
import * as PIXI from "pixi.js";
import { Signal } from "signals";
import { AvatarManager } from "../avatar/AvatarManager";
import { AvatarRegistry } from "../avatar/AvatarRegistry";
import HexAssets from "../HexAssets";
import { ItemBeltButton } from "./ItemBeltButton";
import { PanelManager } from "./panel/PanelManager";
import { ShopPanel } from "./panel/ShopPanel";
import { TopBar } from "./TopBar"; // Your new component

export enum HUDMode {
    WORLDMAP = "worldmap",
    GAMEPLAY = "gameplay"
}

export class HexHUD extends PIXI.Container {
    // Signals
    public readonly onClose: Signal = new Signal();
    public readonly onSettings: Signal = new Signal();
    public readonly onHint: Signal = new Signal();
    public readonly onErase: Signal = new Signal();
    public readonly onToggleSound: Signal = new Signal();

    // World Map Signals
    public readonly onCenterMap: Signal = new Signal();
    public readonly onRankings: Signal = new Signal();
    public readonly onFriends: Signal = new Signal();
    public readonly onShop: Signal = new Signal();

    // UI Groups
    private readonly gameplayLayer: PIXI.Container = new PIXI.Container();
    private readonly worldLayer: PIXI.Container = new PIXI.Container();

    // Components
    private topBar!: TopBar; // The new shared UI
    private soundBtn!: SoundToggleButton;
    private itemBelt!: PIXI.Container;
    private worldSideBelt!: PIXI.Container;
    private centerMapBtn!: BaseButton;

    private currentMode: HUDMode = HUDMode.WORLDMAP;

    constructor(starSignal: Signal, gemSignal: Signal) {
        super();

        // 1. Build the shared TopBar first so it's behind/above layers as needed
        this.topBar = new TopBar(
            starSignal,
            gemSignal,
            () => this.onSettings.dispatch()
        );
        this.addChild(this.topBar);

        // 2. Add the mode-specific layers
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
            PanelManager.instance.openPanel("shop", ShopPanel);
        });

        const current = AvatarManager.instance.currentAvatar;
        this.topBar.updateAvatar(PIXI.Texture.from(current.texture));
    }

    private buildGameplayUI(): void {
        // Sound Button stays in Gameplay Layer
        this.soundBtn = new SoundToggleButton(
            HexAssets.Textures.Icons.SoundOn,
            HexAssets.Textures.Icons.SoundOff
        );
        this.gameplayLayer.addChild(this.soundBtn);

        this.itemBelt = new PIXI.Container();
        const beltConfig = [
            { icon: HexAssets.Textures.Icons.Close, signal: this.onClose, isTool: false, blockAds: true },
            { icon: HexAssets.Textures.Icons.Close, signal: this.onErase, isTool: false, blockAds: true },
            { icon: HexAssets.Textures.Icons.Hint, signal: this.onHint, isTool: true, qty: 3 },
        ];

        beltConfig.forEach((cfg, i) => {
            const btn = new ItemBeltButton({
                icon: cfg.icon,
                amount: cfg.qty || 0,
                isLocked: false,
                blockAds: cfg.blockAds || false,
                onUse: () => cfg.signal.dispatch(),
                onWatchAd: () => { }
            });
            if (!cfg.isTool) btn.refreshAmount(-1);
            btn.x = i * 110;
            this.itemBelt.addChild(btn);
        });
        this.gameplayLayer.addChild(this.itemBelt);
    }

    private buildWorldUI(): void {
        // StarBox and Settings are now inside TopBar, so we don't build them here.

        this.worldSideBelt = new PIXI.Container();
        const sideConfig = [
            { icon: HexAssets.Textures.Icons.Shop, signal: this.onRankings },
            { icon: HexAssets.Textures.Icons.Shop, signal: this.onFriends },
            { icon: HexAssets.Textures.Icons.Shop, signal: this.onShop },
        ];

        sideConfig.forEach((cfg, i) => {
            const btn = new BaseButton({
                standard: { width: 80, height: 80, iconTexture: PIXI.Texture.from(cfg.icon) },
                click: { callback: () => cfg.signal.dispatch() }
            });
            btn.y = i * 90;
            this.worldSideBelt.addChild(btn);
        });
        this.worldLayer.addChild(this.worldSideBelt);

        this.centerMapBtn = new BaseButton({
            standard: {
                width: 70, height: 70,
                iconTexture: PIXI.Texture.from(HexAssets.Textures.Icons.Shop)
            },
            click: { callback: () => this.onCenterMap.dispatch() }
        });
        this.worldLayer.addChild(this.centerMapBtn);
    }

    public setMode(mode: HUDMode): void {
        this.currentMode = mode;
        this.gameplayLayer.visible = (mode === HUDMode.GAMEPLAY);
        this.worldLayer.visible = (mode === HUDMode.WORLDMAP);
        this.topBar.visible = (mode === HUDMode.WORLDMAP);

        // The TopBar logic can change based on mode if you want 
        // (e.g., hide gems in gameplay), but usually it stays visible.
        this.layout();
    }

    public layout(): void {
        const padding = 20;
        const topY = Game.overlayScreenData.topLeft.y;
        const bottomY = Game.overlayScreenData.bottomLeft.y;
        const rightX = Game.overlayScreenData.topRight.x;

        // 1. Shared Layout: TopBar
        this.topBar.y = topY;
        this.topBar.layout(Game.overlayScreenData.width);
        this.topBar.pivot.x = Game.overlayScreenData.width / 2
        this.topBar.x = Game.DESIGN_WIDTH / 2

        // 2. Mode Specific Layout
        if (this.currentMode === HUDMode.GAMEPLAY) {
            // Sound Button: Positioned below the TopBar or in a custom spot
            // Adjusting it to sit just below the TopBar background (90px)
            this.soundBtn.position.set(Game.DESIGN_WIDTH - this.soundBtn.width / 2 - padding, topY + this.soundBtn.width / 2);

            this.itemBelt.x = (Game.DESIGN_WIDTH - this.itemBelt.width) / 2;
            this.itemBelt.y = bottomY - 110;
        } else {
            this.worldSideBelt.x = rightX - this.worldSideBelt.width - padding;
            this.worldSideBelt.y = (Game.DESIGN_HEIGHT - this.worldSideBelt.height) / 2;

            this.centerMapBtn.x = rightX - this.centerMapBtn.width - padding;
            this.centerMapBtn.y = bottomY - this.centerMapBtn.height - padding;
        }
    }

    // Helper to update player stats from outside
    public updatePlayer(level: number, progress: number): void {
        this.topBar.updateLevel(level, progress);
    }
}