import { Game } from "@core/Game";
import SoundToggleButton from "@core/ui/SoundToggleButton";
import * as PIXI from "pixi.js";
import MergeAssets from "../../MergeAssets";
import { CurrencyType } from "../data/InGameEconomy";
import { InGameProgress } from "../data/InGameProgress";
import { ProgressionType } from "../storage/GameStorage";
import { CurrencyBox } from "./CurrencyBox";
import GeneratorHUD from "./GeneratorHUD";
import { ProgressHUD } from "./ProgressHUD";

export default class MergeHUD extends PIXI.Container {
    private soundToggleButton: SoundToggleButton;
    //private coinText: PIXI.Text;
    private entityCountText: PIXI.Text; // New: Entity Counter
    public generator: GeneratorHUD;
    public currencyHUD: CurrencyBox;
    public progressHUD: ProgressHUD;

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
        // this.coinText = new PIXI.Text("Coins: 0", commonStyle);
        // this.addChild(this.coinText);

        this.currencyHUD = new CurrencyBox(CurrencyType.MONEY, {
            iconId: MergeAssets.Textures.Icons.Coin,
            fontName: MergeAssets.MainFont.fontFamily,
            bgId: MergeAssets.Textures.UI.CurrencyPanel, // Optional
            width: 180
        });


        this.progressHUD = new ProgressHUD();
        this.addChild(this.progressHUD);
        this.progressHUD.position.set(220, 20);

        // --- NEW: LISTEN TO PROGRESSION HERE ---
        InGameProgress.instance.onProgressChanged.add(this.handleProgressUpdate, this);
        InGameProgress.instance.onLevelUp.add(this.handleLevelUp, this);

        // Initial sync
        const mainProg = InGameProgress.instance.getProgression(ProgressionType.MAIN);
        this.progressHUD.updateValues(
            mainProg.level,
            mainProg.xp,
            InGameProgress.instance.getXPRequiredForNextLevel(mainProg.level)
        );

        this.currencyHUD.position.set(20, 20);
        this.addChild(this.currencyHUD);
        // 3. Entity Counter Display
        // Using a slightly smaller font for the count to keep hierarchy
        this.entityCountText = new PIXI.Text("0/0", { ...commonStyle, fontSize: 18 });
        this.addChild(this.entityCountText);

        // 4. New Generator Component
        this.generator = new GeneratorHUD();
        this.generator.onSpeedUpRequested = () => this.onSpeedUpRequested();
        this.addChild(this.generator);
    }

    private handleProgressUpdate(type: string, level: number, xp: number, required: number): void {
        // Only update this bar if it's the MAIN progression
        if (type === ProgressionType.MAIN) {
            this.progressHUD.updateValues(level, xp, required);
        }
    }

    private handleLevelUp(type: string, newLevel: number): void {
        if (type === ProgressionType.MAIN) {
            this.progressHUD.playLevelUpEffect(newLevel);
        }
    }

    public setGeneratorFullState(isFull: boolean): void {
        this.generator.setFullState(isFull);

        // Visual polish: Change counter color when full
        this.entityCountText.style.fill = isFull ? 0xff4444 : 0xffffff;
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
        //this.coinText.position.set(padding, padding);

        // Position Entity Count (Below Coins)
        this.entityCountText.position.set(padding, 80);

        // Position Sound (Top Right)
        this.soundToggleButton.x = topRight.x - this.x - this.soundToggleButton.width - padding;
        this.soundToggleButton.y = padding + this.soundToggleButton.height / 2;

        // Position Generator at Bottom Center
        // We offset it based on the DESIGN_HEIGHT to keep it near the bottom thumb area
        this.generator.x = (topRight.x - topLeft.x) / 2 - 140;
        this.generator.y = Game.DESIGN_HEIGHT - 80;
    }

    getCoinTargetGlobalPos(): PIXI.Point {
        return this.currencyHUD.getIconGlobalPosition();
    }
}