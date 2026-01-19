// LevelSelectViewElements.ts
import SoundManager from "@core/audio/SoundManager";
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
        stroke: "#4b2a19",
        strokeThickness: 4,
    });

    const headerButtonStyle = new PIXI.TextStyle({
        fontFamily: "LEMONMILK-Bold",
        fontSize: 18,
        fill: 0xffffff,
        stroke: "#4b2a19",
        strokeThickness: 4,
    });

    const purchaseButtonStyle = new PIXI.TextStyle({
        fontFamily: "LEMONMILK-Bold",
        fontSize: 32,
        fill: 0xffffff,
        stroke: "#4b2a19",
        strokeThickness: 4,
    });

    const cardTitleStyle = new PIXI.TextStyle({
        fontFamily: "LEMONMILK-Bold",
        fontSize: 20,
        fill: 0xffffff,
        stroke: "#4b2a19",
        strokeThickness: 3,
    });

    const cardCompletionStyle = new PIXI.TextStyle({
        fontFamily: "LEMONMILK-Bold",
        fontSize: 18,
        fill: 0xffffff,
        stroke: "#4b2a19",
        strokeThickness: 3,
    });

    const difficultyStyle = new PIXI.TextStyle({
        fontFamily: "LEMONMILK-Bold",
        fontSize: 16,
        fill: 0xffffff,
        stroke: "#4b2a19",
        strokeThickness: 5,
    });

    const rowTitleStyle = new PIXI.TextStyle({
        fontFamily: "LEMONMILK-Bold",
        fontSize: 22,
        fill: 0xffffff,
        stroke: "#4b2a19",
        strokeThickness: 4,
    });

    return {
        headerHeight: 90,
        padding: 25,

        headerBgTexture: PIXI.Texture.from("header"),
        headerBgNineSlice: { left: 50, top: 50, right: 50, bottom: 50 },

        titleStyle,

        buttonSkins: {
            purchase: {
                standard: {
                    allPadding: 30,
                    texture: PIXI.Texture.from("bt-gold"),
                    iconTexture: PIXI.Texture.from("ResourceBar_Single_Icon_Coin"),
                    width: 200,
                    height: 64,
                    textOffset: new PIXI.Point(20, 0),
                    fontStyle: purchaseButtonStyle,
                    iconSize: { height: 45, width: 45 },
                    iconOffset: new PIXI.Point(10, 0),
                    centerIconVertically: true

                },
                over: {
                    callback: () => {
                        SoundManager.instance.playSoundById('Hover', { volume: 0.1, pitch: 0.7 + Math.random() * 0.3 })
                    },
                    texture: PIXI.Texture.from("bt-gold"),
                },
            },
            primary: {
                standard: {
                    allPadding: 20,
                    texture: PIXI.Texture.from("bt-blue"),
                    width: 120,
                    height: 60,
                    fontStyle: headerButtonStyle,
                },
                over: {
                    callback: () => {
                        SoundManager.instance.playSoundById('Hover', { volume: 0.1, pitch: 0.7 + Math.random() * 0.3 })
                    },
                    texture: PIXI.Texture.from("bt-blue"),
                },
            },
            secondary: {
                standard: {
                    allPadding: 20,
                    texture: PIXI.Texture.from("bt-blue"),
                    width: 120,
                    height: 60,
                    fontStyle: headerButtonStyle,
                },
                over: {
                    callback: () => {
                        SoundManager.instance.playSoundById('Hover', { volume: 0.1, pitch: 0.7 + Math.random() * 0.3 })
                    },
                    texture: PIXI.Texture.from("bt-blue"),
                },
            },
            back: {
                standard: {
                    allPadding: 30,
                    texture: PIXI.Texture.from("bt-red"),
                    width: 70,
                    height: 64,
                    fontStyle: headerButtonStyle,
                    iconTexture: PIXI.Texture.from("Icon_Back"),
                    iconSize: { width: 45, height: 45 },
                    centerIconHorizontally: true,
                    centerIconVertically: true,
                },
                over: {
                    callback: () => {
                        SoundManager.instance.playSoundById('Hover', { volume: 0.1, pitch: 0.7 + Math.random() * 0.3 })
                    },
                    texture: PIXI.Texture.from("bt-red"),
                },
            },
            difficultyEasy: {
                standard: {
                    allPadding: 30,
                    texture: PIXI.Texture.from("bt-green"),
                    width: 100,
                    height: 64,
                    fontStyle: difficultyStyle,
                    // iconTexture: PIXI.Texture.from('jiggyGreen'),
                    iconSize: { height: 50, width: 50 },
                    iconOffset: new PIXI.Point(5, 5)
                },
                over: {
                    callback: () => {
                        SoundManager.instance.playSoundById('Hover', { volume: 0.1, pitch: 0.7 + Math.random() * 0.3 })
                    },
                    texture: PIXI.Texture.from("bt-green"),
                },
                completed: {
                    texture: PIXI.Texture.from("bt-gold"),
                    iconTexture: PIXI.Texture.from('Icon_Check03_s'),
                    iconSize: { height: 30, width: 30 },
                    iconOffset: new PIXI.Point(70, -5)
                },
            },
            difficultyMedium: {
                standard: {
                    allPadding: 30,
                    texture: PIXI.Texture.from("bt-blue"),
                    width: 100,
                    height: 64,
                    fontStyle: difficultyStyle,
                    // iconTexture: PIXI.Texture.from('jiggyBlue'),
                    iconSize: { height: 50, width: 50 },
                    iconOffset: new PIXI.Point(5, 5)
                },
                over: {
                    callback: () => {
                        SoundManager.instance.playSoundById('Hover', { volume: 0.1, pitch: 0.7 + Math.random() * 0.3 })
                    },
                    texture: PIXI.Texture.from("bt-blue"),
                },
                completed: {
                    texture: PIXI.Texture.from("bt-gold"),
                    iconTexture: PIXI.Texture.from('Icon_Check03_s'),
                    iconSize: { height: 30, width: 30 },
                    iconOffset: new PIXI.Point(70, -5)
                },
            },
            difficultyHard: {
                standard: {
                    allPadding: 30,
                    texture: PIXI.Texture.from("bt-orange"),
                    width: 100,
                    height: 64,
                    fontStyle: difficultyStyle,
                    // iconTexture: PIXI.Texture.from('jiggyPurple'),
                    iconSize: { height: 50, width: 50 },
                    iconOffset: new PIXI.Point(5, 5)
                },
                over: {
                    callback: () => {
                        SoundManager.instance.playSoundById('Hover', { volume: 0.1, pitch: 0.7 + Math.random() * 0.3 })
                    },
                    texture: PIXI.Texture.from("bt-orange"),
                },
                completed: {
                    texture: PIXI.Texture.from("bt-gold"),
                    iconTexture: PIXI.Texture.from('Icon_Check03_s'),
                    iconSize: { height: 30, width: 30 },
                    iconOffset: new PIXI.Point(70, -5)
                },
            },
        },

        sectionCard: {
            useNineSliceCardBg: true,
            cardBgTexture: PIXI.Texture.from("card1"),
            cardBgNineSlice: { left: 62, top: 62, right: 62, bottom: 62 },

            coverHeightRatio: 0.80,
            coverOverlayAlpha: 0,
            cardHeight: 300,

            cardTitleStyle,
            cardCompletionStyle,

            completionPillTexture: PIXI.Texture.from("Label_Badge01_Yellow"),
            completionPillNineSlice: { left: 0, top: 0, right: 0, bottom: 0 },
            completionPillPadding: { x: 10, y: 6 },
        },

        levelRow: {
            useNineSliceBg: true,
            bgTexture: PIXI.Texture.from("section-bg"),
            bgTextureLocked: PIXI.Texture.from("section-grey-bg"),
            bgNineSlice: { left: 40, top: 40, right: 40, bottom: 40 },

            rowHeight: 300,
            thumbSize: 140,
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
