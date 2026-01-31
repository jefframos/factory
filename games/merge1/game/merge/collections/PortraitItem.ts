import BaseButton, { ButtonState } from "@core/ui/BaseButton";
import ViewUtils from "@core/utils/ViewUtils";
import * as PIXI from "pixi.js";
import MergeAssets from "../MergeAssets";
import { TextureBaker } from "../vfx/TextureBaker";
import { CollectionDataManager } from "./CollectionDataManager";

export class PortraitItem extends PIXI.Container {
    private frame: PIXI.Sprite;
    private lockIcon: PIXI.Sprite;
    private claimButton: BaseButton;
    private currentLevel: number = -1;

    constructor() {
        super();
        this.setupBaseUI();
    }

    private setupBaseUI() {
        // Init frame
        this.frame = new PIXI.Sprite();
        this.frame.anchor.set(0.5, 0.05);
        this.addChild(this.frame);

        // Init lock
        this.lockIcon = new PIXI.Sprite(PIXI.Texture.from(MergeAssets.Textures.Icons.Lock));
        this.lockIcon.anchor.set(0.5);
        this.lockIcon.visible = false;
        this.addChild(this.lockIcon);

        // Init claim button
        this.claimButton = new BaseButton({
            standard: {
                width: 150, height: 60,
                texture: PIXI.Texture.from(MergeAssets.Textures.Buttons.Gold),
                iconTexture: PIXI.Texture.from(MergeAssets.Textures.Icons.Gem),
                iconSize: { height: 45, width: 45 },
                centerIconVertically: true,
                textOffset: new PIXI.Point(20, 0),
                fontStyle: new PIXI.TextStyle({ ...MergeAssets.MainFont, fontSize: 22 }),
            }
        });
        this.claimButton.setLabel('CLAIM');
        this.claimButton.pivot.set(75, 30); // Center pivot correctly (half of 150/60)
        this.claimButton.visible = false;
        this.addChild(this.claimButton);
    }

    /**
     * Resets the item for the pool and sets the target level
     */
    public init(level: number, onClaimCallback: (lvl: number) => void): void {
        this.currentLevel = level;
        this.claimButton.overrider(ButtonState.CLICK, { callback: () => onClaimCallback(this.currentLevel) });
        this.updateState();
    }

    public updateState(): void {
        const isDiscovered = CollectionDataManager.instance.isDiscovered(this.currentLevel);
        const isClaimed = CollectionDataManager.instance.isClaimed(this.currentLevel);

        // 1. Update Frame Texture
        const texKey = isDiscovered ? `Entity_${this.currentLevel}_Frame` : `Entity_${this.currentLevel}_Frame_LOCKED`;
        this.frame.texture = TextureBaker.getTexture(texKey) || PIXI.Texture.WHITE;

        // Randomize tilt/position slightly for that "gallery" look
        this.frame.y = this.frame.height / 2 - this.frame.height * 0.95 + Math.random() * 5;
        this.frame.angle = Math.sin((Math.random() * 2 - 1) * Math.PI / 2) * 1;

        // 2. Toggle visibility based on state
        if (!isDiscovered) {
            this.lockIcon.visible = true;
            this.claimButton.visible = false;

            const lockScale = ViewUtils.elementScaler(this.lockIcon, this.frame.width * 0.4, this.frame.height * 0.4);
            this.lockIcon.scale.set(lockScale);
        } else if (!isClaimed) {
            this.lockIcon.visible = false;
            this.claimButton.visible = true;
            this.claimButton.y = this.frame.height / 2 - 10;
        } else {
            // Discovered and Claimed
            this.lockIcon.visible = false;
            this.claimButton.visible = false;
        }
    }
}