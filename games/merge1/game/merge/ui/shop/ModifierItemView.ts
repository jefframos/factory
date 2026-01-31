import BaseButton from "@core/ui/BaseButton";
import { NineSliceProgressBar } from "@core/ui/NineSliceProgressBar";
import ViewUtils from "@core/utils/ViewUtils";
import * as PIXI from "pixi.js";
import MergeAssets, { SHOP_STYLE_CONFIG } from "../../MergeAssets";
import { CurrencyType, InGameEconomy } from "../../data/InGameEconomy";
import { ModifierManager, ModifierType } from "../../modifiers/ModifierManager";

export default class ModifierItemView extends PIXI.Container {
    private progressBar: NineSliceProgressBar;
    private valText: PIXI.Text;
    private buyButton: BaseButton;

    private readonly BAR_WIDTH = 220;
    private readonly BAR_HEIGHT = 30;

    constructor(private type: ModifierType) {
        super();
        this.setupUI();
        this.refresh();
    }

    private setupUI(): void {
        const manager = ModifierManager.instance;
        const cfg = manager.getConfig(this.type);
        const s = SHOP_STYLE_CONFIG.Item;
        const winCfg = SHOP_STYLE_CONFIG.Window;
        const width = winCfg.WIDTH - winCfg.PADDING.LEFT - winCfg.PADDING.RIGHT;

        // 1. Row Background
        const bg = new PIXI.NineSlicePlane(
            PIXI.Texture.from(s.Textures.RowBgActive),
            20, 20, 20, 20
        );
        bg.width = width;
        bg.height = s.HEIGHT;
        this.addChild(bg);

        // 2. Icon
        const icon = PIXI.Sprite.from(cfg.icon);
        icon.anchor.set(0.5);
        icon.scale.set(ViewUtils.elementScaler(icon, width, s.HEIGHT * 0.8))
        icon.position.set(s.HEIGHT * 0.5 + 10, s.HEIGHT / 2);
        this.addChild(icon);

        // 3. Labels
        const nameText = new PIXI.Text(cfg.name.toUpperCase(), {
            ...MergeAssets.MainFontTitle,
            fontSize: 20,
            fill: 0xffffff,
        });
        nameText.position.set(icon.x + icon.width / 2 + 20, 12);
        this.valText = new PIXI.Text("", {
            ...MergeAssets.MainFont,
            fontSize: 20,
            fill: 0x00ff00,
            strokeThickness: 2,
            wordWrap: true,
            wordWrapWidth: 250
        });
        this.valText.resolution = 1
        this.valText.position.set(nameText.x, 38);
        this.addChild(nameText, this.valText);

        // 4. Progress Bar Implementation
        this.progressBar = new NineSliceProgressBar({
            width: this.BAR_WIDTH,
            height: this.BAR_HEIGHT,
            bgTexture: PIXI.Texture.from(MergeAssets.Textures.UI.BarBg), // Replace with your actual asset key

            barTexture: PIXI.Texture.from(MergeAssets.Textures.UI.BarFill),  // Replace with your actual asset key

            leftWidth: 8,

            topHeight: 8,

            rightWidth: 8,

            bottomHeight: 8,

            barColor: MergeAssets.Textures.UI.FillColor,  // Default green

            padding: 4
        });

        // Position it relative to the text and container
        this.progressBar.position.set(nameText.x + (this.BAR_WIDTH / 2), s.HEIGHT - this.BAR_HEIGHT / 2 - 15);
        this.addChild(this.progressBar);

        // 5. Upgrade Button
        this.buyButton = new BaseButton({
            standard: {
                width: s.BUTTON_WIDTH,
                height: s.BUTTON_HEIGHT,
                texture: PIXI.Texture.from(s.Textures.BuyBtn),
                fontStyle: new PIXI.TextStyle({ ...MergeAssets.MainFont, fontSize: 20 }),
                iconTexture: PIXI.Texture.from(MergeAssets.Textures.Icons.Gem),
                iconSize: { height: 45, width: 45 },
                centerIconVertically: true,
                textOffset: new PIXI.Point(40, 0),
                iconOffset: new PIXI.Point(20, 0),
            },
            disabled: { texture: PIXI.Texture.from(s.Textures.BuyDisabled) },
            click: { callback: () => this.onUpgradeClicked() }
        });

        this.buyButton.position.set(
            width - s.BUTTON_WIDTH - 15,
            (s.HEIGHT - s.BUTTON_HEIGHT) / 2
        );
        this.addChild(this.buyButton);
    }

    private onUpgradeClicked(): void {
        const success = ModifierManager.instance.tryUpgrade(this.type);
        if (success) {
            MergeAssets.tryToPlaySound(MergeAssets.Sounds.UI.Purchase)
            this.refresh();
        }
    }

    public refresh(): void {
        const manager = ModifierManager.instance;
        const cfg = manager.getConfig(this.type);
        const currentLvl = manager.getLevel(this.type);
        const currentVal = manager.getValue(this.type);
        const price = manager.getUpgradePrice(this.type);

        const gemBalance = InGameEconomy.instance.getAmount(CurrencyType.GEMS);
        const isMax = currentLvl >= cfg.maxLevel;

        // Update Text Logic (e.g., +20% or 1.5x)
        this.valText.text = `${cfg.description}: +${currentVal}${cfg.unit}`;

        // Update Progress Bar (0 to 1)
        const progress = currentLvl / cfg.maxLevel;
        this.progressBar.update(progress);

        // Update Button State
        if (isMax) {
            this.buyButton.setLabel("MAX");
            this.buyButton.disable();
        } else {
            this.buyButton.setLabel(`${price}`);
            gemBalance >= price ? this.buyButton.enable() : this.buyButton.disable();
        }
    }
}