import SoundManager from "@core/audio/SoundManager";
import * as PIXI from "pixi.js";
export interface SoundAsset {
    soundId: string | string[];
    volumeMinMax?: [number, number] | number,
    pitchMinMax?: [number, number] | number
}
export default class Assets {
    // 1. Textures Registry (Central point for all images)

    //   static readonly Offsets = {
    //     UI: {
    //         Header: { x: 0, y: -5 }
    //     }
    // }

    //   static readonly Paddings = {
    //     UI: {
    //         Header: { left: 50, top: 50, right: 50, bottom: 50 }
    //     }
    // } as const;
    // static readonly Textures = {
    //     Buttons: {
    //         Gold: "bt-gold",
    //         Blue: "bt-blue",
    //         Red: "bt-red",
    //         Green: "bt-green",
    //         Grey: "bt-grey",
    //         Orange: "bt-orange",
    //     },
    //     Icons: {
    //         Coin: "ResourceBar_Single_Icon_Coin",
    //         Gem: "ResourceBar_Single_Icon_Gem",
    //         Back: "Icon_Back",
    //         Check: "Icon_Check03_s",
    //         CheckItem: "Toggle_Check_Single_Icon",
    //         Pill: "Label_Badge01_Yellow",
    //         SoundOn: "PictoIcon_Sound",
    //         SoundOff: "PictoIcon_Sound_Off",
    //         Badge1: "Label_Badge01_Red",
    //         Badge2: "Label_Badge01_Purple",
    //         Home: "PictoIcon_Home_1",
    //         Eye: "eye",
    //     },
    //     UI: {
    //         EndRibbon: "Title_Ribbon01_Green",
    //         Shine: "Image_Effect_Rotate",
    //         Header: "header",
    //         CardBg: "card1",
    //         RowBg: "section-bg",
    //         RowLock: "section-grey-bg",
    //         FadeShape: "fade-shape",
    //     }
    // } as const;
    private static getRange(value?: number | [number, number]): number | undefined {
        if (value === undefined) return 1;
        if (typeof value === "number") return value;

        const [min, max] = value;
        return Math.random() * (max - min) + min;
    }

    private static getRandom(value?: string | string[]): string | undefined {
        if (value === undefined) return undefined;
        if (typeof value === "string") return value;

        return value[Math.floor(Math.random() * value.length)]
    }

    static tryToPlaySound(soundAsset: SoundAsset) {
        const id = this.getRandom(soundAsset.soundId)
        if (!id) {
            return
        }
        SoundManager.instance.playSoundById(id, {
            volume: this.getRange(soundAsset.volumeMinMax),
            pitch: this.getRange(soundAsset.pitchMinMax)
        });
    }
    static readonly AmbientSound = {

        AmbientSoundId: 'peace-be-with-you',
        AmbientMasterVolume: 0.05,

        AmbientSoundGameplay: 'brittle-rille',
        AmbientMasterVolumeGameplay: 0.1,
    }
    static readonly Sounds = {
        UI: {
            Tap: {
                soundId: 'Tap',
                volumeMinMax: 0.3,
                pitchMinMax: [0.9, 1]
            },
            Hover: {
                soundId: 'Hover',
                volumeMinMax: 0.1,
                pitchMinMax: [0.7, 1]
            },
            Hold: {
                soundId: 'Hover',
                volumeMinMax: 0.1,
                pitchMinMax: [0.7, 1]
            },
            Drop: {
                soundId: 'Bubbles',
                volumeMinMax: 0.1,
                pitchMinMax: [0.7, 1]
            },
            Purchase: {
                soundId: 'ScoreUpdate',
                volumeMinMax: 0.1,
            },
            StartLevel: {
                soundId: 'Whoosh',
                volumeMinMax: 0.15,
            },
            Coin1: {
                soundId: 'Coin2',
                volumeMinMax: [0.15, 0.2],
                pitchMinMax: [0.8, 1.2],
            },
            PieceConnected: {
                soundId: 'Bubbles',
                volumeMinMax: [0.15, 0.2],
                pitchMinMax: [0.8, 1],
            },
            PuzzleCompleted: {
                soundId: 'Positive Open',
                volumeMinMax: 0.1,
            },
            GameOverAppear: {
                soundId: 'Applause Cheering',
                volumeMinMax: 0.1,
            },
            PreviewOverAppear: {
                soundId: 'Synth-Appear-01',
                volumeMinMax: 0.1,
            },
            PieceRotate: {
                soundId: 'Hover',
                volumeMinMax: [0.15, 0.2],
                pitchMinMax: [0.8, 1],
            },
            RenderSection: {
                soundId: 'Hover',
                volumeMinMax: [0.15, 0.2],
                pitchMinMax: [0.8, 1],
            },
            RenderSectionDetail: {
                soundId: 'Hover',
                volumeMinMax: [0.15, 0.2],
                pitchMinMax: [0.8, 1],
            }
        }
    } satisfies Record<string, Record<string, SoundAsset>>;

    static readonly Offsets = {
        UI: {
            Header: { x: 0, y: 25 }
        }
    }
    static readonly Paddings = {
        UI: {
            Header: { left: 30, top: 30, right: 30, bottom: 30 }
        }
    } as const;
    static readonly Labels = {
        Hot: 'Popular',
        New: 'New!',
    }
    static readonly Textures = {
        Buttons: {
            Gold: "ResourceBar_Single_Btn_Yellow1",
            Blue: "ResourceBar_Single_Btn_Blue1",
            Red: "ResourceBar_Single_Btn_Red1",
            Green: "ResourceBar_Single_Btn_Green1",
            Grey: "ResourceBar_Single_Btn_Grey",
            Orange: "ResourceBar_Single_Btn_Orange1",
        },
        Icons: {
            Coin: "ResourceBar_Single_Icon_Coin",
            Gem: "ResourceBar_Single_Icon_Gem",
            Up: "up",
            Video: "ItemIcon_Video",
            Down: "down",
            Back: "Icon_Back",
            Check: "Icon_Check03_s",
            Finger: "handHud",
            // Check: "Toggle_Check_Single_Icon",
            CheckItem: "Icon_Check03_s",
            Pill: "Label_Badge01_Yellow",
            SoundOn: "PictoIcon_Music_1",
            SoundOff: "PictoIcon_Music_1_Off",
            Badge1: "Label_Badge01_Red",
            Badge2: "Label_Badge01_Purple",
            Home: "PictoIcon_Home_1",
            Eye: "eye",
        },
        UI: {
            NextCardBackground: "ItemFrame01_Single_Yellow",
            //NextCardBackground: "ItemFrame01_Single_Navy",
            EndRibbon: "BubbleFrame01_Hexagon_Bg_Green",
            Shine: "Image_Effect_Rotate",
            Header: "ItemFrame01_Single_Hologram1",
            CardBg: "Button_SkillBtn_Blue",
            RowBg: "Button_SkillBtn_Orange",
            RowLock: "Button_SkillBtn_Dark",
            FadeShape: "Slider_Basic01_Bg_Single",
        }
    } as const;

    // 2. Helper method to keep code clean
    static getTexture(key: string): PIXI.Texture {
        return PIXI.Texture.from(key);
    }

    // 3. Font Styles
    // static readonly MainFont: Partial<PIXI.TextStyle> = {
    //     fontFamily: "LEMONMILK-Bold",
    //     fontSize: 28,
    //     fill: 0xffffff,
    //     stroke: "#4b2a19",
    //     strokeThickness: 4,
    // };

    static readonly MainFont: Partial<PIXI.TextStyle> = {
        fontFamily: "Sniglet-Regular",
        fontSize: 28,
        fontWeight: 'bold',
        fill: 0xffffff,
        stroke: "#1d1b1a",
        strokeThickness: 4,
        dropShadow: true,
        dropShadowAngle: Math.PI / 2,
        dropShadowDistance: 2,
        letterSpacing: 2,

        miterLimit: 1
    };

    static readonly MainFontTitle: Partial<PIXI.TextStyle> = {
        fontFamily: "Ourland",
        fontSize: 42,
        fill: 0xffffff,
        stroke: "#1d1b1a",
        strokeThickness: 4,
        dropShadow: true,
        dropShadowAngle: Math.PI / 2,
        dropShadowDistance: 2,
        letterSpacing: 2,
        miterLimit: 1
    };
}