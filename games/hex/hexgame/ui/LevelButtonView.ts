import BaseButton from "@core/ui/BaseButton";
import * as PIXI from "pixi.js";
import { Signal } from "signals";
import HexAssets from "../HexAssets";
import { Difficulty, LevelData } from "../HexTypes";
import { StarContainer } from "./StarContainer";

export class LevelButtonView extends PIXI.Container {
    public readonly onSelected: Signal = new Signal();

    private button: BaseButton;
    private starDisplay: StarContainer;
    private levelLabel: PIXI.BitmapText;

    private static readonly TEXTURE_MAP: Record<Difficulty, { normal: string, locked: string }> = {
        [Difficulty.VERY_EASY]: { normal: 'easy-button', locked: 'easy-locked' },
        [Difficulty.EASY]: { normal: 'easy-button', locked: 'easy-locked' },
        [Difficulty.MEDIUM]: { normal: 'medium-button', locked: 'medium-locked' },
        [Difficulty.HARD]: { normal: 'hard-button', locked: 'hard-locked' },
        [Difficulty.VERY_HARD]: { normal: 'hard-button', locked: 'hard-locked' },
    };

    constructor(index: number, level: LevelData, starsEarned: number, isUnlocked: boolean) {
        super();

        const difficulty = level.difficulty ?? Difficulty.MEDIUM;
        const textures = LevelButtonView.TEXTURE_MAP[difficulty];
        const normalTex = PIXI.Texture.from(textures.normal);

        // 1. Initialize the Button Background
        // We no longer pass fontStyle or textOffset here as we handle text manually
        this.button = new BaseButton({
            standard: {
                texture: normalTex,
                width: normalTex.width,
                height: normalTex.height,
            },
            disabled: {
                texture: PIXI.Texture.from(textures.locked)
            },
            click: { callback: () => this.onSelected.dispatch(index) }
        });

        this.button.pivot.set(normalTex.width / 2, normalTex.height / 2);
        this.addChild(this.button);
        this.button.scale.set(0.5);

        // 2. Initialize Bitmap Text
        // Replace 'MainFont_Bitmap' with your actual bitmap font name from HexAssets
        this.levelLabel = new PIXI.BitmapText(String(index + 1), {
            fontName: HexAssets.MainFontTitle.fontFamily,
            fontSize: 28,
            align: 'center'
        });
        this.levelLabel.interactive = false;
        this.levelLabel.interactiveChildren = false;
        // Center the text; adjust Y offset (-15) to match your previous design
        this.levelLabel.anchor.set(0.5);
        this.levelLabel.position.set(0, -15);
        this.addChild(this.levelLabel);

        // 3. Initialize Stars
        this.starDisplay = new StarContainer();
        this.starDisplay.y = 36;
        this.addChild(this.starDisplay);
        this.starDisplay.interactive = false;
        this.starDisplay.interactiveChildren = false;

        this.updateState(isUnlocked, starsEarned);
    }
    // Inside LevelButtonView.ts

    public updateState(isUnlocked: boolean, starsEarned: number): void {
        if (isUnlocked) {
            this.button.enable();
            this.levelLabel.alpha = 1.0;
            this.starDisplay.visible = true;
            this.starDisplay.setStars(starsEarned);
        } else {
            this.button.disable();
            // Dim the text or hide it when locked
            // this.levelLabel.alpha = 0.5;
            this.starDisplay.visible = false;
        }
    }
}