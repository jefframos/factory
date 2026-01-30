import SoundManager from "@core/audio/SoundManager";
import * as PIXI from "pixi.js";
export interface SoundAsset {
    soundId: string | string[];
    volumeMinMax?: [number, number] | number,
    pitchMinMax?: [number, number] | number
}


export default class MergeAssets {
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
        Game: {
            Notification: {
                // soundId: ['hpp-yay1', 'hpp-yay2', 'hpp-yay3', 'hpp-yay4'],
                soundId: ['Bonus Highlights'],
                volumeMinMax: 0.2,
                pitchMinMax: [0.9, 1]
            },
            Yay: {
                // soundId: ['hpp-yay1', 'hpp-yay2', 'hpp-yay3', 'hpp-yay4'],
                soundId: ['Cat Meow Angry 01', 'Cat Meow Angry 02'],
                volumeMinMax: 0.7,
                pitchMinMax: [0.8, 1.2]
            },
            Meow: {
                // soundId: ['hpp-yay1', 'hpp-yay2', 'hpp-yay3', 'hpp-yay4'],
                soundId: ['Cat Meow 01', 'Cat Meow 02'],
                volumeMinMax: 0.2,
                pitchMinMax: [0.8, 1]
            },
            Egg: {
                soundId: ['hpp-increase20'],
                volumeMinMax: 0.07,
                pitchMinMax: [0.8, 1]
            },
            Grab: {
                soundId: ['grab (1)', 'grab (2)', 'grab (3)', 'grab (4)'],
                volumeMinMax: 0.1,
                pitchMinMax: [0.8, 1]
            },
            Drop: {
                soundId: ['drop'],
                volumeMinMax: 0.1,
                pitchMinMax: [0.7, 1]
            },
            Merge: {
                soundId: ['hpp-yay1', 'hpp-yay2', 'hpp-yay3', 'hpp-yay4'],
                volumeMinMax: 0.3,
                pitchMinMax: [0.9, 1]
            },
            Coin: {
                soundId: 'Coin2',
                volumeMinMax: [0.1, 0.15],
                pitchMinMax: [0.8, 1.2],
            },
        },
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
                volumeMinMax: [0.1, 0.15],
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
        NextEntity: 'Next Cat',
        EntityShop: 'Cats',
        EntityCardPrefix: 'Cat'
    }
    // static readonly Colors = [
    //     ["#ED1C24"], // 1: Red (Primary)
    //     ["#F7941D"], // 2: Orange (Primary)
    //     ["#FFF200"], // 3: Yellow (Primary)
    //     ["#00A651"], // 4: Green (Square)
    //     ["#2E3192"], // 5: Blue (Star)
    //     ["#8C6239", "#FFFFFF"], // 6: Purple/Indigo (Dice spots)
    //     ["#ED1C24", "#F7941D", "#FFF200", "#00A651", "#2E3192", "#662D91"], // 7: Rainbow
    //     ["#FF7BAC"], // 8: Pink (Octoblock)
    //     ["#92278F"], // 9: Light Purple (Square)
    //     ["#FFFFFF", "#ED1C24"], // 10: White with Red border
    //     ["#ED1C24", "#FBB03B"], // 11: Red/Gold (Football/Soccer theme)
    //     ["#F7941D", "#FBB03B"], // 12: Orange/Yellow (The Rectangle)
    //     ["#FFF200", "#000000"], // 13: Yellow/Black (Unlucky/Cleansweep)
    //     ["#00A651", "#ED1C24"], // 14: Green/Red (Skater)
    //     ["#2E3192", "#FFFFFF", "#ED1C24"], // 15: Blue/White/Red (Agent)
    //     ["#00A651", "#FFFFFF"], // 16: Square (Green tints)
    //     ["#FFFF00", "#ED1C24"], // 17: Painting theme (Yellow/Red)
    //     ["#FF7BAC", "#2E3192"], // 18: Pink/Blue (Super Speed)
    //     ["#92278F", "#FFFFFF"], // 19: Purple/White (Artist)
    //     ["#F7941D", "#FFFFFF"], // 20: Orange/White (Large base)
    //     ["#ED1C24", "#FFD700"], // 21: Red/Gold (Explorer)
    //     ["#F7941D", "#2E3192"], // 22: Orange/Blue
    //     ["#FFF200", "#662D91"], // 23: Yellow/Purple
    //     ["#00A651", "#F7941D"]  // 24: Green/Orange (Super Rectangle)
    // ]

    static CatColors = [
        ["#ffffff", "#a8e5ff"], // 1: Red Tabby (Primary Red + White paws)
        ["#fb7378", "#FFFFFF"], // 1: Red Tabby (Primary Red + White paws)
        ["#F7941D", "#8C6239"], // 2: Ginger Marmalade (Orange + Dark Brown stripes)
        ["#FFF200", "#F7941D"], // 3: Calico Base (Yellowish-Cream + Orange patches)
        ["#00A651", "#FFFFFF"], // 4: Lucky Jade Cat (Green + White belly)
        ["#2E3192", "#92278F"], // 5: Blue Russian (Deep Blue + Purple sheen)
        ["#8C6239", "#fffdfd", "#4f4f4f"], // 6: Siamese (Brown + White + Black points)
        ["#ED1C24", "#F7941D", "#FFF200", "#00A651", "#2E3192", "#662D91"], // 7: Prism/Rainbow Cat
        ["#FF7BAC", "#FFFFFF"], // 8: Pink Sphynx (Soft Pink + White wrinkles)
        ["#92278F", "#2E3192"], // 9: Galaxy Cat (Purple + Deep Blue swirls)
        ["#FFFFFF", "#ED1C24"], // 10: White Van Cat (White + Red tail/ears)
        ["#ED1C24", "#FBB03B", "#565656"], // 11: Bengal Tiger (Red-Orange + Gold + Black stripes)
        ["#F7941D", "#FBB03B"], // 12: Golden Abyssinian (Orange + Gold ticked fur)
        ["#FFF200", "#5e5e5e"], // 13: "Bad Luck" Black Cat (Yellow eyes + Black fur)
        ["#00A651", "#ED1C24", "#FFFFFF"], // 14: Wild Jungle Cat (Green + Red camo + White)
        ["#2E3192", "#FFFFFF", "#ED1C24"], // 15: Tuxedo Agent (Blue-Black + White chest + Red bowtie)
        ["#00A651", "#FFFFFF", "#FBB03B"], // 16: Emerald-Eyed Birman (Green + White + Gold)
        ["#FFFF00", "#ED1C24", "#8C6239"], // 17: Tortoiseshell (Yellow + Red + Brown patches)
        ["#FF7BAC", "#2E3192", "#FFFFFF"], // 18: Bubblegum Maine Coon (Pink + Blue + White mane)
        ["#92278F", "#FFFFFF"], // 19: Lavender Persian (Soft Purple + White fluff)
        ["#F7941D", "#FFFFFF", "#8C6239"], // 20: Patchwork Chimera (Orange + White + Brown)
        ["#ED1C24", "#FFD700"], // 21: Royal Egyptian Mau (Crimson + Gold jewelry)
        ["#F7941D", "#2E3192", "#686868"], // 22: Sunset Jaguar (Orange + Blue-tinted spots)
        ["#FFF200", "#662D91"], // 23: Mystic Moon Cat (Bright Yellow + Deep Purple aura)
        ["#00A651", "#F7941D", "#FFD700"]  // 24: Celestial Lion (Green + Orange mane + Gold flecks)
    ];
    static readonly Textures = {
        Buttons: {
            Gold: "ResourceBar_Single_Btn_Yellow1",
            Blue: "ResourceBar_Single_Btn_Blue1",
            Red: "ResourceBar_Single_Btn_Red1",
            Green: "ResourceBar_Single_Btn_Green1",
            Grey: "ResourceBar_Single_Btn_Grey",
            Orange: "ResourceBar_Single_Btn_Orange1",
        },
        Extras: {
            CatBody: "cat-body",
            CatLines: "cat-lines",
            CatBodies: ["cat-shape-1", "cat-shape-2", "cat-shape-3", "cat-shape-4"],
            Mats: ["mat-1", "mat-2", "mat-3", "mat-4"],
        },
        Icons: {
            Video: "ItemIcon_Video",
            Critter: "critter",
            CritterUp: "critter-up",
            Egg: "egg",
            Coin: "ResourceBar_Single_Icon_Coin - Copy",
            CoinPileSmall: "coin-small-pile",
            CoinPileLarge: "coin-pile",
            Gem: "ResourceBar_Single_Icon_Gem",
            GemPile: "ShopItem_s_GemPack_1",
            Up: "up",
            Down: "down",
            Gift1: "present1",
            Gift2: "present2",
            Gift3: "present3",
            Gift4: "present4",
            Gift5: "present5",
            Shop: "ItemIcon_Shop",
            Back: "Icon_Back",
            Check: "Icon_Check03_s",
            Lock: "Icon_Lock01_s",
            Finger: "handHud",
            Speed: "ResourceBar_Single_Icon_Energy",
            // Check: "Toggle_Check_Single_Icon",
            CheckItem: "Icon_Check03_s",
            Timer: "Icon_Timer",
            BadgeMain: "Label_Badge01_Yellow",
            SoundOn: "PictoIcon_Music_1",
            SoundOff: "PictoIcon_Music_1_Off",
            Badge1: "Label_Badge01_Red",
            Badge2: "Label_Badge01_Purple",
            Home: "PictoIcon_Home_1",
            Eye: "eye",
        },
        UI: {
            BgLegendary: "Button01_s_Yellow",
            BgEpic: "Button01_s_PInk",
            BgRare: "Button01_s_Green",
            BgCommon: "Button01_s_DarkGray",
            CurrencyPanel: "Slider_Basic01_Bg_Single",
            //CurrencyPanel: "BannerFrame03_Single",
            MissionPanel: "ItemFrame01_Single_Navy",
            NotificationPanel: "ItemFrame01_Single_Purple",
            //NextCardBackground: "ItemFrame01_Single_Navy",
            EndRibbon: "Title_Ribbon01_Plum",
            Shine: "Image_Effect_Rotate",
            BarBg: "Slider_Basic01_Bg_Single",
            BarFill: "Slider_Basic03_FillMask",
            FillColor: 0x3cf060,
            LevelBadge: "Label_Badge01_Yellow",
            Header: "ItemFrame01_Single_Hologram1",
            Exclamation: "Icon_Exclamation",
            ShopBgActive: "Button_SkillBtn_Blue",
            ShopBgDisabled: "Button_SkillBtn_Dark",
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

export const SHOP_STYLE_CONFIG = {
    Window: {
        WIDTH: 600,
        HEIGHT: 900,
        TAB_HEIGHT: 60,
        SCROLL_AREA_HEIGHT: 760,
        CORNER_SIZE: 24,
        PADDING: { TOP: 20, BOTTOM: 20, LEFT: 20, RIGHT: 80 },
        Textures: {
            Background: MergeAssets.Textures.UI.RowLock,
            TabActive: MergeAssets.Textures.Buttons.Orange,
            CloseBtn: MergeAssets.Textures.Buttons.Red,
            CloseIcon: "Icon_Close02",
            NavBtn: MergeAssets.Textures.Buttons.Blue,
            NavDisabled: MergeAssets.Textures.Buttons.Grey,
        }
    },
    Item: {
        HEIGHT: 120,
        SPACING: 15,
        THUMB_SIZE: 90,
        BUTTON_WIDTH: 140,
        BUTTON_HEIGHT: 60,
        TEXT_OFFSET_X: 130,
        Textures: {
            RowBgActive: MergeAssets.Textures.UI.ShopBgActive,
            RowBg: MergeAssets.Textures.UI.ShopBgDisabled,
            BuyBtn: MergeAssets.Textures.Buttons.Green,
            BuyDisabled: MergeAssets.Textures.Buttons.Grey,
            LockIcon: MergeAssets.Textures.Icons.Lock,
        }
    }
};