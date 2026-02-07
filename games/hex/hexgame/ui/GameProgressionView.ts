import BaseButton from "@core/ui/BaseButton";
import { gsap } from "gsap";
import * as PIXI from "pixi.js";
import HexAssets, { SHOP_STYLE_CONFIG } from "../HexAssets";
import { HexGameMediator } from "../HexGameMediator";
import { Difficulty, LevelData, WorldData } from "../HexTypes";
import { LevelDataManager } from "../LevelDataManager";

export default class GameProgressionView extends PIXI.Container {
    private blocker: PIXI.Graphics;
    private windowContainer: PIXI.Container;
    private contentContainer: PIXI.Container;
    private backBtn: BaseButton;
    private titleText: PIXI.Text;

    private currentView: "worlds" | "levels" = "worlds";

    constructor(private mediator: HexGameMediator) {
        super();
        this.visible = false;
        this.setupUI();
    }

    private setupUI(): void {
        const cfg = SHOP_STYLE_CONFIG.Window;

        // Blocker
        this.blocker = new PIXI.Graphics().beginFill(0x000000, 0.7).drawRect(-2000, -2000, 4000, 4000).endFill();
        this.blocker.interactive = true;
        this.addChild(this.blocker);

        this.windowContainer = new PIXI.Container();
        this.addChild(this.windowContainer);

        // Background (NineSlice)
        const bg = new PIXI.NineSlicePlane(
            PIXI.Texture.from(cfg.Textures.Background),
            cfg.CORNER_SIZE, cfg.CORNER_SIZE, cfg.CORNER_SIZE, cfg.CORNER_SIZE
        );
        bg.width = cfg.WIDTH;
        bg.height = cfg.HEIGHT;
        this.windowContainer.addChild(bg);

        // Title
        this.titleText = new PIXI.Text("LEVEL SELECT", { ...HexAssets.MainFontTitle, fontSize: 40, fill: 0xffffff });
        this.titleText.anchor.set(0.5, 0);
        this.titleText.position.set(cfg.WIDTH / 2, 30);
        this.windowContainer.addChild(this.titleText);

        // Content Area
        this.contentContainer = new PIXI.Container();
        this.contentContainer.position.set(cfg.PADDING.LEFT, 100);
        this.windowContainer.addChild(this.contentContainer);

        this.setupButtons();

        this.windowContainer.pivot.set(cfg.WIDTH / 2, cfg.HEIGHT / 2);
    }

    private setupButtons(): void {
        const cfg = SHOP_STYLE_CONFIG.Window;

        // Back Button
        this.backBtn = new BaseButton({
            standard: { width: 80, height: 80, texture: PIXI.Texture.from(cfg.Textures.NavBtn), iconTexture: PIXI.Texture.from(HexAssets.Textures.Icons.Back), centerIconHorizontally: true, centerIconVertically: true },
            click: { callback: () => this.showWorldList() }
        });
        this.backBtn.position.set(40, 40);
        this.backBtn.pivot.set(40);
        this.windowContainer.addChild(this.backBtn);

        // Close Button
        const closeBtn = new BaseButton({
            standard: { width: 80, height: 80, texture: PIXI.Texture.from(cfg.Textures.CloseBtn), iconTexture: PIXI.Texture.from(cfg.Textures.CloseIcon), centerIconHorizontally: true, centerIconVertically: true },
            click: { callback: () => this.hide() }
        });
        closeBtn.position.set(cfg.WIDTH - 40, 40);
        closeBtn.pivot.set(40);
        //this.windowContainer.addChild(closeBtn);
    }

    public showWorldList(): void {
        this.currentView = "worlds";
        this.backBtn.visible = false;
        this.titleText.text = "WORLDS";
        this.contentContainer.removeChildren();

        const worlds = LevelDataManager.getWorlds();
        worlds.forEach((world, i) => {
            const btn = this.createWorldButton(world);
            btn.y = i * 110; // List layout
            this.contentContainer.addChild(btn);
        });
    }

    private createWorldButton(world: WorldData): BaseButton {
        const btn = new BaseButton({
            standard: {
                width: SHOP_STYLE_CONFIG.Window.WIDTH - 100,
                height: 100,
                texture: PIXI.Texture.from(SHOP_STYLE_CONFIG.Window.Textures.TabActive),
                fontStyle: new PIXI.TextStyle({ ...HexAssets.MainFontTitle, fontSize: 28 })
            },
            click: { callback: () => this.showLevelGrid(world) }
        });
        btn.setLabel(world.name.toUpperCase());
        return btn;
    }

    private showLevelGrid(world: WorldData): void {
        this.currentView = "levels";
        this.backBtn.visible = true;
        this.titleText.text = world.name.toUpperCase();
        this.contentContainer.removeChildren();

        const cols = 4;
        const spacing = 15;
        const btnSize = 100;

        world.levels.forEach((level, i) => {
            const btn = new BaseButton({
                standard: {
                    width: btnSize, height: btnSize,
                    texture: PIXI.Texture.from(SHOP_STYLE_CONFIG.Window.Textures.NavBtn),
                    fontStyle: new PIXI.TextStyle({ ...HexAssets.MainFontTitle, fontSize: 28 })
                },
                click: { callback: () => this.selectLevel(level) }
            });
            btn.setLabel((i + 1).toString());
            btn.x = (i % cols) * (btnSize + spacing);
            btn.y = Math.floor(i / cols) * (btnSize + spacing);
            this.contentContainer.addChild(btn);
        });
    }

    private selectLevel(level: LevelData): void {
        // Tell mediator to start the level
        this.mediator.startLevel(level.matrix, level.difficulty || Difficulty.MEDIUM, level.pieces);
        this.hide();
    }

    public show(): void {
        this.visible = true;
        this.showWorldList();
        this.alpha = 0;
        this.windowContainer.scale.set(0.5);
        gsap.to(this, { alpha: 1, duration: 0.3 });
        gsap.to(this.windowContainer.scale, { x: 1, y: 1, duration: 0.4, ease: "back.out(1.2)" });
    }

    public hide(): void {
        gsap.to(this, {
            alpha: 0, duration: 0.2, onComplete: () => {
                this.visible = false
            }
        });
    }
}