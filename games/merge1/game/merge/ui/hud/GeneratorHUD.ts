import BaseButton from "@core/ui/BaseButton";
import { NineSliceProgressBar } from "@core/ui/NineSliceProgressBar";
import { TweenUtil } from "@core/utils/TweenUtility";
import { gsap } from "gsap";
import * as PIXI from "pixi.js";
import MergeAssets from "../../MergeAssets";

export default class GeneratorHUD extends PIXI.Container {
    private progressBar: NineSliceProgressBar;
    private speedUpBtn: BaseButton;
    private statusLabel: PIXI.Text;
    private countLabel: PIXI.Text;

    private isFull: boolean = false;
    private readonly BAR_WIDTH = 250;
    private readonly BAR_HEIGHT = 35;

    public onSpeedUpRequested: () => void = () => { };

    constructor() {
        super();

        // 1. Setup the NineSlice Progress Bar
        this.progressBar = new NineSliceProgressBar({
            width: this.BAR_WIDTH,
            height: this.BAR_HEIGHT,
            bgTexture: PIXI.Texture.from(MergeAssets.Textures.UI.BarBg), // Replace with your actual asset key
            barTexture: PIXI.Texture.from(MergeAssets.Textures.UI.BarFill),  // Replace with your actual asset key
            leftWidth: 8,
            topHeight: 8,
            rightWidth: 8,
            bottomHeight: 8,
            //bgColor: 0x444444, // Darker backdrop
            barColor: MergeAssets.Textures.UI.FillColor,  // Default green
            padding: 4

        });

        // Adjust pivot to match your previous layout or keep it centered
        // If the original class centered the pivot, we position it at (0,0) locally
        this.progressBar.position.set(this.BAR_WIDTH / 2, 0);
        this.addChild(this.progressBar);

        // 2. Status Label (Now using your LemonMilk style)
        this.statusLabel = new PIXI.Text(MergeAssets.Labels.NextEntity, { ...MergeAssets.MainFont });
        this.statusLabel.anchor.set(0.5, 1);
        this.statusLabel.position.set(this.BAR_WIDTH / 2, -20);
        this.addChild(this.statusLabel);

        this.countLabel = new PIXI.Text('6/6', { ...MergeAssets.MainFont, fontSize: 20 });
        this.countLabel.anchor.set(0.5, 0.5);
        this.countLabel.position.set(this.BAR_WIDTH / 2, 0);
        this.addChild(this.countLabel);

        // 3. Speed Up Button using BaseButton
        this.speedUpBtn = new BaseButton({
            standard: {
                width: 80,
                height: 80,
                allPadding: 10,
                texture: PIXI.Texture.EMPTY, // Using Blue for speed up
                iconTexture: PIXI.Texture.from(MergeAssets.Textures.Icons.GiftFast), // Using Blue for speed up
                fontStyle: new PIXI.TextStyle({ ...MergeAssets.MainFont }),
                centerIconHorizontally: true,
                centerIconVertically: true,
                iconSize: { height: 100, width: 100 }
            },
            over: { tint: 0xeeeeee },
            disabled: { texture: PIXI.Texture.EMPTY },
            click: {
                callback: () => {
                    this.speedUpBtn.scale.set(1.1, 0.9)
                    this.onSpeedUpRequested()
                }
            }
        });
        this.speedUpBtn.visible = true

        this.speedUpBtn.pivot.set(40, 40)
        // Position button to the right of the bar
        this.speedUpBtn.position.set(this.BAR_WIDTH + 15 + 40, -this.speedUpBtn.height / 2 - 5 + 40);
        this.addChild(this.speedUpBtn);
    }


    /**
     * Updates the visual progress
     */
    public updateProgress(ratio: number): void {
        this.speedUpBtn.scale.x = TweenUtil.lerp(this.speedUpBtn.scale.x, 1, 0.2);
        this.speedUpBtn.scale.y = TweenUtil.lerp(this.speedUpBtn.scale.y, 1, 0.1);
        this.progressBar.update(ratio);

        // Dynamic coloring
        if (this.isFull) {
            this.progressBar.setTintColor(0xFF4444); // Red when blocked

        } else {
            this.progressBar.setTintColor(MergeAssets.Textures.UI.FillColor); // Green when working
        }
    }
    public setCountLabel(value: string) {
        this.countLabel.text = value;
    }
    /**
     * Handles UI changes when the grid is full
     */
    public setFullState(isFull: boolean): void {
        if (this.isFull === isFull) return;
        this.isFull = isFull;

        if (isFull) {
            this.statusLabel.text = "FULL!";
            this.statusLabel.style.fill = 0xff4444;
            this.countLabel.style.fill = 0xff4444;

            // Using BaseButton's inherent interactivity control
            this.speedUpBtn.disable()

            // "Denied" shake effect on the whole container
            gsap.to(this, { x: "+=4", duration: 0.05, repeat: 5, yoyo: true });
        } else {
            this.statusLabel.text = MergeAssets.Labels.NextEntity;
            this.statusLabel.style.fill = 0xffffff;
            this.countLabel.style.fill = 0xffffff;
            this.speedUpBtn.enable()
        }
    }
}