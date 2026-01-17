import { Game } from "@core/Game";
import PlatformHandler from "@core/platforms/PlatformHandler";
import { PopupManager } from "@core/popup/PopupManager";
import { GameScene } from "@core/scene/GameScene";
import { ExtractTiledFile } from "@core/tiled/ExtractTiledFile";
import * as PIXI from "pixi.js";
import { Signal } from "signals";

import JigsawView from "../../jigsaw/JigsawView";
import { MaskedTabsGenerator } from "../../jigsaw/MaskedTabsGenerator";
import { ConfirmationPopupData } from "../../popup/ConfirmationPopup";
import { GlobalDataManager } from "../../scenes/data/GlobalDataManager";

import ViewUtils from "@core/utils/ViewUtils";
import { SectionDefinition } from "games/game4/types";
import { ProgressCookieStore } from "../../jigsaw/ProgressCookieStore";
import { LevelSelectMediator, PlayLevelRequest } from "../../jigsaw/progress/LevelSelectMediator";
import { LevelSelectView } from "../../jigsaw/ui/LevelSelectView";
import { createDefaultLevelSelectTheme } from "../../jigsaw/ui/LevelSelectViewElements";
import { makeResizedSpriteTexture } from "../../jigsaw/vfx/imageFlatten";
import MainMenuUi from "../ui/MainMenuUi";
import ScoreUi from "../ui/ScoreUi";
import MatchManager from "./MatchManager";

export default class GameplayJigsawScene extends GameScene {
    public destroy(): void {
        throw new Error("Method not implemented.");
    }

    public readonly onQuit: Signal = new Signal();

    private readonly gameplayContainer: PIXI.Container = new PIXI.Container();

    private readonly matchManager: MatchManager = new MatchManager();
    private readonly jigsawBoardView: JigsawView = new JigsawView();
    private readonly jigsawGenerator: MaskedTabsGenerator = new MaskedTabsGenerator();

    private mainMenu?: MainMenuUi;
    private scoreUi?: ScoreUi;
    private mediator!: LevelSelectMediator;
    private levelSelectMenu?: LevelSelectView;

    private highScore: number = 0;
    private paused: boolean = false;

    private currentLevel?: PlayLevelRequest;

    // Popup event handlers stored so we can remove on destroy
    private readonly _onPopupEnd = (popupId: string) => {
        if (popupId === "gameOver") {
            this.paused = false;
            this.resetMatch();
            this.quitGameScene();
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

        this.addChild(this.gameplayContainer);

        if (this.scoreUi) {
            this.addChild(this.scoreUi);
        }

        // if (this.mainMenu) {
        //     this.addChild(this.mainMenu);
        // }


        const sections: SectionDefinition[] = [
            {
                id: "animals",
                name: "Animals",
                coverLevelId: "animals_01",
                levels: [
                    { id: "animals_01", sectionId: "animals", name: "Puzzle 1", thumb: 'meme1', imageSrc: this.game.folderPath + '/images/non-preload/puzzles/meme1.png' },
                    { id: "animals_02", sectionId: "animals", name: "Puzzle 2", thumb: 'meme2', imageSrc: this.game.folderPath + '/images/non-preload/puzzles/meme2.png' }
                ]
            },
            {
                id: "space",
                name: "Space",
                coverLevelId: "space_02",
                levels: [
                    { id: "space_01", sectionId: "space", name: "Puzzle 1", thumb: 'meme1', imageSrc: this.game.folderPath + '/images/non-preload/puzzles/meme1.png' },
                    { id: "space_02", sectionId: "space", name: "Puzzle 2", thumb: 'meme2', imageSrc: this.game.folderPath + '/images/non-preload/puzzles/meme2.png' }
                ]
            },
            {
                id: "space2",
                name: "Space2",
                coverLevelId: "space_02",
                levels: [
                    { id: "space_01", sectionId: "space", name: "Puzzle 1", thumb: 'meme1', imageSrc: this.game.folderPath + '/images/non-preload/puzzles/meme1.png' },
                    { id: "space_02", sectionId: "space", name: "Puzzle 2", thumb: 'meme2', imageSrc: this.game.folderPath + '/images/non-preload/puzzles/meme2.png' }
                ]
            },
            {
                id: "space3",
                name: "Space3",
                coverLevelId: "space_02",
                levels: [
                    { id: "space_01", sectionId: "space", name: "Puzzle 1", thumb: 'meme1', imageSrc: this.game.folderPath + '/images/non-preload/puzzles/meme1.png' },
                    { id: "space_02", sectionId: "space", name: "Puzzle 2", thumb: 'meme2', imageSrc: this.game.folderPath + '/images/non-preload/puzzles/meme2.png' }
                ]
            }
        ];

        const store = new ProgressCookieStore("jg_progress_v1", 1);
        this.mediator = new LevelSelectMediator(store);
        this.mediator.setSections(sections);

        const theme = createDefaultLevelSelectTheme();
        this.levelSelectMenu = new LevelSelectView(this.mediator, theme, 500, 300);

        // 4) UI -> Game
        this.mediator.onPlayLevel.add((req) => {
            // req.levelId, req.difficulty, req.level.payload etc.
            // Start your jigsaw game scene with that data.
            console.log("PLAY", req);

            this.startMatch(req);
        });

        this.gameplayContainer.addChild(this.levelSelectMenu)
    }

    public show(): void {
        // Main menu visible by default; play will start match.
    }

    public update(delta: number): void {
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

        this.scoreUi.visible = false;
    }

    private setupPopups(): void {
        PopupManager.instance.onPopupEnd.add(this._onPopupEnd);
        PopupManager.instance.onPopupStart.add(this._onPopupStart);
    }


    private showQuitConfirm(): void {
        const confirmationData: ConfirmationPopupData =
        {
            title: "Exit Match",
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

            PlatformHandler.instance.platform.gameplayStart();
        });

        this.jigsawBoardView.onPuzzleCompleted.add(async () => {
            this.jigsawBoardView.input?.setEnabled(false);
            if (this.currentLevel) {
                this.mediator.reportLevelCompleted(this.currentLevel?.levelId, this.currentLevel?.difficulty, this.matchManager.matchTimer);
            }
            await this.jigsawBoardView.snapCompletedPuzzleToSolvedPose({ duration: 0.8, ease: "power4.out" });
            this.jigsawBoardView.input?.setEnabled(true);


            PopupManager.instance.show("gameOver", { matchManager: this.matchManager });
        });
    }

    private async startMatch(data: PlayLevelRequest): Promise<void> {
        this.matchManager.start();

        this.currentLevel = data;

        const image = await PIXI.Assets.load(data.level.imageSrc)
        const srcSprite = PIXI.Sprite.from(image);

        // 2-4) render to RT and get a new sprite that *has* a 300x300 texture
        const scale = ViewUtils.elementScaler(srcSprite, 500, 500)
        const resizedSprite = makeResizedSpriteTexture(
            Game.renderer,    // or app.renderer
            srcSprite,
            srcSprite.width * scale,
            srcSprite.height * scale
        );

        let col = 1
        let row = 1
        if (data.difficulty == "easy") {
            col = 3
            row = 3
        } else if (data.difficulty == "medium") {
            col = PIXI.isMobile ? 5 : 6
            row = PIXI.isMobile ? 5 : 6
        } else {
            col = PIXI.isMobile ? 7 : 9
            row = PIXI.isMobile ? 7 : 9
        }

        this.jigsawBoardView.buildFromSprite(this.gameplayContainer, resizedSprite, this.jigsawGenerator, {
            cols: col,
            rows: row,
            allowRation: true,
            scatterRect: this.getScatterRect(),
            safeRect: this.getSafeRect(),
        });

        PlatformHandler.instance.platform.gameplayStart();

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
    }

    // -------------------------
    // Layout / rect helpers
    // -------------------------

    private layout(): void {
        // Center gameplay container
        this.gameplayContainer.x = Game.DESIGN_WIDTH / 2;
        this.gameplayContainer.y = Game.DESIGN_HEIGHT / 2;


    }

    private updateSafeAreaFromOverlay(): void {
        const cappedSize = Math.min(Game.overlayScreenData.width, 1024)
        this.levelSelectMenu?.setSize(cappedSize, Game.overlayScreenData.height)
        if (this.levelSelectMenu) {

            this.levelSelectMenu.x = -this.gameplayContainer.x + Game.gameScreenData.center.x - cappedSize / 2;
            this.levelSelectMenu.y = -this.gameplayContainer.y + Game.gameScreenData.topLeft.y;
        }

        this.jigsawBoardView.updateSafeAre(
            Game.overlayScreenData.topLeft.x - this.gameplayContainer.x,
            Game.overlayScreenData.topLeft.y - this.gameplayContainer.y,
            Game.overlayScreenData.width,
            Game.overlayScreenData.height
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
