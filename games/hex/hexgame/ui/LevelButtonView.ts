import BaseButton from "@core/ui/BaseButton";
import * as PIXI from "pixi.js";
import HexAssets from "../HexAssets";
import { Difficulty, LevelData } from "../HexTypes";
import { StarContainer } from "./StarContainer";

export class LevelButtonView extends BaseButton {
    private starDisplay: StarContainer;

    // Texture Lookup Table
    private static readonly TEXTURE_MAP: Record<Difficulty, { normal: string, locked: string }> = {
        [Difficulty.VERY_EASY]: { normal: 'easy-button', locked: 'easy-locked' },
        [Difficulty.EASY]: { normal: 'easy-button', locked: 'easy-locked' },
        [Difficulty.MEDIUM]: { normal: 'medium-button', locked: 'medium-locked' },
        [Difficulty.HARD]: { normal: 'hard-button', locked: 'hard-locked' },
        [Difficulty.VERY_HARD]: { normal: 'hard-button', locked: 'hard-locked' },
    };

    constructor(index: number, level: LevelData, starsEarned: number, isUnlocked: boolean, onSelect: () => void) {
        const difficulty = level.difficulty ?? Difficulty.MEDIUM;
        const textures = LevelButtonView.TEXTURE_MAP[difficulty];

        super({
            standard: {
                texture: PIXI.Texture.from(textures.normal),
                width: 109,
                height: 84,
                fontStyle: new PIXI.TextStyle({
                    ...HexAssets.MainFont,
                    dropShadowDistance: 2
                }),
                // Move text slightly UP to balance the stars at the bottom
                textOffset: new PIXI.Point(0, -15),
            },
            disabled: {
                texture: PIXI.Texture.from(textures.locked)
            },
            click: { callback: onSelect }
        });

        this.setLabel(String(index + 1));

        // Ensure pivot is centered
        this.pivot.x = 109 / 2;
        this.pivot.y = 84 / 2;

        // 2. Stars positioning
        this.starDisplay = new StarContainer();

        // Since height is 84 and pivot.y is 42:
        // y = 0 is center. 
        // y = 42 is the very bottom edge.
        // We set it to 32 to give it a little padding from the edge.
        this.starDisplay.x = this.pivot.x;
        this.starDisplay.y = 78;

        this.addChild(this.starDisplay);

        // 3. Update State
        if (isUnlocked) {
            this.enable();
            this.starDisplay.setStars(starsEarned);
        } else {
            this.disable();
            this.starDisplay.visible = false;
        }
    }
}