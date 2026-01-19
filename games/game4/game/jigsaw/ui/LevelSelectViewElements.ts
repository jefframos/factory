// LevelSelectViewElements.ts
import { ButtonAttributes, ButtonData } from "@core/ui/BaseButton";
import type { Difficulty } from "games/game4/types";
import * as PIXI from "pixi.js";

export type ButtonSkinKey = "primary" | "secondary" | "difficultyEasy" | "difficultyMedium" | "difficultyHard";

export interface ButtonSkins {

    [key: string]: {
        standard: ButtonAttributes;
        over?: ButtonAttributes;
        down?: ButtonAttributes;
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
    };

    // Level rows
    levelRow: {
        useNineSliceBg: boolean;
        bgTexture?: PIXI.Texture;
        bgTextureLocked?: PIXI.Texture;
        bgNineSlice?: { left: number; top: number; right: number; bottom: number };

        rowHeight: number;
        thumbSize: number;
        titleStyle: PIXI.TextStyle;
        questStyle: PIXI.TextStyle;
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
    const titleStyle = new PIXI.TextStyle({
        fontFamily: "LEMONMILK-Bold",
        fontSize: 28,
        fill: 0xffffff,
        stroke: "#0c0808",
        strokeThickness: 4,
    });

    const headerButtonStyle = new PIXI.TextStyle({
        fontFamily: "LEMONMILK-Bold",
        fontSize: 18,
        fill: 0xffffff,
        stroke: "#0c0808",
        strokeThickness: 4,
    });

    const cardTitleStyle = new PIXI.TextStyle({
        fontFamily: "LEMONMILK-Bold",
        fontSize: 20,
        fill: 0xffffff,
        stroke: "#0c0808",
        strokeThickness: 3,
    });

    const cardCompletionStyle = new PIXI.TextStyle({
        fontFamily: "LEMONMILK-Bold",
        fontSize: 18,
        fill: 0xffffff,
        stroke: "#0c0808",
        strokeThickness: 3,
    });

    const difficultyStyle = new PIXI.TextStyle({
        fontFamily: "LEMONMILK-Bold",
        fontSize: 16,
        fill: 0xffffff,
        stroke: "#0c0808",
        strokeThickness: 5,
    });

    const rowTitleStyle = new PIXI.TextStyle({
        fontFamily: "LEMONMILK-Bold",
        fontSize: 20,
        fill: 0xffffff,
        stroke: "#0c0808",
        strokeThickness: 3,
    });

    return {
        headerHeight: 70,
        padding: 16,

        headerBgTexture: PIXI.Texture.from("ItemFrame03_Single_Yellow"),
        headerBgNineSlice: { left: 50, top: 50, right: 50, bottom: 50 },

        titleStyle,

        buttonSkins: {
            purchase: {
                standard: {
                    allPadding: 20,
                    texture: PIXI.Texture.from("ResourceBar_Single_Btn_Yellow1"),
                    iconTexture: PIXI.Texture.from("ResourceBar_Single_Icon_Coin"),
                    width: 200,
                    height: 60,
                    textOffset: new PIXI.Point(20, 0),
                    fontStyle: headerButtonStyle,
                    iconSize: { height: 45, width: 45 },
                    iconOffset: new PIXI.Point(5, 5)
                },
                over: {
                    texture: PIXI.Texture.from("ResourceBar_Single_Btn_Orange1"),
                },
            },
            primary: {
                standard: {
                    allPadding: 20,
                    texture: PIXI.Texture.from("ResourceBar_Single_Btn_Blue1"),
                    width: 120,
                    height: 44,
                    fontStyle: headerButtonStyle,
                },
                over: {
                    texture: PIXI.Texture.from("ResourceBar_Single_Btn_Purple1"),
                },
            },
            secondary: {
                standard: {
                    allPadding: 20,
                    texture: PIXI.Texture.from("ResourceBar_Single_Btn_Blue1"),
                    width: 120,
                    height: 44,
                    fontStyle: headerButtonStyle,
                },
                over: {
                    texture: PIXI.Texture.from("ResourceBar_Single_Btn_Purple1"),
                },
            },
            back: {
                standard: {
                    allPadding: 20,
                    texture: PIXI.Texture.from("ResourceBar_Single_Btn_Red1"),
                    width: 80,
                    height: 80,
                    fontStyle: headerButtonStyle,
                    iconTexture: PIXI.Texture.from("Icon_Back"),
                    iconSize: { width: 60, height: 60 },
                    centerIconHorizontally: true,
                    centerIconVertically: true,
                },
                over: {
                    texture: PIXI.Texture.from("ResourceBar_Single_Btn_Orange1"),
                },
            },
            difficultyEasy: {
                standard: {
                    allPadding: 18,
                    texture: PIXI.Texture.from("ResourceBar_Single_Btn_Green1"),
                    width: 100,
                    height: 60,
                    fontStyle: difficultyStyle,
                    iconTexture: PIXI.Texture.from('jiggyGreen'),
                    iconSize: { height: 50, width: 50 },
                    iconOffset: new PIXI.Point(5, 5)
                },
                over: {
                    texture: PIXI.Texture.from("ResourceBar_Single_Btn_Green1"),
                },
                completed: {
                    texture: PIXI.Texture.from("ResourceBar_Single_Btn_Yellow1"),
                    iconTexture: PIXI.Texture.from('Icon_Check03_s'),
                    iconSize: { height: 30, width: 30 },
                    iconOffset: new PIXI.Point(70, -5)
                },
            },
            difficultyMedium: {
                standard: {
                    allPadding: 18,
                    texture: PIXI.Texture.from("ResourceBar_Single_Btn_Blue1"),
                    width: 100,
                    height: 60,
                    fontStyle: difficultyStyle,
                    iconTexture: PIXI.Texture.from('jiggyBlue'),
                    iconSize: { height: 50, width: 50 },
                    iconOffset: new PIXI.Point(5, 5)
                },
                over: {
                    texture: PIXI.Texture.from("ResourceBar_Single_Btn_Blue1"),
                },
                completed: {
                    texture: PIXI.Texture.from("ResourceBar_Single_Btn_Yellow1"),
                    iconTexture: PIXI.Texture.from('Icon_Check03_s'),
                    iconSize: { height: 30, width: 30 },
                    iconOffset: new PIXI.Point(70, -5)
                },
            },
            difficultyHard: {
                standard: {
                    allPadding: 18,
                    texture: PIXI.Texture.from("ResourceBar_Single_Btn_Purple1"),
                    width: 100,
                    height: 60,
                    fontStyle: difficultyStyle,
                    iconTexture: PIXI.Texture.from('jiggyPurple'),
                    iconSize: { height: 50, width: 50 },
                    iconOffset: new PIXI.Point(5, 5)
                },
                over: {
                    texture: PIXI.Texture.from("ResourceBar_Single_Btn_Purple1"),
                },
                completed: {
                    texture: PIXI.Texture.from("ResourceBar_Single_Btn_Yellow1"),
                    iconTexture: PIXI.Texture.from('Icon_Check03_s'),
                    iconSize: { height: 30, width: 30 },
                    iconOffset: new PIXI.Point(70, -5)
                },
            },
        },

        sectionCard: {
            useNineSliceCardBg: true,
            cardBgTexture: PIXI.Texture.from("ItemFrame03_Single_Green"),
            cardBgNineSlice: { left: 62, top: 62, right: 62, bottom: 62 },

            coverHeightRatio: 0.80,
            coverOverlayAlpha: 0,
            cardHeight: 250,

            cardTitleStyle,
            cardCompletionStyle,

            completionPillTexture: PIXI.Texture.from("Label_Badge01_Yellow"),
            completionPillNineSlice: { left: 0, top: 0, right: 0, bottom: 0 },
            completionPillPadding: { x: 10, y: 6 },
        },

        levelRow: {
            useNineSliceBg: true,
            bgTexture: PIXI.Texture.from("ItemFrame03_Single_Blue"),
            bgTextureLocked: PIXI.Texture.from("ItemFrame03_Single_Navy"),
            bgNineSlice: { left: 20, top: 20, right: 20, bottom: 20 },

            rowHeight: 250,
            thumbSize: 130,
            titleStyle: rowTitleStyle,
            questStyle: { ...rowTitleStyle, fontSize: 16 },
            rowPadding: 15,
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
