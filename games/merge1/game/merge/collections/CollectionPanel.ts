import Pool from "@core/Pool";
import BaseButton from "@core/ui/BaseButton";
import ViewUtils from "@core/utils/ViewUtils";
import gsap from "gsap";
import * as PIXI from "pixi.js";
import { Signal } from "signals";
import { StaticData } from "../data/StaticData";
import MergeAssets from "../MergeAssets";
import { CollectionDataManager } from "./CollectionDataManager";
import { PortraitItem } from "./PortraitItem";

/** Specific configuration for the Collection UI */
const COLLECTION_STYLE = {
    Window: {
        WIDTH: 700,
        HEIGHT: 850,
        CORNER_SIZE: 35,
        PADDING: { LEFT: 40, RIGHT: 40, TOP: 120, BOTTOM: 120 },
        Textures: {
            Background: MergeAssets.Textures.UI.CollectionPanel,
            CloseBtn: MergeAssets.Textures.Buttons.Red,
            CloseIcon: MergeAssets.Textures.Icons.Back,
            NavBtn: MergeAssets.Textures.Buttons.Blue,
            NavDisabled: MergeAssets.Textures.Buttons.Grey
        }
    },
    Grid: {
        maxRows: 3,
        spacing: 10,
        portraitWidth: 209,
        portraitHeight: 200
    }
};

export class CollectionPanel extends PIXI.Container {

    private items: PortraitItem[] = [];
    private isBuilt: boolean = false;

    // UI Components
    private windowContainer: PIXI.Container = new PIXI.Container();
    private contentScroll: PIXI.Container = new PIXI.Container();
    private scrollMask: PIXI.Graphics;
    private btnLeft: BaseButton;
    private btnRight: BaseButton;
    private blocker: PIXI.Graphics;
    private flag!: PIXI.NineSlicePlane;

    // Scrolling State (X-axis)
    private scrollX: number = 0;
    private maxScroll: number = 0;
    private isDragging: boolean = false;
    private startX: number = 0;
    private startScrollX: number = 0;

    // Signals
    public readonly onHidden: Signal = new Signal();
    public readonly onShown: Signal = new Signal();
    public readonly onClaim: Signal = new Signal();

    constructor() {
        super();
        this.visible = false;
    }

    private build(): void {
        if (this.isBuilt) return;
        this.isBuilt = true;

        const cfg = COLLECTION_STYLE.Window;

        // 1. Overlay Blocker
        this.blocker = new PIXI.Graphics().beginFill(MergeAssets.Textures.UI.BlockerColor, 0.8).drawRect(-2000, -2000, 4000, 4000).endFill();
        this.blocker.interactive = true;
        this.addChild(this.blocker);

        // 2. Window Container
        this.addChild(this.windowContainer);

        const bg = new PIXI.NineSlicePlane(
            PIXI.Texture.from(cfg.Textures.Background),
            cfg.CORNER_SIZE, cfg.CORNER_SIZE * 2, cfg.CORNER_SIZE, cfg.CORNER_SIZE
        );
        bg.width = cfg.WIDTH;
        bg.height = cfg.HEIGHT;
        this.windowContainer.addChild(bg);
        this.windowContainer.pivot.set(cfg.WIDTH / 2, cfg.HEIGHT / 2);

        // 3. Scroll Area Setup (Horizontal)
        const maskWidth = cfg.WIDTH - (cfg.PADDING.LEFT + cfg.PADDING.RIGHT);
        const maskHeight = COLLECTION_STYLE.Grid.maxRows * (COLLECTION_STYLE.Grid.portraitHeight + COLLECTION_STYLE.Grid.spacing);

        this.scrollMask = new PIXI.Graphics()
            .beginFill(0xffffff)
            .drawRect(cfg.PADDING.LEFT, cfg.PADDING.TOP, maskWidth, maskHeight)
            .endFill();

        this.contentScroll.x = cfg.PADDING.LEFT;
        this.contentScroll.y = cfg.PADDING.TOP;
        this.contentScroll.mask = this.scrollMask;
        this.windowContainer.addChild(this.contentScroll, this.scrollMask);

        // 4. Ribbon Title
        this.flag = new PIXI.NineSlicePlane(PIXI.Texture.from(MergeAssets.Textures.UI.CollectionRibbon), 150, 20, 150, 20);
        this.flag.width = 550;
        this.flag.pivot.set(this.flag.width / 2, 0);
        this.flag.x = cfg.WIDTH / 2;
        this.flag.y = -60;
        this.windowContainer.addChild(this.flag);

        const title = new PIXI.Text("CAT COLLECTION", {
            ...MergeAssets.MainFontTitle,
            fontSize: 36,
            align: "center",
            fill: 0xffffff,
            wordWrap: true,
            wordWrapWidth: 300
        });
        title.anchor.set(0.5, 0.5);
        title.position.set(this.flag.width / 2, this.flag.height / 2 - 8); // Offset within the ribbon
        this.flag.addChild(title);

        this.setupNavButtons();
        this.setupCloseButton();
        this.setupDragLogic();
    }

    private createGrid(): void {
        const { maxRows, spacing, portraitWidth, portraitHeight } = COLLECTION_STYLE.Grid;

        for (let i = 0; i < StaticData.entityCount; i++) {
            const level = i + 1;

            // Using the Pool system
            const item = Pool.instance.getElement(PortraitItem);
            item.init(level, (lvl) => this.handleClaim(lvl));

            const scale = ViewUtils.elementScaler(item, portraitWidth, portraitHeight);
            item.scale.set(scale);

            // Horizontal Logic: Fill rows first, then move right
            const row = i % maxRows;
            const col = Math.floor(i / maxRows);

            item.x = (portraitWidth / 2) + col * (portraitWidth + spacing);
            item.y = (portraitHeight / 2) + row * (portraitHeight + spacing);

            this.contentScroll.addChild(item);
            this.items.push(item);
        }

        const totalCols = Math.ceil(StaticData.entityCount / maxRows);
        const contentWidth = totalCols * (portraitWidth + spacing);
        const maskWidth = COLLECTION_STYLE.Window.WIDTH - (COLLECTION_STYLE.Window.PADDING.LEFT + COLLECTION_STYLE.Window.PADDING.RIGHT);

        this.maxScroll = Math.max(0, contentWidth - maskWidth);
    }
    private get columnStepWidth(): number {
        const { portraitWidth, spacing } = COLLECTION_STYLE.Grid;
        return portraitWidth + spacing;
    }
    private setupNavButtons(): void {
        const cfg = COLLECTION_STYLE.Window;
        const centerY = cfg.HEIGHT - 50;
        const centerX = cfg.WIDTH / 2;

        const columnsToMove = 3;
        const scrollDistance = this.columnStepWidth * columnsToMove;

        this.btnLeft = new BaseButton({
            standard: {
                width: 60, height: 60,
                texture: PIXI.Texture.from(cfg.Textures.NavBtn),
                iconTexture: PIXI.Texture.from(MergeAssets.Textures.Icons.ArrowLeft),
                centerIconHorizontally: true, centerIconVertically: true,
                iconSize: { height: 40, width: 40 }
            },
            disabled: { texture: PIXI.Texture.from(cfg.Textures.NavDisabled) },
            down: {
                callback: () => {
                    MergeAssets.tryToPlaySound(MergeAssets.Sounds.UI.Drop)
                }

            },
            click: { callback: () => this.stepScroll(scrollDistance) }
        });

        this.btnRight = new BaseButton({
            standard: {
                width: 60, height: 60,
                texture: PIXI.Texture.from(cfg.Textures.NavBtn),
                iconTexture: PIXI.Texture.from(MergeAssets.Textures.Icons.ArrowRight),
                centerIconHorizontally: true, centerIconVertically: true,
                iconSize: { height: 40, width: 40 }
            },
            disabled: { texture: PIXI.Texture.from(cfg.Textures.NavDisabled) },
            down: {
                callback: () => {
                    MergeAssets.tryToPlaySound(MergeAssets.Sounds.UI.Drop)
                }

            },
            click: { callback: () => this.stepScroll(-scrollDistance) }
        });

        this.btnLeft.pivot.set(30);
        this.btnRight.pivot.set(30);
        this.btnLeft.position.set(centerX - 60, centerY);
        this.btnRight.position.set(centerX + 60, centerY);

        this.windowContainer.addChild(this.btnLeft, this.btnRight);
    }

    private setupCloseButton(): void {
        const cfg = COLLECTION_STYLE.Window;
        const closeBtn = new BaseButton({
            standard: {
                width: 60, height: 60,
                texture: PIXI.Texture.from(cfg.Textures.CloseBtn),
                iconTexture: PIXI.Texture.from(cfg.Textures.CloseIcon),
                centerIconHorizontally: true, centerIconVertically: true,
                iconSize: { height: 35, width: 35 }
            },
            click: { callback: () => this.hide() }
        });
        closeBtn.position.set(cfg.WIDTH - 50, 50);
        closeBtn.pivot.set(30);
        this.windowContainer.addChild(closeBtn);
    }

    private setupDragLogic(): void {
        this.windowContainer.interactive = true;
        this.windowContainer.on("pointerdown", (e: PIXI.FederatedPointerEvent) => {
            gsap.killTweensOf(this);
            this.isDragging = true;
            this.startX = e.global.x;
            this.startScrollX = this.scrollX;
        });

        this.on("globalpointermove", (e: PIXI.FederatedPointerEvent) => {
            if (!this.isDragging) return;
            this.updateScrollPosition(this.startScrollX + (e.global.x - this.startX));
        });

        this.on("pointerup", () => this.isDragging = false);
        this.on("pointerupoutside", () => this.isDragging = false);
    }

    private stepScroll(delta: number): void {
        const target = Math.max(-this.maxScroll, Math.min(0, this.scrollX + delta));
        gsap.to(this, { scrollX: target, duration: 0.4, ease: "power2.out", onUpdate: () => this.updateScrollPosition(this.scrollX) });
    }

    private updateScrollPosition(val: number): void {
        this.scrollX = Math.max(-this.maxScroll, Math.min(0, val));
        this.contentScroll.x = COLLECTION_STYLE.Window.PADDING.LEFT + this.scrollX;

        this.scrollX < 0 ? this.btnLeft.enable() : this.btnLeft.disable();
        this.scrollX > -this.maxScroll ? this.btnRight.enable() : this.btnRight.disable();
    }

    private handleClaim(level: number): void {
        const gems = CollectionDataManager.instance.claim(level);
        if (gems > 0) {
            MergeAssets.tryToPlaySound(MergeAssets.Sounds.UI.Claim)
            // Optimized state update instead of rebuild
            this.items.forEach(i => i.updateState());
            this.onClaim.dispatch(level);
        }
    }

    public show(): void {
        this.build();
        this.createGrid(); // Build items from pool on show
        this.visible = true;

        MergeAssets.tryToPlaySound(MergeAssets.Sounds.UI.OpenPopup)
        this.alpha = 0;
        this.windowContainer.scale.set(0.8);

        this.updateScrollPosition(0);
        this.onShown.dispatch({});

        gsap.to(this, { alpha: 1, duration: 0.2 });
        gsap.to(this.windowContainer.scale, { x: 1, y: 1, duration: 0.3, ease: "back.out(1.7)" });
    }

    public hide(): void {

        MergeAssets.tryToPlaySound(MergeAssets.Sounds.UI.ClosePopup)
        gsap.to(this, {
            alpha: 0,
            duration: 0.2,
            onComplete: () => {
                this.visible = false;

                // Return all items to pool
                this.items.forEach(item => {
                    this.contentScroll.removeChild(item);
                    Pool.instance.returnElement(item);
                });
                this.items = [];

                this.onHidden.dispatch({});
            }
        });
        gsap.to(this.windowContainer.scale, { x: 0.8, y: 0.8, duration: 0.2 });
    }
}