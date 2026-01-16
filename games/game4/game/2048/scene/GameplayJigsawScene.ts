import { Game } from "@core/Game";
import PlatformHandler from "@core/platforms/PlatformHandler";
import { PopupManager } from "@core/popup/PopupManager";
import { GameScene } from "@core/scene/GameScene";
import { ExtractTiledFile } from "@core/tiled/ExtractTiledFile";
import TiledAutoPositionObject from "@core/tiled/TiledAutoPositionObject";
import * as PIXI from 'pixi.js';
import { Signal } from "signals";
import GameplayCharacterData from "../../character/GameplayCharacterData";
// import SwipeInputManager from "../../io/SwipeInputManager";
import JigsawView from "../../jigsaw/JigsawView";
import { MaskedTabsGenerator } from "../../jigsaw/MaskedTabsGenerator";
import { ConfirmationPopupData } from "../../popup/ConfirmationPopup";
import { GlobalDataManager } from "../../scenes/data/GlobalDataManager";
import MainMenuUi from "../ui/MainMenuUi";
import ScoreUi from "../ui/ScoreUi";
import { SwipeHint } from "../ui/SwipeHint";
import TutorialDesktopUi from "../ui/TutorialDesktopUi";
import MatchManager from "./MatchManager";

export default class GameplayJigsawScene extends GameScene {

    private gameplayContainer = new PIXI.Container();
    // private inputManager!: SwipeInputManager;
    private isTransitioning = false;

    private matchManager: MatchManager = new MatchManager();
    public highScore = 0;
    private canAutoMove: boolean = false;
    private paused: boolean = false;

    private background: TiledAutoPositionObject = new TiledAutoPositionObject()
    private scoreUi!: ScoreUi;
    private mainMenu!: MainMenuUi;
    private tutorialDesktop!: TutorialDesktopUi;

    private jigsawBoardView: JigsawView = new JigsawView();


    private inputShape: PIXI.Sprite = PIXI.Sprite.from(PIXI.Texture.WHITE)

    public onQuit: Signal = new Signal();
    hint: SwipeHint;

    constructor() {
        super();


        if (ExtractTiledFile.TiledData) {
            // this.background.build(ExtractTiledFile.getTiledFrom('2048'), ['Background'])
            // this.addChild(this.background)

            this.mainMenu = new MainMenuUi(ExtractTiledFile.getTiledFrom('2048'), ['MainMenu']);
            //this.addChild(this.mainMenu);


            this.mainMenu.registerButton('Start', () => {
                this.startMatch();

            });

            this.mainMenu.registerButton('GameOver', () => {
                PopupManager.instance.show('gameOver', { matchManager: this.matchManager })
            })
            this.mainMenu.registerButton('Autoplay', () => {
                //this.autoplay();
            })
            // this.mainMenu.registerButton('Clear Cookies', () => {
            //     GlobalDataManager.wipe();
            // })
            // this.mainMenu.registerButton('Reset Game', () => {
            //     this.canAutoMove = false;
            //     //this.resetMatch();

            //     const confirmationData: ConfirmationPopupData = {
            //         title: 'Exit Match',
            //         description: 'Do you want quit?',
            //         cancelLabel: 'Confirm',
            //         confirmLabel: 'Cancel',
            //         onCancel: () => {
            //             this.quitGameScene();
            //             this.resetMatch();
            //         },
            //         onConfirm: () => {
            //         },
            //     }


            //     PopupManager.instance.show('confirm', confirmationData)
            // })

            this.scoreUi = new ScoreUi(ExtractTiledFile.getTiledFrom('2048'), ['ScoreMenu'])



            this.scoreUi.onQuit.add(() => {
                this.canAutoMove = false;
                //this.resetMatch();
                const confirmationData: ConfirmationPopupData = {
                    title: 'Exit Match',
                    description: 'Do you want quit?',
                    cancelLabel: 'Confirm',
                    confirmLabel: 'Cancel',
                    onCancel: () => {
                        this.quitGameScene();
                        this.resetMatch();
                    },
                    onConfirm: () => {
                    },
                }


                PopupManager.instance.show('confirm', confirmationData)
            })
            this.scoreUi.onRestart.add(() => {
                this.canAutoMove = false;
                //this.resetMatch();
                const confirmationData: ConfirmationPopupData = {
                    title: 'Restart Match',
                    description: 'Do you want restart?',
                    cancelLabel: 'Confirm',
                    confirmLabel: 'Cancel',
                    onCancel: () => {
                        this.resetMatch();
                        this.startMatch();
                    },
                    onConfirm: () => {
                    },
                }


                PopupManager.instance.show('confirm', confirmationData)
            })

            // this.tutorialDesktop = new TutorialDesktopUi(ExtractTiledFile.getTiledFrom('2048'), ['TutorialDesktop']);
            // if (!PIXI.isMobile.any) {
            //     //this.addChild(this.tutorialDesktop);
            // }

        }

        this.highScore = parseInt(GlobalDataManager.getData('meme_highscore') || '0');

        PopupManager.instance.onPopupEnd.add((popupId: string) => {
            if (popupId == 'gameOver') {
                this.paused = false;
                this.resetMatch();
                this.quitGameScene();
            }
        })
        PopupManager.instance.onPopupStart.add((popupId: string) => {
            if (popupId == 'gameOver') {
                this.paused = true;
            }
        })

        this.hint = new SwipeHint(PIXI.Texture.from('tutorial_hand_2'))
        GameplayCharacterData.setTable('monster')





        this.jigsawBoardView.onPieceConnected.add((e) => {
            console.log('piece', e)

            PlatformHandler.instance.platform.gameplayStart();

        })

        this.jigsawBoardView.onPuzzleCompleted.add(async (e) => {
            console.log('completed', e)

            this.jigsawBoardView.input?.setEnabled(false);
            await this.jigsawBoardView.snapCompletedPuzzleToSolvedPose({ duration: 0.8, ease: "power4.out" });
            this.jigsawBoardView.input?.setEnabled(true);

        })

        this.gameplayContainer.addChild(this.jigsawBoardView)


    }
    public quitGameScene() {
        this.onQuit.dispatch();
        PlatformHandler.instance.platform.gameplayStop();
    }
    public show(): void {
        this.startMatch();
    }

    private updateScoreText(points: number) {

        if (points > this.highScore) {
            this.highScore = points;
            GlobalDataManager.setData('meme_highscore', String(this.highScore));
        }

        this.scoreUi?.updateScores(points, this.highScore)
    }
    private gameOver() {
        PopupManager.instance.show('gameOver', { matchManager: null })
    }
    private resetMatch() {
        this.matchManager.reset()
        this.scoreUi.gameOver()

    }
    private startMatch() {
        this.matchManager.start();
        const img = PIXI.Sprite.from("link");


        const generator = new MaskedTabsGenerator();

        this.jigsawBoardView.buildFromSprite(this.gameplayContainer, img, generator, {
            cols: 4,
            rows: 3,
            scatterRect: new PIXI.Rectangle(-Game.DESIGN_WIDTH * 0.5, -Game.DESIGN_HEIGHT * 0.4, Game.DESIGN_WIDTH, Game.DESIGN_HEIGHT * 0.8),
            safeRect: new PIXI.Rectangle(-Game.DESIGN_WIDTH * 0.5 - 40, -Game.DESIGN_HEIGHT * 0.4 - 50, Game.DESIGN_WIDTH + 80, Game.DESIGN_HEIGHT * 0.8 + 100),
        });

        PlatformHandler.instance.platform.gameplayStart();
        // this.scoreUi.startMatch();
        // this.scoreUi.updateHighestPiece(2, GameplayCharacterData.fetchById(0)!);
    }
    public build(): void {


        this.updateScoreText(0)
        // this.inputManager = new SwipeInputManager();
        // this.inputManager.setShape(this.inputShape)
        // this.addChild(this.inputShape)
        // this.inputShape.alpha = 0;


        this.addChild(this.gameplayContainer);
        if (this.scoreUi)
            this.addChild(this.scoreUi)

        // this.inputManager.onMove.add(async (direction) => {
        //     if (this.isTransitioning) return;
        //     // if (this.hint.visible) {
        //     //     this.hint.hide();
        //     // }
        //     this.isTransitioning = true;
        //     //const moveResult = await this.gridManager.move(direction);
        //     //this.updateTurn(moveResult)
        //     this.isTransitioning = false;
        // });

        // this.addChild(this.hint)
        // this.hint.show()

    }


    public override destroy(): void {
        //this.inputManager.destroy();
    }

    public update(delta: number): void {
        this.gameplayContainer.x = Game.DESIGN_WIDTH / 2
        this.gameplayContainer.y = Game.DESIGN_HEIGHT / 2// + 120

        if (this.inputShape) {
            this.inputShape.width = this.gameplayContainer.width * 2
            this.inputShape.height = this.gameplayContainer.height * 2
            this.inputShape.x = this.gameplayContainer.x - this.gameplayContainer.width
            this.inputShape.y = this.gameplayContainer.y - this.gameplayContainer.height
        }

        // this.hint.x = this.gameplayContainer.x;
        // this.hint.y = this.gameplayContainer.y;
        if (this.paused) {
            return;
        }

        this.matchManager.update(delta)
        this.scoreUi.setTimer(this.matchManager.matchTimer);
    }
}
