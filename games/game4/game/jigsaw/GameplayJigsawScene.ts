import { Game } from "@core/Game";
import PlatformHandler from "@core/platforms/PlatformHandler";
import { PopupManager } from "@core/popup/PopupManager";
import { GameScene } from "@core/scene/GameScene";
import { ExtractTiledFile } from "@core/tiled/ExtractTiledFile";
import * as PIXI from "pixi.js";
import { Signal } from "signals";

import { ConfirmationPopupData } from "../popup/ConfirmationPopup";
import { GlobalDataManager } from "../scenes/data/GlobalDataManager";
import JigsawView from "./JigsawView";
import { MaskedTabsGenerator } from "./MaskedTabsGenerator";

import SoundManager from "@core/audio/SoundManager";
import ViewUtils from "@core/utils/ViewUtils";
import { LevelDefinition } from "games/game4/types";
import PatternBackground from "../../../../core/ui/PatternBackground";
import SoundToggleButton from "../../../../core/ui/SoundToggleButton";
import MatchManager from "../2048/scene/MatchManager";
import MainMenuUi from "../2048/ui/MainMenuUi";
import ScoreUi from "../2048/ui/ScoreUi";
import { DevGuiManager } from "../utils/DevGuiManager";
import Assets from "./Assets";
import { InGameEconomy } from "./data/InGameEconomy";
import { ProgressCookieStore } from "./data/ProgressCookieStore";
import { PuzzleDataBuilder, PuzzleMasterJson } from "./data/PuzzleCatalogParser";
import StaticData from "./data/StaticData";
import { LevelSelectMediator, PlayLevelRequest, PurchaseLevelRequest } from "./progress/LevelSelectMediator";

import { CurrencyHud } from "./ui/CurrencyHud";
import { LevelSelectView } from "./ui/LevelSelectView";
import { createDefaultLevelSelectTheme } from "./ui/LevelSelectViewElements";
import { makeResizedSpriteTexture } from "./vfx/imageFlatten";

export default class GameplayJigsawScene extends GameScene {
    public destroy(): void {
        throw new Error("Method not implemented.");
    }

    public static FLOATING_LEVEL: LevelDefinition | undefined;
    public readonly onQuit: Signal = new Signal();

    private readonly gameplayContainer: PIXI.Container = new PIXI.Container();

    private readonly matchManager: MatchManager = new MatchManager();
    private readonly jigsawBoardView: JigsawView = new JigsawView();
    private readonly jigsawGenerator: MaskedTabsGenerator = new MaskedTabsGenerator();

    private background: PIXI.Sprite = PIXI.Sprite.from('main-bg')

    private mainMenu?: MainMenuUi;
    private scoreUi?: ScoreUi;
    private mediator!: LevelSelectMediator;
    private levelSelectMenu?: LevelSelectView;

    private highScore: number = 0;
    private paused: boolean = false;
    private currencyHud!: CurrencyHud;

    private currentLevel?: PlayLevelRequest;
    private soundToggleButton?: SoundToggleButton;
    private store: ProgressCookieStore = new ProgressCookieStore("jg_progress_v1", 1);

    private patternBackground!: PatternBackground;
    // Popup event handlers stored so we can remove on destroy
    private readonly _onPopupEnd = (popupId: string) => {
        if (popupId === "gameOver") {
            this.paused = false;
            this.resetMatch();
            if (GameplayJigsawScene.FLOATING_LEVEL) {
                this.startMatchFromLevel(GameplayJigsawScene.FLOATING_LEVEL)
                GameplayJigsawScene.FLOATING_LEVEL = undefined
            } else {

                this.quitGameScene();
            }
        }
    };

    private readonly _onPopupStart = (popupId: string) => {
        if (popupId === "gameOver") {
            this.paused = true;
        }
    };

    public constructor(game: Game) {
        super(game);

        this.highScore = parseInt(GlobalDataManager.getData("meme_highscore") || "0", 10);

        this.setupUi();
        this.setupPopups();
        this.setupJigsawSignals();

        this.gameplayContainer.addChild(this.jigsawBoardView);

    }

    public build(): void {
        this.updateScoreUi(0);

        //const color = 0x00BFA5

        if (Game.debugParams.autoWipe) {
            this.store.resetGameProgress()
        }

        this.patternBackground = new PatternBackground({ background: 0x26C6DA, patternAlpha: 0.2, patternPath: 'game4/images/non-preload/jiggy-pattern.png' });
        this.addChild(this.patternBackground);
        this.patternBackground.init()

        //this.addChild(this.background)

        this.addChild(this.gameplayContainer);

        if (this.scoreUi) {
            this.addChild(this.scoreUi);
        }

        const master = PIXI.Assets.get("jiggy/puzzleData.json") as PuzzleMasterJson;

        const built = PuzzleDataBuilder.buildSections(master, this.game.folderPath + '/images/non-preload/puzzles');

        // console.log(built)
        const sections = built.sections;

        const sectionMeta = built.meta;

        StaticData.setData(built.sections);

        // // console.log(sections, sectionMeta)

        //const store = new ProgressCookieStore("jg_progress_v1", 1);
        DevGuiManager.instance.addButton('erase', () => {
            this.store.resetGameProgress(true);
        })

        DevGuiManager.instance.addButton('addCoins', () => {
            InGameEconomy.instance.addCurrency(100)
        })

        this.mediator = new LevelSelectMediator(this.store);
        this.mediator.setSections(sections);






        const theme = createDefaultLevelSelectTheme();
        this.levelSelectMenu = new LevelSelectView(this.mediator, theme, Game.DESIGN_WIDTH, 1024);


        // Assets.getTexture(T.Icons.Coin)
        this.currencyHud = new CurrencyHud({
            textStyle: new PIXI.TextStyle({
                ...Assets.MainFont, fontSize: 42,
                //strokeThickness: 8,
            }),
            currencyIcon: Assets.Textures.Icons.Coin,// 'ResourceBar_Single_Icon_Coin',
            specialCurrencyIcon: 'ResourceBar_Single_Icon_Gem',
            bgTexture: PIXI.Texture.from(Assets.Textures.UI.FadeShape),// PIXI.Texture.from('fade-shape'),
            bgNineSlice: { left: 10, top: 10, right: 10, bottom: 10 },
            padding: 20
        });

        this.currencyHud.x = 0; // Top left corner
        this.levelSelectMenu.headerView.root.addChild(this.currencyHud);
        this.currencyHud.y = theme.headerHeight / 2 - this.currencyHud.height / 2 + Assets.Offsets.UI.Header.y;

        // // console.log(this.levelSelectMenu.headerView)


        this.mediator.onPurchaseLevel.add((req: PurchaseLevelRequest) => {
            // 1) check currency / IAP
            // 2) if success:
            this.mediator.confirmPurchase(req.levelId);
            Assets.tryToPlaySound(Assets.Sounds.UI.Purchase)

        });

        // 4) UI -> Game
        this.mediator.onPlayLevel.add((req) => {
            // req.levelId, req.difficulty, req.level.payload etc.
            // Start your jigsaw game scene with that data.
            // // console.log("PLAY", req);
            Assets.tryToPlaySound(Assets.Sounds.UI.StartLevel)

            this.startMatch(req);
        });


        if (Game.debugParams.start) {
            this.startMatch()
        }



        if (ProgressCookieStore.isFirstTime() || Game.debugParams.first) {

            const s = 0
            const l = 0
            const request: PlayLevelRequest = {
                difficulty: "easy",
                level: sections[s].levels[l],
                levelId: sections[s].levels[l].id,
                section: sections[s],
                allowRotation: false
            }
            this.currentLevel = request
            this.startMatch(request, true)
            setTimeout(() => {
                if (this.levelSelectMenu) {
                    this.gameplayContainer.addChild(this.levelSelectMenu)
                }
            }, 500);


        } else {
            this.gameplayContainer.addChild(this.levelSelectMenu)

        }
        SoundManager.instance.playBackgroundSound(Assets.AmbientSound.AmbientSoundId, 0)
        SoundManager.instance.setMasterAmbientVolume(Assets.AmbientSound.AmbientMasterVolume)

        if (Game.debugParams.over) {
            setTimeout(() => {
                this.completePuzzle()
            }, (10));
            //PopupManager.instance.show("gameOver", { matchManager: this.matchManager });
        }

        // Assuming your textures are loaded in the PIXI Assets cache
        this.soundToggleButton = new SoundToggleButton(Assets.Textures.Icons.SoundOn, Assets.Textures.Icons.SoundOff);

        this.soundToggleButton.x = 50;
        this.soundToggleButton.y = theme.headerHeight / 2 + Assets.Offsets.UI.Header.y;
        //this.soundToggleButton.scale.x = -1

        this.levelSelectMenu.headerView.root.addChild(this.soundToggleButton);

        sections.forEach(section => {
            section.levels.forEach(level => {
                if (level.unlockCost === 0) {
                    // console.log(level)

                    this.mediator.confirmPurchase(level.id);
                }
            });
        });


    }
    public startMatchFromLevel(LevelDefinition: LevelDefinition) {
        const request: PlayLevelRequest = {
            difficulty: "easy",
            level: LevelDefinition,
            levelId: LevelDefinition.id,
            section: StaticData.getSectionById(LevelDefinition.sectionId),
            allowRotation: true
        }
        this.startMatch(request, false)

    }
    public show(): void {
        // Main menu visible by default; play will start match.
    }

    public update(delta: number): void {

        this.patternBackground.update(delta);
        this.jigsawBoardView.update(delta);

        this.layout();


        if (this.paused) {
            return;
        }

        this.updateSafeAreaFromOverlay();
        this.matchManager.update(delta);


        this.scoreUi?.setTimer(this.matchManager.matchTimer);
    }


    // -------------------------
    // UI / Popups
    // -------------------------

    private setupUi(): void {
        if (!ExtractTiledFile.TiledData) {
            return;
        }

        const tiled = ExtractTiledFile.getTiledFrom("2048")!;

        this.mainMenu = new MainMenuUi(tiled, ["MainMenu"]);
        this.mainMenu.registerButton("Start", () => {
            this.startMatch(this.currentLevel);
        });

        // Future menu options can be added here.

        this.scoreUi = new ScoreUi(tiled, ["ScoreMenu"]);

        this.scoreUi.onQuit.add(() => {
            this.showQuitConfirm();
        });

        this.scoreUi.onRestart.add(() => {
            this.showRestartConfirm();
        });

        this.scoreUi.onPreview.add(() => {
            this.jigsawBoardView.showPreview();
        });
        this.scoreUi.visible = false;
    }

    private setupPopups(): void {
        PopupManager.instance.onPopupEnd.add(this._onPopupEnd);
        PopupManager.instance.onPopupStart.add(this._onPopupStart);
    }


    private showQuitConfirm(): void {
        const confirmationData: ConfirmationPopupData =
        {
            title: "Exit Puzzle",
            description: "Do you want quit?",
            cancelLabel: "Confirm",
            confirmLabel: "Cancel",
            onCancel: () => {
                this.quitGameScene();
                this.resetMatch();
            },
            onConfirm: () => {
            },
        };

        PopupManager.instance.show("confirm", confirmationData);
    }

    private showRestartConfirm(): void {
        const confirmationData: ConfirmationPopupData =
        {
            title: "Restart Match",
            description: "Do you want restart?",
            cancelLabel: "Confirm",
            confirmLabel: "Cancel",
            onCancel: () => {
                this.resetMatch();
                this.startMatch(this.currentLevel);
            },
            onConfirm: () => {
            },
        };

        PopupManager.instance.show("confirm", confirmationData);
    }

    // -------------------------
    // Jigsaw signals / gameplay
    // -------------------------

    private setupJigsawSignals(): void {
        this.jigsawBoardView.onPieceConnected.add(() => {
            this.matchManager.incrementMove();
            this.scoreUi?.updateScores(this.matchManager.moveCounter, 0);

            Assets.tryToPlaySound(Assets.Sounds.UI.PieceConnected)


            PlatformHandler.instance.platform.gameplayStart();
        });

        this.jigsawBoardView.onPuzzleCompleted.add(async () => {
            this.completePuzzle();
        })

    }

    private async completePuzzle() {
        this.jigsawBoardView.input?.setEnabled(false);
        this.jigsawBoardView.puzzleCompleted();

        Assets.tryToPlaySound(Assets.Sounds.UI.PuzzleCompleted)
        let rewardAmount = 0;


        // console.log(this.currentLevel, this.currentLevel?.levelId, this.store)



        if (this.currentLevel) {

            // //console.log(this.currentLevel.level)
            // 1. Determine the prize amount based on difficulty
            const prizes = !this.currentLevel.level.isSpecial ? this.currentLevel.level.prize : this.currentLevel.level.prizesSpecial;
            const diffMapping: Record<string, number> = { "easy": 0, "medium": 1, "hard": 2 };
            const prizeIndex = diffMapping[this.currentLevel.difficulty] ?? 0;
            rewardAmount = prizes[prizeIndex];

            // 2. Report completion to save progress/time
            this.mediator.reportLevelCompleted(
                this.currentLevel.levelId,
                this.currentLevel.difficulty,
                this.matchManager.matchTimer
            );

            // 3. Award the currency via the Economy Singleton
            if (rewardAmount > 0) {
                InGameEconomy.instance.addCurrency(rewardAmount, false);
                // //console.log(`Awarded ${rewardAmount} coins for ${this.currentLevel.difficulty} difficulty.`);
            }
        }


        const nextToPlay = StaticData.getNextAvailableLevel(this.currentLevel?.levelId, (id) => {
            return this.store.isLevelUnlocked(this.mediator.getProgress(), id);
        });

        if (nextToPlay) {
            // console.log("Redirecting player to:", nextToPlay);
        }

        await this.jigsawBoardView.snapCompletedPuzzleToSolvedPose({ duration: 0.8, ease: "power4.out" });
        this.jigsawBoardView.input?.setEnabled(true);


        //await PromiseUtils.await(1000)
        Assets.tryToPlaySound(Assets.Sounds.UI.GameOverAppear)


        PopupManager.instance.show("gameOver", { matchManager: this.matchManager, rewardAmount: rewardAmount || 0, isSpecial: this.currentLevel?.level.isSpecial, nextPuzzle: nextToPlay });
    };


    private async startMatch(data?: PlayLevelRequest, isFirst: boolean = false): Promise<void> {
        this.matchManager.start();

        //SoundManager.instance.playBackgroundSound(Assets.AmbientSound.AmbientSoundGameplay, 0)
        //SoundManager.instance.setMasterAmbientVolume(Assets.AmbientSound.AmbientMasterVolumeGameplay)


        this.currentLevel = data;

        const image = await PIXI.Assets.load(data?.level.imageSrc || this.game.folderPath + '/images/non-preload/puzzles/meme1.png')
        const srcSprite = PIXI.Sprite.from(image);

        // 2-4) render to RT and get a new sprite that *has* a 300x300 texture
        const scale = ViewUtils.elementScaler(srcSprite, Game.DESIGN_WIDTH - 50, Game.DESIGN_HEIGHT - 100)
        const resizedSprite = makeResizedSpriteTexture(
            Game.renderer,    // or app.renderer
            srcSprite,
            srcSprite.width * scale,
            srcSprite.height * scale
        );

        const width = srcSprite.width;
        const height = srcSprite.height;
        const ratio = width / height;

        // 1. Define target total pieces instead of hardcoded grids
        let targetPieces = 12; // Default (easy)
        const difficulty = data?.difficulty || "medium";

        if (difficulty === "medium") {
            targetPieces = PIXI.isMobile ? 25 : 36;
        } else if (difficulty === "hard") {
            targetPieces = PIXI.isMobile ? 49 : 81;
        }

        // 2. Calculate ideal columns and rows to maintain square-ish pieces
        // Formula: cols = sqrt(totalPieces * ratio)
        let col = Math.max(1, Math.round(Math.sqrt(targetPieces * ratio)));
        let row = Math.max(1, Math.round(targetPieces / col));

        // 3. Final adjustment: ensure we are as close to targetPieces as possible
        // and that we have at least 1 row/col.
        const total = col * row;

        this.jigsawBoardView.buildFromSprite(this.gameplayContainer, resizedSprite, this.jigsawGenerator, {
            cols: col,
            rows: row,
            allowRation: data?.allowRotation,
            scatterRect: this.getScatterRect(),
            safeRect: this.getSafeRect(),
            isFirst
        });


        this.jigsawBoardView.showPreview();

        setTimeout(() => {
            this.jigsawBoardView.hidePreview();
        }, 1800);


        if (this.scoreUi) {
            this.scoreUi.visible = true;
        }

        if (this.levelSelectMenu) {
            this.levelSelectMenu.visible = false;
        }
    }

    private resetMatch(): void {
        this.matchManager.reset();

        // Use whichever method you standardized on for cleanup.
        (this.jigsawBoardView as any).wipe?.();
        (this.jigsawBoardView as any).dispose?.();

        if (this.scoreUi) {
            this.scoreUi?.gameOver?.();
            this.scoreUi.visible = false;
        }

        if (this.levelSelectMenu) {
            this.levelSelectMenu.visible = true;
        }

        this.updateScoreUi(0);
    }

    private quitGameScene(): void {
        this.onQuit.dispatch();
        PlatformHandler.instance.platform.gameplayStop();

        //SoundManager.instance.playBackgroundSound(Assets.AmbientSound.AmbientSoundId, 0)
        //SoundManager.instance.setMasterAmbientVolume(Assets.AmbientSound.AmbientMasterVolume)
    }

    // -------------------------
    // Layout / rect helpers
    // -------------------------

    private layout(): void {
        // Center gameplay container
        this.patternBackground.x = Game.DESIGN_WIDTH / 2;
        this.patternBackground.y = Game.DESIGN_HEIGHT / 2;

        this.gameplayContainer.x = Game.DESIGN_WIDTH / 2;
        this.gameplayContainer.y = Game.DESIGN_HEIGHT / 2;


        this.background.anchor.set(0.5, 0.5)
        this.background.x = Game.DESIGN_WIDTH / 2;
        this.background.y = Game.DESIGN_HEIGHT / 2;



        this.background.scale.set(ViewUtils.elementEvelop(this.background, Game.gameScreenData.width, Game.gameScreenData.height))


    }

    private updateSafeAreaFromOverlay(): void {
        const cappedSize = Math.min(Game.overlayScreenData.width, 1024)
        //this.levelSelectMenu?.setSize(cappedSize, Game.overlayScreenData.height)
        this.levelSelectMenu?.setHeight(Game.overlayScreenData.height)
        if (this.currencyHud) this.currencyHud.x = Game.DESIGN_WIDTH - this.currencyHud.width - 120
        if (this.soundToggleButton)

            if (this.soundToggleButton) {
                this.soundToggleButton.x = Game.DESIGN_WIDTH - this.soundToggleButton.width
                //this.soundToggleButton.y = 40
            }

        if (this.levelSelectMenu) {

            this.levelSelectMenu.x = -Game.DESIGN_WIDTH / 2//this.gameplayContainer.x - Game.overlayScreenData.width / 2;
            this.levelSelectMenu.y = -this.gameplayContainer.y + Game.gameScreenData.topLeft.y + 10;
        }

        this.jigsawBoardView.updateSafeAre(
            Game.overlayScreenData.topLeft.x - this.gameplayContainer.x - 75,
            Game.overlayScreenData.topLeft.y - this.gameplayContainer.y + 100,
            Game.overlayScreenData.width + 150,
            Game.overlayScreenData.height - 25
        );
    }

    private getScatterRect(): PIXI.Rectangle {
        return new PIXI.Rectangle(
            Game.overlayScreenData.topLeft.x - this.gameplayContainer.x,
            Game.overlayScreenData.topLeft.y - this.gameplayContainer.y + 150,
            Game.overlayScreenData.width,
            Game.overlayScreenData.height - 150
        );
    }

    private getSafeRect(): PIXI.Rectangle {
        return new PIXI.Rectangle(
            -Game.DESIGN_WIDTH * 0.5 - 40,
            -Game.DESIGN_HEIGHT * 0.4 - 50,
            Game.DESIGN_WIDTH + 80,
            Game.DESIGN_HEIGHT * 0.8 + 100
        );
    }

    private updateScoreUi(points: number): void {
        if (points > this.highScore) {
            this.highScore = points;
            GlobalDataManager.setData("meme_highscore", String(this.highScore));
        }

        this.scoreUi?.updateScores(points, this.highScore);
    }
}
