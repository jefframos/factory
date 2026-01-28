// LevelSelectViewElements.ts
import { ButtonAttributes, ButtonData } from "@core/ui/BaseButton";
import type { Difficulty } from "games/game4/types";
import * as PIXI from "pixi.js";
import MergeAssets from "../merge/MergeAssets";

export type ButtonSkinKey = "primary" | "secondary" | "difficultyEasy" | "difficultyMedium" | "difficultyHard";


export interface ButtonSkins {

    [key: string]: {
        standard: ButtonAttributes;
        over?: ButtonAttributes;
        down?: ButtonAttributes;
        disabled?: ButtonAttributes;
        completed?: ButtonAttributes;
    };
}

export interface SectionStyleOverride {
    sectionId: string;
    a: ButtonData,
    // Card background (nine-sliced) if you want a styled card instead of a plain Graphics rounded rect
    cardTexture?: PIXI.Texture;

    // Optional fallback cover if the section has no cover level
    defaultCoverTexture?: PIXI.Texture;

    // Card title style override
    cardTitleStyle?: PIXI.TextStyle;

    // Completion label style override
    cardCompletionStyle?: PIXI.TextStyle;

    // Difficulty button skin override per section (optional)
    difficultySkinByDifficulty?: Partial<Record<Difficulty, ButtonSkinKey>>;
}

export interface LevelSelectTheme {
    // Layout
    headerHeight: number;
    padding: number;

    // Header background (nine-slice recommended)
    headerBgTexture: PIXI.Texture;
    headerBgNineSlice: { left: number; top: number; right: number; bottom: number };

    // Header text styles
    titleStyle: PIXI.TextStyle;

    // Buttons
    buttonSkins: ButtonSkins;

    // Section cards
    sectionCard: {
        cardHeight: number;
        // If you use nine-sliced card background
        useNineSliceCardBg: boolean;
        cardBgTexture?: PIXI.Texture;
        cardBgNineSlice?: { left: number; top: number; right: number; bottom: number };

        // Cover proportions
        coverHeightRatio: number;

        // Overlay on cover for readability
        coverOverlayAlpha: number;

        // Title/completion styles
        cardTitleStyle: PIXI.TextStyle;
        cardCompletionStyle: PIXI.TextStyle;

        // Optional "pill" behind completion text (nine-slice)
        completionPillTexture?: PIXI.Texture;
        completionPillNineSlice?: { left: number; top: number; right: number; bottom: number };
        completionPillPadding: { x: number; y: number };
        padding: { x: number; y: number };
    };

    // Level rows
    levelRow: {
        useNineSliceBg: boolean;
        bgTexture?: PIXI.Texture;
        bgTextureLocked?: PIXI.Texture;
        bgNineSlice?: { left: number; top: number; right: number; bottom: number };

        rowHeight: number;
        thumbSize: number;
        thumbWidth?: number;
        thumbHeight?: number;
        titleStyle: Partial<PIXI.TextStyle>;
        questStyle: Partial<PIXI.TextStyle>;
        rowPadding: number;
        rowCornerRadius: number; // used only if useNineSliceBg=false
    };

    // Per-section overrides
    sectionOverrides: SectionStyleOverride[];
}

export function getSectionOverride(theme: LevelSelectTheme, sectionId: string): SectionStyleOverride | undefined {
    return theme.sectionOverrides.find((o) => o.sectionId === sectionId);
}

export function getDifficultySkinKey(
    theme: LevelSelectTheme,
    sectionId: string | undefined,
    difficulty: Difficulty
): ButtonSkinKey {
    if (sectionId) {
        const o = getSectionOverride(theme, sectionId);
        const mapped = o?.difficultySkinByDifficulty?.[difficulty];
        if (mapped) {
            return mapped;
        }
    }

    if (difficulty === "easy") {
        return "difficultyEasy";
    }
    if (difficulty === "medium") {
        return "difficultyMedium";
    }
    return "difficultyHard";
}

/**
 * Example theme factory.
 * Replace texture names with your atlas keys.
 */
export function createDefaultLevelSelectTheme(): LevelSelectTheme {
    const titleStyle = new PIXI.TextStyle({ ...MergeAssets.MainFontTitle, fontSize: 30 });

    const headerButtonStyle = new PIXI.TextStyle({ ...MergeAssets.MainFont, fontSize: 18 });

    const purchaseButtonStyle = new PIXI.TextStyle({ ...MergeAssets.MainFont, fontSize: 32 });

    const cardTitleStyle = new PIXI.TextStyle({ ...MergeAssets.MainFont, fontSize: 20 });

    const cardCompletionStyle = new PIXI.TextStyle({ ...MergeAssets.MainFont, fontSize: 18 });

    const difficultyStyle = new PIXI.TextStyle({ ...MergeAssets.MainFont, fontSize: 18 });

    const rowTitleStyle = new PIXI.TextStyle({ ...MergeAssets.MainFontTitle, fontSize: 22 });

    const T = MergeAssets.Textures;
    function playHoverSound() {
        MergeAssets.tryToPlaySound(MergeAssets.Sounds.UI.Hover)
    }
    return {
        headerHeight: 90,
        padding: 20,

        headerBgTexture: null,//Assets.getTexture(T.UI.Header),
        headerBgNineSlice: MergeAssets.Paddings.UI.Header,

        titleStyle,

        buttonSkins: {
            purchase: {
                standard: {
                    allPadding: 30,
                    texture: MergeAssets.getTexture(T.Buttons.Gold),
                    iconTexture: MergeAssets.getTexture(T.Icons.Coin),
                    width: 200,
                    height: 64,
                    textOffset: new PIXI.Point(20, 0),
                    fontStyle: purchaseButtonStyle,
                    iconSize: { height: 45, width: 45 },
                    iconOffset: new PIXI.Point(10, 0),
                    centerIconVertically: true

                },
                over: {
                    tint: 0xcccccc,
                    callback: () => playHoverSound(),
                    texture: MergeAssets.getTexture(T.Buttons.Gold),
                },
                disabled: {
                    texture: MergeAssets.getTexture(T.Buttons.Grey),
                },
            },
            primary: {
                standard: {
                    allPadding: 20,
                    texture: MergeAssets.getTexture(T.Buttons.Blue),
                    width: 120,
                    height: 60,
                    fontStyle: headerButtonStyle,
                },
                over: {
                    tint: 0xcccccc,
                    callback: () => playHoverSound(),
                    texture: MergeAssets.getTexture(T.Buttons.Blue),
                },
            },
            secondary: {
                standard: {
                    allPadding: 20,
                    texture: MergeAssets.getTexture(T.Buttons.Green),
                    width: 120,
                    height: 60,
                    fontStyle: headerButtonStyle,
                },
                over: {
                    tint: 0xcccccc,
                    callback: () => playHoverSound(),
                    texture: MergeAssets.getTexture(T.Buttons.Green),
                },
            },
            back: {
                standard: {
                    allPadding: 30,
                    texture: MergeAssets.getTexture(T.Buttons.Red),
                    width: 70,
                    height: 64,
                    fontStyle: headerButtonStyle,
                    iconTexture: MergeAssets.getTexture(T.Icons.Back),
                    iconSize: { width: 45, height: 45 },
                    centerIconHorizontally: true,
                    centerIconVertically: true,
                },
                over: {
                    tint: 0xcccccc,
                    callback: () => playHoverSound(),
                    texture: MergeAssets.getTexture(T.Buttons.Red),
                },
            },
            difficultyEasy: {
                standard: {
                    allPadding: 30,
                    texture: MergeAssets.getTexture(T.Buttons.Green),
                    width: 90,
                    height: 64,
                    fontStyle: difficultyStyle,
                    // iconTexture: PIXI.Texture.from('jiggyGreen'),
                    iconSize: { height: 50, width: 50 },
                    iconOffset: new PIXI.Point(5, 5)
                },
                over: {
                    tint: 0xcccccc,
                    callback: () => playHoverSound(),
                    texture: MergeAssets.getTexture(T.Buttons.Green),
                },
                completed: {
                    //texture: Assets.getTexture(T.Buttons.Gold),
                    iconTexture: MergeAssets.getTexture(T.Icons.Check),
                    iconSize: { height: 30, width: 30 },
                    iconOffset: new PIXI.Point(70, -5)
                },
            },
            difficultyMedium: {
                standard: {
                    allPadding: 30,
                    texture: MergeAssets.getTexture(T.Buttons.Blue),
                    width: 90,
                    height: 64,
                    fontStyle: difficultyStyle,
                    // iconTexture: PIXI.Texture.from('jiggyBlue'),
                    iconSize: { height: 50, width: 50 },
                    iconOffset: new PIXI.Point(5, 5)
                },
                over: {
                    tint: 0xcccccc,
                    callback: () => playHoverSound(),
                    texture: MergeAssets.getTexture(T.Buttons.Blue),
                },
                completed: {
                    //texture: Assets.getTexture(T.Buttons.Gold),
                    iconTexture: MergeAssets.getTexture(T.Icons.Check),
                    iconSize: { height: 30, width: 30 },
                    iconOffset: new PIXI.Point(70, -5)
                },
            },
            difficultyHard: {
                standard: {
                    allPadding: 30,
                    texture: MergeAssets.getTexture(T.Buttons.Orange),
                    width: 90,
                    height: 64,
                    fontStyle: difficultyStyle,
                    // iconTexture: PIXI.Texture.from('jiggyPurple'),
                    iconSize: { height: 50, width: 50 },
                    iconOffset: new PIXI.Point(5, 5)
                },
                over: {
                    tint: 0xcccccc,
                    callback: () => playHoverSound(),
                    texture: MergeAssets.getTexture(T.Buttons.Orange),
                },
                completed: {
                    //texture: Assets.getTexture(T.Buttons.Gold),
                    iconTexture: MergeAssets.getTexture(T.Icons.Check),
                    iconSize: { height: 30, width: 30 },
                    iconOffset: new PIXI.Point(70, -5)
                },
            },
        },

        sectionCard: {
            useNineSliceCardBg: true,
            cardBgTexture: MergeAssets.getTexture(T.UI.ShopBgActive),
            cardBgNineSlice: { left: 62, top: 62, right: 62, bottom: 62 },

            coverHeightRatio: 0.90,
            coverOverlayAlpha: 0,
            cardHeight: 300,

            cardTitleStyle,
            cardCompletionStyle,

            completionPillTexture: MergeAssets.getTexture(T.Icons.BadgeMain),
            completionPillNineSlice: { left: 0, top: 0, right: 0, bottom: 0 },
            completionPillPadding: { x: 10, y: 6 },
        },

        levelRow: {
            useNineSliceBg: true,
            bgTexture: MergeAssets.getTexture(T.UI.RowBg),
            bgTextureLocked: MergeAssets.getTexture(T.UI.RowLock),
            bgNineSlice: { left: 62, top: 62, right: 62, bottom: 62 },

            rowHeight: 300,
            thumbSize: 120,
            thumbHeight: 300 * 0.9,
            thumbWidth: 310,
            titleStyle: rowTitleStyle,
            questStyle: { ...difficultyStyle, fontSize: 16 },
            rowPadding: 20,
            rowCornerRadius: 14,
        },

        sectionOverrides: [
            // Example: section-specific style
            // {
            //     sectionId: "animals",
            //     cardTexture: PIXI.Texture.from("PanelCard_Animals"),
            //     difficultySkinByDifficulty: { hard: "primary" },
            // }
        ],
    };
}
