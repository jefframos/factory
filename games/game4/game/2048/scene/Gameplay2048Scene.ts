import { Game } from "@core/Game";
import PlatformHandler from "@core/platforms/PlatformHandler";
import { PopupManager } from "@core/popup/PopupManager";
import { GameScene } from "@core/scene/GameScene";
import { ExtractTiledFile } from "@core/tiled/ExtractTiledFile";
import TiledAutoPositionObject from "@core/tiled/TiledAutoPositionObject";
import * as PIXI from 'pixi.js';
import { Signal } from "signals";
import GameplayCharacterData from "../../character/GameplayCharacterData";
import SwipeInputManager from "../../io/SwipeInputManager";
import JigsawView from "../../jigsaw/JigsawView";
import { MaskedTabsGenerator } from "../../jigsaw/MaskedTabsGenerator";
import { ConfirmationPopupData } from "../../popup/ConfirmationPopup";
import { GlobalDataManager } from "../../scenes/data/GlobalDataManager";
import MainMenuUi from "../ui/MainMenuUi";
import ScoreUi from "../ui/ScoreUi";
import { SwipeHint } from "../ui/SwipeHint";
import TutorialDesktopUi from "../ui/TutorialDesktopUi";
import { MovementResult } from "./GridManager";

export default class Gameplay2048Scene extends GameScene {

    private gameplayContainer = new PIXI.Container();
    private inputManager!: SwipeInputManager;
    private isTransitioning = false;


    public highScore = 0;
    private canAutoMove: boolean = false;
    private paused: boolean = false;

    private background: TiledAutoPositionObject = new TiledAutoPositionObject()
    private scoreUi!: ScoreUi;
    private mainMenu!: MainMenuUi;
    private tutorialDesktop!: TutorialDesktopUi;


    private inputShape: PIXI.Sprite = PIXI.Sprite.from(PIXI.Texture.WHITE)

    public onQuit: Signal = new Signal();
    hint: SwipeHint;

    constructor() {
        super();


        if (ExtractTiledFile.TiledData) {
            this.background.build(ExtractTiledFile.getTiledFrom('2048'), ['Background'])
            this.addChild(this.background)

            this.mainMenu = new MainMenuUi(ExtractTiledFile.getTiledFrom('2048'), ['MainMenu']);
            //this.addChild(this.mainMenu);


            this.mainMenu.registerButton('Start', () => {
                this.startMatch();

            });

            this.mainMenu.registerButton('GameOver', () => {
                //PopupManager.instance.show('gameOver', { matchManager: this.matchManager })
            })
            this.mainMenu.registerButton('Autoplay', () => {
                this.autoplay();
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

        const board = new JigsawView();

        const img = PIXI.Sprite.from("link");
        const generator = new MaskedTabsGenerator();

        board.buildFromSprite(this.gameplayContainer, img, generator, {
            cols: 7,
            rows: 5,
            scatterRect: new PIXI.Rectangle(-450, -300, 900, 600),
        });

        board.onPieceConnected.add((e) => {
            console.log('piece', e)

        })

        board.onPuzzleCompleted.add((e) => {
            console.log('completed', e)

        })

        this.gameplayContainer.addChild(board)


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
        this.scoreUi.gameOver()

    }
    private startMatch() {

        this.scoreUi.startMatch();
        this.scoreUi.updateHighestPiece(2, GameplayCharacterData.fetchById(0)!);
    }
    public build(): void {


        this.updateScoreText(0)
        this.inputManager = new SwipeInputManager();
        this.inputManager.setShape(this.inputShape)
        this.addChild(this.inputShape)
        this.inputShape.alpha = 0;


        this.addChild(this.scoreUi)
        this.addChild(this.gameplayContainer);

        this.inputManager.onMove.add(async (direction) => {
            if (this.isTransitioning) return;
            // if (this.hint.visible) {
            //     this.hint.hide();
            // }
            this.isTransitioning = true;
            //const moveResult = await this.gridManager.move(direction);
            //this.updateTurn(moveResult)
            this.isTransitioning = false;
        });

        // this.addChild(this.hint)
        // this.hint.show()

    }
    private updateTurn(moveResult: MovementResult) {
        if (moveResult.isValid) {
            PlatformHandler.instance.platform.gameplayStart();
        }


    }


    public override destroy(): void {
        this.inputManager.destroy();
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
        //this.scoreUi.setTimer(this.matchManager.matchTimer);
    }
}
