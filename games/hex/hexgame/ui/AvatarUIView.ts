import { NineSliceProgressBar } from "@core/ui/NineSliceProgressBar";
import ViewUtils from "@core/utils/ViewUtils";
import * as PIXI from "pixi.js";
import HexAssets from "../HexAssets";

export class AvatarUIView extends PIXI.Container {
    private containerBg: PIXI.NineSlicePlane;
    private avatarMask: PIXI.Graphics;
    private avatarSprite: PIXI.Sprite;
    private levelBar: NineSliceProgressBar;
    private levelBadge: PIXI.Container;
    private levelText: PIXI.BitmapText;

    private readonly SIZE = 85;

    constructor() {
        super();

        // 1. Background Container
        this.containerBg = new PIXI.NineSlicePlane(
            PIXI.Texture.from(HexAssets.Textures.UI.BarBg),
            15, 15, 15, 15
        );
        this.containerBg.width = this.SIZE;
        this.containerBg.height = this.SIZE;
        this.addChild(this.containerBg);

        // 2. Masked Avatar Logic
        const maskSize = this.SIZE - 10;
        this.avatarSprite = PIXI.Sprite.from(HexAssets.Textures.Icons.Critter);
        this.avatarSprite.anchor.set(0.5);
        this.avatarSprite.position.set(this.SIZE / 2, this.SIZE / 2);
        this.avatarSprite.scale.set(ViewUtils.elementScaler(this.avatarSprite, this.SIZE))

        this.avatarMask = new PIXI.Graphics();
        this.avatarMask.beginFill(0xffffff);
        this.avatarMask.drawCircle(this.SIZE / 2, this.SIZE / 2, maskSize / 2);
        this.avatarMask.endFill();

        this.avatarSprite.mask = this.avatarMask;
        this.addChild(this.avatarSprite, this.avatarMask);

        // 3. Level Bar (Bottom of container)
        const barHeight = 20;
        this.levelBar = new NineSliceProgressBar({
            width: this.SIZE + 20, // Slightly wider than the avatar
            height: barHeight,
            bgTexture: PIXI.Texture.from(HexAssets.Textures.UI.BarBg),
            barTexture: PIXI.Texture.from(HexAssets.Textures.UI.BarBg),
            leftWidth: 10, topHeight: 5, rightWidth: 10, bottomHeight: 5,
            padding: 2
        });

        // Position at the bottom of the avatar container
        this.levelBar.pivot.set(this.levelBar.width / 2, barHeight / 2);
        this.levelBar.position.set(this.SIZE / 2, this.SIZE);
        this.addChild(this.levelBar);

        // 4. Level Badge
        this.levelBadge = new PIXI.Container();
        const badgeBg = PIXI.Sprite.from(HexAssets.Textures.UI.LevelBadge);
        badgeBg.anchor.set(0.5);

        this.levelText = new PIXI.BitmapText("1", {
            fontName: HexAssets.MainFont.fontFamily,
            fontSize: 14
        });
        this.levelText.anchor.set(0.5);
        this.levelBadge.addChild(badgeBg, this.levelText);

        // Scaling badge to fit height of the bar
        const badgeScale = ViewUtils.elementScaler(this.levelBadge, barHeight);
        this.levelBadge.scale.set(badgeScale);

        // Position badge at the start of the bar
        this.levelBadge.position.set(this.levelBar.x - (this.levelBar.width / 2), this.levelBar.y);

        this.addChild(this.levelBadge);
    }

    public updateAvatarTexture(texture: PIXI.Texture) {
        this.avatarSprite.texture = texture;
        this.avatarSprite.scale.set(ViewUtils.elementScaler(this.avatarSprite, this.SIZE))

    }
    public update(level: number, progress: number): void {
        this.levelText.text = level.toString();
        this.levelBar.update(progress);
    }
}