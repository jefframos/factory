import BaseButton from "@core/ui/BaseButton";
import { gsap } from "gsap";
import * as PIXI from "pixi.js";
import { Signal } from "signals";
import MergeAssets, { SHOP_STYLE_CONFIG } from "../../MergeAssets";
import { SHOP_CONFIG } from "../../data/ShopManager";
import ShopItemView from "./ShopItemView";



export default class ShopView extends PIXI.Container {
    public readonly onBuyConfirmed: Signal = new Signal();
    public readonly onShown: Signal = new Signal();
    public readonly onHidden: Signal = new Signal();

    private blocker: PIXI.Graphics;
    private windowContainer: PIXI.Container;
    private contentScroll: PIXI.Container;
    private scrollMask: PIXI.Graphics;
    private btnUp: BaseButton;
    private btnDown: BaseButton;
    private items: ShopItemView[] = [];

    private scrollY: number = 0;
    private maxScroll: number = 0;
    private isDragging: boolean = false;
    private startY: number = 0;
    private startScrollY: number = 0;




    private readonly CONTENT_TOP = SHOP_STYLE_CONFIG.Window.PADDING.TOP + SHOP_STYLE_CONFIG.Window.TAB_HEIGHT + 20;

    constructor(private isBoardFull: () => boolean) {
        super();
        this.visible = false;
        this.setupModal();
    }

    public setBoardCallback(c: () => boolean) {
        this.isBoardFull = c
    }

    private setupModal(): void {
        const cfg = SHOP_STYLE_CONFIG.Window;

        this.blocker = new PIXI.Graphics().beginFill(0xffffff, 0.8).drawRect(-2000, -2000, 4000, 4000).endFill();
        this.blocker.interactive = true;
        this.addChild(this.blocker);
        this.blocker.tint = 0x333366

        this.windowContainer = new PIXI.Container();
        this.addChild(this.windowContainer);

        // Background
        const bg = new PIXI.NineSlicePlane(PIXI.Texture.from(cfg.Textures.Background), cfg.CORNER_SIZE, cfg.CORNER_SIZE, cfg.CORNER_SIZE, cfg.CORNER_SIZE);
        bg.width = cfg.WIDTH;
        bg.height = cfg.HEIGHT;
        this.windowContainer.addChild(bg);

        this.setupTabs();
        this.setupScrollArea();
        this.setupNavButtons();
        this.setupCloseButton();
        this.setupDragLogic();

        this.windowContainer.pivot.set(cfg.WIDTH / 2, cfg.HEIGHT / 2);
    }

    private setupTabs(): void {
        const cfg = SHOP_STYLE_CONFIG.Window;
        const usableWidth = cfg.WIDTH - cfg.PADDING.LEFT - cfg.PADDING.RIGHT;
        const tabWidth = (usableWidth - 10) / 2;
        const font = new PIXI.TextStyle({ ...MergeAssets.MainFontTitle, fontSize: 24 })

        const tabAnimals = new BaseButton({
            standard: { fontStyle: font, width: tabWidth, height: cfg.TAB_HEIGHT, texture: PIXI.Texture.from(cfg.Textures.TabActive) },
            click: { callback: () => this.showTab("animals") }
        });

        tabAnimals.setLabel(MergeAssets.Labels.EntityShop)
        const tabMods = new BaseButton({
            standard: { fontStyle: font, width: tabWidth, height: cfg.TAB_HEIGHT, texture: PIXI.Texture.from(cfg.Textures.TabActive) },
            click: { callback: () => this.showTab("mods") }
        });
        tabMods.setLabel("MODS")

        tabAnimals.position.set(cfg.PADDING.LEFT, cfg.PADDING.TOP);
        tabMods.position.set(cfg.PADDING.LEFT + tabWidth + 10, cfg.PADDING.TOP);
        //this.windowContainer.addChild(tabAnimals, tabMods);
        this.windowContainer.addChild(tabAnimals);
    }

    private setupScrollArea(): void {
        const cfg = SHOP_STYLE_CONFIG.Window;
        this.contentScroll = new PIXI.Container();
        this.contentScroll.y = this.CONTENT_TOP;

        const maskWidth = cfg.WIDTH - cfg.PADDING.LEFT - cfg.PADDING.RIGHT;
        this.scrollMask = new PIXI.Graphics().beginFill(0xffffff).drawRect(cfg.PADDING.LEFT, this.CONTENT_TOP, maskWidth, cfg.SCROLL_AREA_HEIGHT).endFill();

        this.contentScroll.mask = this.scrollMask;
        this.windowContainer.addChild(this.contentScroll, this.scrollMask);
    }

    private setupNavButtons(): void {
        const cfg = SHOP_STYLE_CONFIG.Window;
        const btnX = cfg.WIDTH - (cfg.PADDING.RIGHT / 2);

        this.btnUp = new BaseButton({
            standard: { width: 60, height: 60, texture: PIXI.Texture.from(cfg.Textures.NavBtn), iconTexture: PIXI.Texture.from('up'), centerIconHorizontally: true, centerIconVertically: true, iconSize: { height: 50, width: 50 } },
            disabled: { texture: PIXI.Texture.from(cfg.Textures.NavDisabled) },
            click: { callback: () => this.stepScroll(SHOP_STYLE_CONFIG.Item.HEIGHT + SHOP_STYLE_CONFIG.Item.SPACING) }
        });

        this.btnDown = new BaseButton({
            standard: { width: 60, height: 60, texture: PIXI.Texture.from(cfg.Textures.NavBtn), iconTexture: PIXI.Texture.from('down'), centerIconHorizontally: true, centerIconVertically: true, iconSize: { height: 50, width: 50 } },
            disabled: { texture: PIXI.Texture.from(cfg.Textures.NavDisabled) },
            click: { callback: () => this.stepScroll(-(SHOP_STYLE_CONFIG.Item.HEIGHT + SHOP_STYLE_CONFIG.Item.SPACING)) }
        });

        this.btnUp.pivot.set(30);
        this.btnDown.pivot.set(30);
        this.btnUp.position.set(btnX, this.CONTENT_TOP + 40);
        this.btnDown.position.set(btnX, this.CONTENT_TOP + cfg.SCROLL_AREA_HEIGHT - 40);

        this.windowContainer.addChild(this.btnUp, this.btnDown);
    }

    private setupCloseButton(): void {
        const cfg = SHOP_STYLE_CONFIG.Window;
        const closeBtn = new BaseButton({
            standard: { width: 80, height: 80, texture: PIXI.Texture.from(cfg.Textures.CloseBtn), iconTexture: PIXI.Texture.from(cfg.Textures.CloseIcon), centerIconHorizontally: true, centerIconVertically: true, iconSize: { height: 50, width: 50 } },
            click: { callback: () => this.hide() }
        });
        closeBtn.position.set(cfg.WIDTH - 20, 20);
        closeBtn.pivot.set(40);
        this.windowContainer.addChild(closeBtn);
    }

    private showTab(type: "animals" | "mods"): void {
        const cfg = SHOP_STYLE_CONFIG.Window;
        const itemCfg = SHOP_STYLE_CONFIG.Item;

        this.contentScroll.removeChildren();
        this.items = [];
        this.updateScrollPosition(0);

        if (type === "animals") {
            SHOP_CONFIG.forEach((config, i) => {
                const item = new ShopItemView(config, itemCfg);
                item.x = cfg.PADDING.LEFT;
                item.y = i * (itemCfg.HEIGHT + itemCfg.SPACING);

                item.onBuyRequested.add((id: string) => {
                    if (this.isDragging) return;
                    this.onBuyConfirmed.dispatch(id);
                });

                this.contentScroll.addChild(item);
                this.items.push(item);
            });
        }

        // Deterministic content height (independent of PIXI bounds timing)
        const count = this.items.length;
        const contentHeight =
            count <= 0
                ? 0
                : (count * itemCfg.HEIGHT) + ((count - 1) * itemCfg.SPACING);

        this.maxScroll = Math.max(0, contentHeight - cfg.SCROLL_AREA_HEIGHT);

        // Reset scroll & refresh button states after maxScroll is valid
        this.updateScrollPosition(0);
        this.refreshStates();
    }


    private stepScroll(delta: number): void {
        const target = Math.max(-this.maxScroll, Math.min(0, this.scrollY + delta));
        gsap.to(this, { scrollY: target, duration: 0.3, ease: "power2.out", onUpdate: () => this.updateScrollPosition(this.scrollY) });
    }

    private updateScrollPosition(val: number): void {
        this.scrollY = Math.max(-this.maxScroll, Math.min(0, val));
        this.contentScroll.y = this.CONTENT_TOP + this.scrollY;
        this.scrollY < 0 ? this.btnUp.enable() : this.btnUp.disable();
        this.scrollY > -this.maxScroll ? this.btnDown.enable() : this.btnDown.disable();
    }

    private setupDragLogic(): void {
        this.interactive = true;
        this.on("pointerdown", (e: PIXI.FederatedPointerEvent) => {
            if (e.target !== this.blocker) {
                gsap.killTweensOf(this);
                this.isDragging = true;
                this.startY = e.global.y;
                this.startScrollY = this.scrollY;
            }
        });
        this.on("globalpointermove", (e: PIXI.FederatedPointerEvent) => {
            if (!this.isDragging) return;
            this.updateScrollPosition(this.startScrollY + (e.global.y - this.startY));
        });
        this.on("pointerup", () => this.isDragging = false);
        this.on("pointerupoutside", () => this.isDragging = false);
    }

    public show(): void {
        if (this.visible) return;

        this.visible = true;
        this.alpha = 0;
        this.windowContainer.scale.set(0.8);
        this.showTab("animals");

        this.onShown.dispatch();

        gsap.to(this, { alpha: 1, duration: 0.2 });
        gsap.to(this.windowContainer.scale, { x: 1, y: 1, duration: 0.3, ease: "back.out(1.7)" });
    }

    public hide(): void {
        if (!this.visible) return;

        gsap.to(this, {
            alpha: 0,
            duration: 0.2,
            onComplete: () => {
                this.visible = false;
                this.onHidden.dispatch();
            }
        });

        gsap.to(this.windowContainer.scale, { x: 0.8, y: 0.8, duration: 0.2 });
    }

    public refreshStates(): void {
        const full = this.isBoardFull();
        this.items.forEach(item => item.updateState(full));
    }
}