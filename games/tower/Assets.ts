import type { SoundAsset } from "core/audio/SoundManager";
import * as PIXI from "pixi.js";
export type { SoundAsset };

// export const SHOP_STYLE_CONFIG = {
//     Window: {
//         WIDTH: 540,
//         HEIGHT: 700,
//         Textures: {
//             CloseBtn: "btn_red_circle", // Replace with actual keys
//             CloseIcon: "icon_close"      // Replace with actual keys
//         }
//     }
// };
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
    /**
     * Background loops — played via SoundManager.instance.playBackgroundSound
     * on their own named layer (see BaseDemoScene.setFlowState), not as a
     * one-shot via Sounds/tryToPlaySound below. Music starts once at boot and
     * keeps looping for the whole session; Gameplay is a second, independent
     * layer that fades in on top once the player joins — Music ducks to
     * duckedVolume rather than stopping, so the two blend instead of
     * hard-swapping.
     */
    static readonly AmbientSound = {
        Music: {
            soundId: 'music',
            layer: 'music',
            masterVolume: 0.05,
            duckedVolume: 0.015,
        },
        Gameplay: {
            soundId: 'ocean-ambient',
            layer: 'ambient',
            masterVolume: 0.05,
        },
    }

    /**
     * Boost isn't a one-shot — it's a hum that should loop for as long as the
     * boost is actually held, then stop (see PlayerEntity.setBoosting()).
     * Played through the same named-layer loop mechanism as AmbientSound
     * above (SoundManager.instance.playBackgroundSound(..., 0, layer) /
     * .stopLayer(layer, fadeMs)) rather than Sounds/tryToPlaySound, which is
     * fire-and-forget and can't be stopped mid-play.
     */
    static readonly BoostLoop = {
        soundId: 'ocean-ambient',
        layer: 'boost',
        volume: 0.08,
    }

    /**
     * One-shot SFX, played via SoundManager.instance.tryToPlaySound(Assets.Sounds.Game.X).
     * Each entry is a SoundAsset: soundId can be a single clip or a pool of
     * variants (a random one is picked per play — use this for frequent
     * actions like Merge/Grab so repeats don't sound identical), plus
     * optional volume/pitch jitter ranges.
     *
     * lowDown / pepSound3-5 / phaserUp2 are the only SFX clips currently in
     * games/clog/raw-assets/audio — several entries below intentionally
     * reuse the same clip at a different volume/pitch (e.g. Grab reuses
     * Merge's pool, Kill reuses it again lower/heavier, GameOver reuses
     * Killed's clip slower/lower) as placeholders. Swap in dedicated clips
     * per action as real audio comes in; the manifest
     * (games/clog/manifests/audio.json) just needs the new alias added.
     */
    static readonly Sounds = {
        Game: {
            /** A tail cube (or the player) doubles in value — see PlayerEntity's merge onDone callbacks. */
            Wee: {
                soundId: ['hpp-yay1', 'hpp-yay2', 'hpp-yay3', 'hpp-yay4'],
                volumeMinMax: [0.05, 0.03],
                pitchMinMax: [0.6, 0.85],
            },
            /** Picking up loose food, or nibbling a cube off another entity's tail — see PlayerEntity.collect(). */
            Grab: {
                soundId: ['pepSound3', 'pepSound5'],
                volumeMinMax: [0.08, 0.12],
                pitchMinMax: [1.05, 1.25],
            },
            Drop: {
                soundId: ['drop'],
                volumeMinMax: [0.08, 0.12],
                pitchMinMax: [0.8, 1.1],
            },
            Whoosh: {
                soundId: ['Whoosh'],
                volumeMinMax: [0.08, 0.12],
                pitchMinMax: [0.8, 1.1],
            },
            Impact: {
                soundId: ['impactSoft_medium_000', 'impactSoft_medium_001', 'impactSoft_medium_002', 'impactSoft_medium_003', 'impactSoft_medium_004'],
                volumeMinMax: [0.15, 0.12],
                pitchMinMax: [1.05, 1.25],
            },
            /** The real player's head eats another entity's head — see PlayerEntity.notifyKill() / EntityEating.ts. */
            Kill: {
                soundId: ['pepSound3', 'pepSound4', 'pepSound5'],
                volumeMinMax: [0.2, 0.28],
                pitchMinMax: [0.7, 0.85],
            },
            /** Entering the next room through its gate — linear/gated mode only, see LinearWorld3dScene.onTransition. */
            GateOpen: {
                soundId: 'diamond-sparkle',
                volumeMinMax: 0.15,
                pitchMinMax: [0.95, 1.05],
            },
            /** Spawn/revive invincibility grant — see PlayerEntity.grantSpawnInvincibility(). */
            Invincible: {
                soundId: 'pepSound3',
                volumeMinMax: 0.08,
                pitchMinMax: [1.3, 1.5],
            },
            /** The real player just got eaten (death, not the later End Game screen — see Sounds.Game.GameOver) — see BaseDemoScene's death detection. */
            Killed: {
                soundId: 'lowDown',
                volumeMinMax: 0.2,
            },
            /** The End Game / final-rank screen actually appears (after the death countdown lapses or "Next" is tapped) — see BaseDemoScene's showDeath onEndGame callback. */
            GameOver: {
                soundId: 'lowDown',
                volumeMinMax: 0.28,
                pitchMinMax: [0.75, 0.85],
            },
            EndGame: {
                //soundId: 'Applause-Cheering',
                soundId: 'phaserUp2',
                volumeMinMax: 0.18,
                pitchMinMax: [0.95, 1],
            },
        },
        UI: {
            /** Generic button-press feedback — see the various dom-ui/*.ts and ui-dom/*.ts button factories. */
            Tap: {
                soundId: 'Tap',
                volumeMinMax: 0.08,
                pitchMinMax: [1.3, 1.4],
            },
        },
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
        Particles: {
            Star: 'PictoIcon_Star_1'
        },
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
            Settings: "Icon_Setting",
            Critter: "ItemIcon_Video",
            CritterUp: "critter-up",
            Egg: "egg",
            Coin: "ResourceBar_Single_Icon_Coin - Copy",
            CoinPileSmall: "coin-small-pile",
            CoinPileLarge: "coin-pile",
            Gem: "ResourceBar_Single_Icon_Gem",
            GemPile: "ShopItem_s_GemPack_1",
            Up: "up",
            Down: "down",
            Star: "ItemIcon_Star_Gold",
            GiftFast: "presentFast",
            Gift1: "present1",
            Gift2: "present2",
            Gift3: "present3",
            Gift4: "present4",
            Gift5: "present5",
            Shop: "ItemIcon_Shop",
            Back: "Icon_Back",
            Check: "Icon_Check03_s",
            Lock: "Icon_Lock01_s",
            Close: "Icon_Close02",
            Reset: "Icon_Close02",
            Hint: "eye",
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
            Home: "Icon_MapPoint_old",
            Refresh: "PictoIcon_Refresh_3",
            ArrowLeft: "arrow-left",
            ArrowRight: "arrow-right",
            Eye: "eye",
            CollectionIcon: "ItemIcon_MemoPad",
        },
        Modifiers: {
            CoinFast: "speedModifier",
            SpawnFast: "modifier-faster",
            PassiveInconme: "moreCoin",
            TapGold: "goldenTap",
            MergeBonus: "goldMerge",
            MissionBonus: "missionUp",
        },
        UI: {
            MapPanel: "backMap",
            CollectionPanel: "Button01_s_Purple",
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
            CollectionRibbon: "Title_Ribbon01_Sky",
            Shine: "Image_Effect_Rotate",
            RadialBlur1: "Glow_Circle01",
            RadialBlur2: "Glow_Circle02",
            GoldenFrame: "BubbleFrame01_Hexagon_Bg_Yellow",
            BarBg: "Slider_Basic01_Bg_Single",
            BarFill: "Slider_Basic03_FillMask",
            FillColor: 0x3cf060,
            BlockerColor: 0x333366,
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
        fontFamily: "LEMONMILK-Regular",
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
        fontFamily: "LEMONMILK-Bold",
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
