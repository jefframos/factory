// ui/timedRewards/TimedRewardSlot.ts
import ViewUtils from "@core/utils/ViewUtils";
import * as PIXI from "pixi.js";
import MergeAssets from "../../MergeAssets";

export class TimedRewardSlot extends PIXI.Container {
    private icon: PIXI.Sprite;
    private timeText: PIXI.BitmapText;
    private check: PIXI.Sprite;

    constructor(fontStyle: PIXI.TextStyle, checkTexture: PIXI.Texture) {
        super();

        this.icon = new PIXI.Sprite();
        this.icon.anchor.set(0.5);
        this.addChild(this.icon);


        this.timeText = new PIXI.BitmapText("", {
            fontName: MergeAssets.MainFont.fontFamily,
            fontSize: 22,
            letterSpacing: 2
        });


        this.timeText.anchor.set(0.5);
        this.timeText.y = 16; // Offset below icon
        this.addChild(this.timeText);

        this.check = new PIXI.Sprite(checkTexture);
        this.check.anchor.set(0.5);
        this.check.position.set(18, -16);
        this.check.visible = false;
        this.addChild(this.check);
    }

    public setup(texture: PIXI.Texture, label: string, isClaimed: boolean): void {
        this.icon.texture = texture;
        this.timeText.text = label;
        this.check.visible = isClaimed;

        this.icon.scale.set(ViewUtils.elementScaler(this.icon, 80, 60))
        this.check.scale.set(ViewUtils.elementScaler(this.check, 30, 30))

        const alpha = 1//isClaimed ? 0.65 : 1.0;
        this.icon.alpha = alpha;
        this.timeText.alpha = alpha;
    }
}