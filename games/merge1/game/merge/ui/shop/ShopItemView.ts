import BaseButton from "@core/ui/BaseButton";
import { NumberConverter } from "@core/utils/NumberConverter";
import ViewUtils from "@core/utils/ViewUtils";
import * as PIXI from "pixi.js";
import { Signal } from "signals";
import MergeAssets, { SHOP_STYLE_CONFIG } from "../../MergeAssets";
import { CurrencyType, InGameEconomy } from "../../data/InGameEconomy";
import { IShopItemConfig, ShopManager } from "../../data/ShopManager";
import { TextureBaker } from "../../vfx/TextureBaker";

export default class ShopItemView extends PIXI.Container {
    public readonly onBuyRequested: Signal = new Signal();

    private buyButton: BaseButton;
    private titleText: PIXI.Text;

    // Panel Containers
    private unlockedPanel: PIXI.Container;
    private lockedPanel: PIXI.Container;

    constructor(private config: IShopItemConfig, private style: typeof SHOP_STYLE_CONFIG.Item) {
        super();
        this.setupUI();
        this.updateState();
    }

    private setupUI(): void {
        const s = this.style;
        const maskWidth = SHOP_STYLE_CONFIG.Window.WIDTH - SHOP_STYLE_CONFIG.Window.PADDING.LEFT - SHOP_STYLE_CONFIG.Window.PADDING.RIGHT;

        // 1. Background (Common)
        const bg = new PIXI.NineSlicePlane(PIXI.Texture.from(s.Textures.RowBgActive), 20, 20, 20, 20);
        bg.width = maskWidth;
        bg.height = s.HEIGHT;
        //bg.tint = 0x222222;
        //bg.alpha = 0.8;
        this.addChild(bg);

        // 2. Unlocked Panel (Purchasable state)
        this.unlockedPanel = new PIXI.Container();
        this.addChild(this.unlockedPanel);

        const tex = TextureBaker.getTexture(`${this.config.thumb}`);
        const thumb = new PIXI.Sprite(tex);
        const ratio = ViewUtils.elementScaler(thumb, s.HEIGHT * 0.8); // Scale to 80% of row height
        thumb.scale.set(ratio);
        // FIX: Centered vertically and offset from the left edge
        thumb.anchor.set(0.5);
        thumb.position.set(s.HEIGHT / 2 + 10, s.HEIGHT / 2);
        this.unlockedPanel.addChild(thumb);

        this.titleText = new PIXI.Text(`${MergeAssets.Labels.EntityCardPrefix} ${this.config.level}`, { ...MergeAssets.MainFont, fontSize: 22, fill: 0xffffff });
        this.titleText.position.set(s.TEXT_OFFSET_X, s.HEIGHT * 0.25);
        this.unlockedPanel.addChild(this.titleText);

        this.buyButton = new BaseButton({
            standard: { width: s.BUTTON_WIDTH, height: s.BUTTON_HEIGHT, texture: PIXI.Texture.from(s.Textures.BuyBtn), fontStyle: new PIXI.TextStyle({ ...MergeAssets.MainFont, fontSize: 24 }) },
            disabled: { texture: PIXI.Texture.from(s.Textures.BuyDisabled) },
            click: { callback: () => this.onBuyRequested.dispatch(this.config.id) }
        });
        this.buyButton.position.set(maskWidth - s.BUTTON_WIDTH - 20, (s.HEIGHT - s.BUTTON_HEIGHT) / 2);
        this.unlockedPanel.addChild(this.buyButton);

        // 3. Locked Panel (Requirement state)
        this.setupLockedPanel(maskWidth);
    }

    private setupLockedPanel(width: number): void {
        const s = this.style;
        this.lockedPanel = new PIXI.Container();

        // FIX: Overlay as NineSlice
        const lockBg = new PIXI.NineSlicePlane(PIXI.Texture.from(s.Textures.RowBg), 20, 20, 20, 20);
        lockBg.width = width;
        lockBg.height = s.HEIGHT;
        //lockBg.tint = 0x000000;
        lockBg.alpha = 0.85;

        const lockIcon = PIXI.Sprite.from(s.Textures.LockIcon);
        lockIcon.anchor.set(0.5);
        lockIcon.position.set(width / 2, s.HEIGHT / 2 - 15);

        const lockText = new PIXI.Text(`UNLOCK AT LV. ${this.config.unlockAtLevel}`, { ...MergeAssets.MainFont, fontSize: 18, fill: 0xcccccc });
        lockText.anchor.set(0.5);
        lockText.position.set(width / 2, s.HEIGHT / 2 + 25);

        this.lockedPanel.addChild(lockBg, lockIcon, lockText);
        this.addChild(this.lockedPanel);
    }

    public updateState(isBoardFull: boolean = false): void {
        const unlocked = ShopManager.instance.isUnlocked(this.config.id);
        const price = ShopManager.instance.getPrice(this.config.id);
        const canAfford = InGameEconomy.instance.getAmount(CurrencyType.MONEY) >= price;

        // Toggle Panels
        this.lockedPanel.visible = !unlocked;
        this.unlockedPanel.visible = unlocked;

        if (unlocked) {
            // Manage button interaction state
            (!canAfford || isBoardFull) ? this.buyButton.disable() : this.buyButton.enable();
            this.buyButton.setLabel(NumberConverter.format(price));
        }
    }
}