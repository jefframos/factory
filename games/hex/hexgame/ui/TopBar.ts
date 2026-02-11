import BaseButton from "@core/ui/BaseButton";
import * as PIXI from "pixi.js";
import { Signal } from "signals";
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

        // 2. Avatar & Level System (Consolidated)
        this.avatarView = new AvatarUIView();
        this.addChild(this.avatarView);

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
    }

    public updateAvatar(texture: PIXI.Texture): void {
        this.avatarView.updateAvatarTexture(texture);
    }

    public updateLevel(level: number, progress: number): void {
        this.avatarView.update(level, progress);
    }

    /**
     * Handles responsive positioning for the top bar elements
     */
    public layout(width: number): void {
        const padding = 15;
        this.background.width = width;
        this.background.height = 80;

        // Avatar on the left (Level bar is attached to it)
        this.avatarView.position.set(20, 5);

        // Currencies centered
        const center = width / 2;
        this.starBox.position.set(center - this.starBox.width - 10, 15);
        this.gemBox.position.set(center + 10, 15);

        // Settings on the right
        this.settingsBtn.x = width - this.settingsBtn.width - padding;
        this.settingsBtn.y = 12;
    }
}