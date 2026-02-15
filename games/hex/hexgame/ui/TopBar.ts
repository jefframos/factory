import BaseButton from "@core/ui/BaseButton";
import * as PIXI from "pixi.js";
import { Signal } from "signals";
import { CurrencyType, EconomyStorage } from "../data/EconomyStorage"; // Import your economy
import HexAssets from "../HexAssets";
import { AvatarUIView } from "./AvatarUIView";
import { StarBox } from "./StarBox";

export class TopBar extends PIXI.Container {
    private background: PIXI.NineSlicePlane;
    private avatarView: AvatarUIView;

    public starBox: StarBox;
    public gemBox: StarBox;
    public settingsBtn: BaseButton;

    constructor(starSignal: Signal, gemSignal: Signal, onSettings: () => void) {
        super();

        // 1. Main Background
        this.background = new PIXI.NineSlicePlane(
            PIXI.Texture.from('ItemFrame01_Single_Navy'),
            30, 30, 30, 30
        );
        this.addChild(this.background);

        // 2. Avatar & Level System
        this.avatarView = new AvatarUIView();
        //this.addChild(this.avatarView);

        // 3. Currencies
        this.starBox = new StarBox({
            iconId: HexAssets.Textures.Icons.Star,
            fontName: HexAssets.MainFont.fontFamily,
            bgId: HexAssets.Textures.UI.BarBg,
            width: 130
        }, starSignal);

        this.gemBox = new StarBox({
            iconId: 'pink',
            fontName: HexAssets.MainFont.fontFamily,
            bgId: HexAssets.Textures.UI.BarBg,
            width: 130
        }, gemSignal);

        this.addChild(this.starBox, this.gemBox);

        // 4. Settings
        this.settingsBtn = new BaseButton({
            standard: {
                width: 55, height: 55,
                iconSize: { width: 55, height: 55 },
                iconTexture: PIXI.Texture.from(HexAssets.Textures.Icons.Settings),
            },
            click: { callback: onSettings }
        });
        this.addChild(this.settingsBtn);

        // --- NEW: Hook into Economy ---
        this.initEconomy();
    }

    private async initEconomy(): Promise<void> {
        // 1. Listen for future changes
        EconomyStorage.onCurrencyChanged.add(this.onCurrencyUpdate, this);

        // 2. Initial value fetch (since storage is async)
        const currentStars = await EconomyStorage.getBalance(CurrencyType.STARS);
        const currentCoins = await EconomyStorage.getBalance(CurrencyType.COINS);

        this.starBox.valueUpdate(currentStars);
        this.gemBox.valueUpdate(currentCoins);
    }

    private onCurrencyUpdate(type: CurrencyType, newValue: number): void {
        if (type === CurrencyType.STARS) {
            this.starBox.valueUpdate(newValue);
        } else if (type === CurrencyType.COINS) {
            // Assuming your gemBox displays the Coin/Pink currency
            this.gemBox.valueUpdate(newValue);
        }
    }

    public updateAvatar(texture: PIXI.Texture): void {
        this.avatarView.updateAvatarTexture(texture);
    }

    public updateLevel(level: number, progress: number): void {
        this.avatarView.update(level, progress);
    }

    public layout(width: number): void {
        const padding = 15;
        this.background.width = width;
        this.background.height = 80;

        this.avatarView.position.set(20, 5);

        const center = width / 2;
        this.starBox.position.set(center - this.starBox.width - 10, 15);
        this.gemBox.position.set(center + 10, 15);

        this.settingsBtn.x = width - this.settingsBtn.width - padding;
        this.settingsBtn.y = 12;
    }

    // Clean up signal when top bar is destroyed
    public destroy(options?: any): void {
        EconomyStorage.onCurrencyChanged.remove(this.onCurrencyUpdate, this);
        super.destroy(options);
    }
}