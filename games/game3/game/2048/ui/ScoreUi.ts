import AutoPositionTiledContainer from '@core/tiled/AutoPositionTiledContainer';
import { ExtratedTiledTileData } from '@core/tiled/ExtractTiledFile';
import { ScaleMode } from '@core/tiled/TiledAutoPositionObject';
import BaseButton from '@core/ui/BaseButton';
import { PixiExportUtils } from '@core/utils/PixiExportUtils';
import ShortcutManager from '@core/utils/ShortcutManager';
import { TimerConversionUtils } from '@core/utils/TimeConversionUtils';
import ViewUtils from '@core/utils/ViewUtils';
import * as PIXI from 'pixi.js';
import { Signal } from 'signals';
import { Fonts } from '../../character/Types';
import { Piece } from '../view/Piece';
export default class ScoreUi extends AutoPositionTiledContainer {

    private moves!: PIXI.BitmapText;
    private scoreText!: PIXI.BitmapText;
    private highScore!: PIXI.BitmapText;
    private timer!: PIXI.BitmapText;
    private highestPiece: Piece = new Piece();

    private badge!: PIXI.Container;
    private best!: PIXI.BitmapText;
    private quitButton!: BaseButton;

    public onQuit: Signal = new Signal()
    public onRestart: Signal = new Signal()

    constructor(mainMenuData: ExtratedTiledTileData, layers?: string[]) {
        super(mainMenuData, layers, { scaleMode: ScaleMode.FIT, matchRatio: 0 }, { pinAnchor: new PIXI.Point(0.5, 0) });
        const yoffset = - 8
        const containerScore = this.findFromProperties('id', 'current-score');
        if (containerScore) {
            this.scoreText = new PIXI.BitmapText('0', {
                fontName: Fonts.MainFamily,
                fontSize: Fonts.Main.fontSize as number,
                letterSpacing: 3,
                align: 'center'
            });
            this.scoreText.anchor.set(0.5); // PIXI v7+ only
            containerScore.view?.addChild(this.scoreText);
            this.scoreText.position.set(containerScore.object.width / 2, containerScore.object.height / 2 + yoffset);
        }

        const containerHighscore = this.findFromProperties('id', 'highscore');
        if (containerHighscore) {
            this.highScore = new PIXI.BitmapText('0', {
                fontName: Fonts.MainFamily,
                fontSize: Fonts.Main.fontSize as number,
                letterSpacing: 3,
                align: 'center'
            });
            this.highScore.anchor.set(0.5);
            ViewUtils.centerBitmapText(this.highScore, containerHighscore.object.width, containerHighscore.object.height)
            containerHighscore.view?.addChild(this.highScore);
            this.highScore.position.set(containerHighscore.object.width / 2, containerHighscore.object.height / 2 + yoffset);
        }

        const timer = this.findFromProperties('id', 'timer');
        if (timer) {
            this.timer = new PIXI.BitmapText('0', {
                fontName: Fonts.MainFamily,
                letterSpacing: 3,
                fontSize: 24,
                align: 'right'
            });
            this.timer.anchor.set(1, 0.5);
            timer.view?.addChild(this.timer);
            this.timer.position.set(timer.object.width, timer.object.height / 2 + yoffset);
        }
        const moves = this.findFromProperties('id', 'moves');
        if (moves) {
            this.moves = new PIXI.BitmapText('0', {
                fontName: Fonts.MainFamily,
                letterSpacing: 3,
                fontSize: 24,
                align: 'right'
            });
            this.moves.anchor.set(1, 0.5);
            moves.view?.addChild(this.moves);
            this.moves.position.set(moves.object.width, moves.object.height / 2 + yoffset);
        }

        const highest = this.findFromProperties('id', 'highest');
        if (highest) {

            highest.view?.addChild(this.highestPiece)

            this.highestPiece.build(highest.object.width, highest.object.height)
            this.highestPiece.reset(-1);
        }

        const badge = this.findFromProperties('id', 'badge')
        if (badge) {
            this.badge = badge.view!
        }

        const best = this.findByName('best')
        if (best) {
            this.best = best.view!
        }


        const left = this.findFromProperties('id', 'home-button');
        this.quitButton = new BaseButton({
            standard: {
                width: left?.object.width,
                height: left?.object.height,
                allPadding: 35,
                texture: PIXI.Texture.from('Button01_s_Red'),
                fontStyle: new PIXI.TextStyle({
                    fontFamily: 'LEMONMILK-Bold',
                    fill: 0xffffff,
                    stroke: "#0c0808",
                    strokeThickness: 4,
                }),

                //iconTexture: PIXI.Texture.from('Icon_Back'),
                iconTexture: PIXI.Texture.from('PictoIcon_Home_1'),
                iconSize: { width: left?.object.width * 0.6, height: left?.object.height * 0.6 },
                iconAnchor: new PIXI.Point(0, 0.1),
                centerIconVertically: true,
                centerIconHorizontally: true
            },
            over: {
                tint: 0xcccccc
            },
            click: {
                callback: () => {
                    this.onQuit.dispatch();
                }
            }
        });
        this.addAtId(this.quitButton, 'home-button')



        const restart = this.findFromProperties('id', 'restart');
        const restartButton = new BaseButton({
            standard: {
                width: left?.object.width,
                height: left?.object.height,
                allPadding: 35,
                texture: PIXI.Texture.from('Button01_s_PInk'),
                fontStyle: new PIXI.TextStyle({
                    fontFamily: 'LEMONMILK-Bold',
                    fill: 0xffffff,
                    stroke: "#0c0808",
                    strokeThickness: 4,
                }),

                //iconTexture: PIXI.Texture.from('Icon_Back'),
                iconTexture: PIXI.Texture.from('Icon_Back'),
                iconSize: { width: left?.object.width * 0.6, height: left?.object.height * 0.6 },
                iconAnchor: new PIXI.Point(0, 0.1),
                centerIconVertically: true,
                centerIconHorizontally: true
            },
            over: {
                tint: 0xcccccc
            },
            click: {
                callback: () => {
                    this.onRestart.dispatch();
                }
            }
        });
        this.addAtId(restartButton, 'restart')


        this.hidePiece();

        ShortcutManager.registerDevShortcut(['alt', 'o'], () => {
            PixiExportUtils.exportContainerAsImage(this.highestPiece, this.highestPiece.width, this.highestPiece.height, 'my-export.png');

        }, '')
    }
    gameOver() {
        this.highestPiece.reset(-1)
        this.hidePiece();
        this.setMoves(0);

    }
    hidePiece() {
        this.highestPiece.visible = false;
        this.best.visible = false;
        this.badge.visible = false;
    }
    showPiece() {
        this.highestPiece.visible = true;
        this.best.visible = true;
        this.badge.visible = true;
    }
    startMatch() {
        this.highestPiece.visible = true;
        this.showPiece();
        this.setMoves(0);
    }


    updateHighestPiece(highestPiece: number, viewData: PieceViewData) {
        this.highestPiece.reset(highestPiece, viewData)

    }

    setTimer(matchTimer: number) {
        if (this.timer) {
            this.timer.text = TimerConversionUtils.toUncappedMinutesSeconds(matchTimer * 1000)
        }
    }

    setMoves(moves: number) {
        if (this.moves) {
            this.moves.text = moves.toString();
        }
    }

    updateScores(points: number, highScore: number) {
        if (this.scoreText) {
            this.scoreText.text = points.toString()
        }
        if (this.highScore) {
            this.highScore.text = highScore.toString()
        }
    }
}