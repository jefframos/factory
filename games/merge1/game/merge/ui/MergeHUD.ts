import { Game } from "@core/Game";
import SoundToggleButton from "@core/ui/SoundToggleButton";
import * as PIXI from "pixi.js";
import MergeAssets from "../../MergeAssets";
import GeneratorHUD from "./GeneratorHUD";

export default class MergeHUD extends PIXI.Container {
    private soundToggleButton: SoundToggleButton;
    private coinText: PIXI.Text;
    private entityCountText: PIXI.Text; // New: Entity Counter
    public generator: GeneratorHUD;

    public onSpeedUpRequested: () => void = () => { };

    constructor() {
        super();

        const commonStyle = { ...MergeAssets.MainFont }

        // 1. Sound Toggle
        this.soundToggleButton = new SoundToggleButton(
            MergeAssets.Textures.Icons.SoundOn,
            MergeAssets.Textures.Icons.SoundOff
        );
        this.addChild(this.soundToggleButton);

        // 2. Economy Display
        this.coinText = new PIXI.Text("Coins: 0", commonStyle);
        this.addChild(this.coinText);

        // 3. Entity Counter Display
        // Using a slightly smaller font for the count to keep hierarchy
        this.entityCountText = new PIXI.Text("0/0", { ...commonStyle, fontSize: 18 });
        this.addChild(this.entityCountText);

        // 4. New Generator Component
        this.generator = new GeneratorHUD();
        this.generator.onSpeedUpRequested = () => this.onSpeedUpRequested();
        this.addChild(this.generator);
    }

    public setGeneratorFullState(isFull: boolean): void {
        this.generator.setFullState(isFull);

        // Visual polish: Change counter color when full
        this.entityCountText.style.fill = isFull ? 0xff4444 : 0xffffff;
    }

    public updateCoins(amount: number): void {
        this.coinText.text = `Coins: ${Math.floor(amount)}`;
    }

    /**
     * Updates the entity count display (e.g., "12 / 20")
     */
    public updateEntityCount(current: number, max: number): void {
        this.entityCountText.text = `Space: ${current}/${max}`;
    }

    public updateProgress(ratio: number): void {
        this.generator.updateProgress(ratio);
    }

    public updateLayout(): void {
        const padding = 20;
        const topLeft = Game.overlayScreenData.topLeft;
        const topRight = Game.overlayScreenData.topRight;

        this.x = topLeft.x;
        this.y = topLeft.y;

        // Position Coins (Top Left)
        this.coinText.position.set(padding, padding);

        // Position Entity Count (Below Coins)
        this.entityCountText.position.set(padding, this.coinText.y + this.coinText.height + 5);

        // Position Sound (Top Right)
        this.soundToggleButton.x = topRight.x - this.x - this.soundToggleButton.width - padding;
        this.soundToggleButton.y = padding + this.soundToggleButton.height / 2;

        // Position Generator at Bottom Center
        // We offset it based on the DESIGN_HEIGHT to keep it near the bottom thumb area
        this.generator.x = (topRight.x - topLeft.x) / 2 - 140;
        this.generator.y = Game.DESIGN_HEIGHT - 80;
    }
}