import AutoPositionTiledContainer from '@core/tiled/AutoPositionTiledContainer';
import { ExtratedTiledTileData } from '@core/tiled/ExtractTiledFile';
import { ScaleMode } from '@core/tiled/TiledAutoPositionObject';
import BaseButton from '@core/ui/BaseButton';
import { TimerConversionUtils } from '@core/utils/TimeConversionUtils';
import ViewUtils from '@core/utils/ViewUtils';
import * as PIXI from 'pixi.js';
import { Signal } from 'signals';
import { PieceViewData } from '../../character/Types';
import Assets from '../../jigsaw/Assets';
import SoundToggleButton from '../../jigsaw/ui/SoundToggleButton';
import { Piece } from '../view/Piece';
export default class ScoreUi extends AutoPositionTiledContainer {

    private moves!: PIXI.Text;
    private scoreText!: PIXI.Text;
    private highScore!: PIXI.Text;
    private timer!: PIXI.Text;
    private highestPiece: Piece = new Piece();

    private badge!: PIXI.Container;
    private best!: PIXI.BitmapText;
    private quitButton!: BaseButton;

    public onQuit: Signal = new Signal()
    public onRestart: Signal = new Signal()
    public onPreview: Signal = new Signal()

    constructor(mainMenuData: ExtratedTiledTileData, layers?: string[]) {
        super(mainMenuData, layers, { scaleMode: ScaleMode.FIT, matchRatio: 0 }, { pinAnchor: new PIXI.Point(0.5, 0) });
        const yoffset = - 8
        const containerScore = this.findAndGetFromProperties('id', 'current-score');
        if (containerScore) {
            this.scoreText = new PIXI.Text('0', { ...Assets.MainFont });
            this.scoreText.anchor.set(0.5); // PIXI v7+ only
            containerScore.view?.addChild(this.scoreText);
            this.scoreText.position.set(containerScore.object.width / 2, containerScore.object.height / 2 + yoffset);
        }

        const containerHighscore = this.findAndGetFromProperties('id', 'highscore');
        if (containerHighscore) {
            this.highScore = new PIXI.Text('0', { ...Assets.MainFont });
            this.highScore.anchor.set(0.5);
            ViewUtils.centerBitmapText(this.highScore, containerHighscore.object.width, containerHighscore.object.height)
            containerHighscore.view?.addChild(this.highScore);
            this.highScore.position.set(containerHighscore.object.width / 2, containerHighscore.object.height / 2 + yoffset);
        }

        const timer = this.findAndGetFromProperties('id', 'timer');
        if (timer) {
            this.timer = new PIXI.Text('0', { ...Assets.MainFont, align: 'left' });
            this.timer.anchor.set(0, 0.5);
            timer.view?.addChild(this.timer);
            this.timer.position.set(0, timer.object.height / 2);
        }
        const moves = this.findAndGetFromProperties('id', 'moves');
        if (moves) {
            this.moves = new PIXI.Text('0', { ...Assets.MainFont });
            this.moves.anchor.set(1, 0.5);
            moves.view?.addChild(this.moves);
            this.moves.position.set(moves.object.width, moves.object.height / 2 + yoffset);
        }

        const highest = this.findAndGetFromProperties('id', 'highest');
        if (highest) {

            highest.view?.addChild(this.highestPiece)
            this.highestPiece.position.set(highest.object.width / 2, highest.object.height / 2 + yoffset);

            this.highestPiece.build(highest.object.width, highest.object.height)
            this.highestPiece.reset(-1);
        }

        const badge = this.findAndGetFromProperties('id', 'badge')
        if (badge) {
            this.badge = badge.view!
        }

        this.findAndGetByName('best').then((best) => {
            if (best?.view) {
                this.best = best.view as PIXI.BitmapText;
            }
        })


        const left = this.findAndGetFromProperties('id', 'home-button');
        this.quitButton = new BaseButton({
            standard: {
                width: left?.object.width,
                height: left?.object.height,
                allPadding: 35,
                texture: PIXI.Texture.from(Assets.Textures.Buttons.Red),
                fontStyle: new PIXI.TextStyle({ ...Assets.MainFont }),

                //iconTexture: PIXI.Texture.from('Icon_Back'),
                iconTexture: PIXI.Texture.from(Assets.Textures.Icons.Home),
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



        const restart = this.findAndGetFromProperties('id', 'restart');
        const restartButton = new BaseButton({
            standard: {
                width: restart?.object.width,
                height: restart?.object.height,
                allPadding: 35,
                texture: PIXI.Texture.from('bt-red'),
                fontStyle: new PIXI.TextStyle({
                    fontFamily: 'LEMONMILK-Bold',
                    fill: 0xffffff,
                    stroke: "#0c0808",
                    strokeThickness: 4,
                }),

                //iconTexture: PIXI.Texture.from('Icon_Back'),
                iconTexture: PIXI.Texture.from('Icon_Back'),
                iconSize: { width: restart?.object.width * 0.6, height: restart?.object.height * 0.6 },
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








        const prev = this.findAndGetFromProperties('id', 'preview');
        const previewButton = new BaseButton({
            standard: {
                width: prev?.object.width,
                height: prev?.object.height,
                allPadding: 35,
                texture: PIXI.Texture.from(Assets.Textures.Buttons.Blue),

                //iconTexture: PIXI.Texture.from('Icon_Back'),
                iconTexture: PIXI.Texture.from(Assets.Textures.Icons.Eye),
                iconSize: { width: prev?.object.width * 0.6, height: prev?.object.height * 0.6 },
                iconAnchor: new PIXI.Point(0, 0),
                centerIconVertically: true,
                centerIconHorizontally: true
            },
            over: {
                tint: 0xcccccc
            },
            click: {
                callback: () => {
                    this.onPreview.dispatch();
                }
            }
        });
        this.addAtId(previewButton, 'preview')

        const sound = this.findAndGetFromProperties('id', 'sound');
        const soundButton = new SoundToggleButton(Assets.Textures.Icons.SoundOn, Assets.Textures.Icons.SoundOff)
        this.addAtId(soundButton, 'sound')
        soundButton.x += soundButton.width / 2
        soundButton.y += soundButton.height / 2
        // setTimeout(() => {

        //     this.hidePiece();
        // }, 1);

        // ShortcutManager.registerDevShortcut(['alt', 'o'], () => {
        //     PixiExportUtils.exportContainerAsImage(this.highestPiece, this.highestPiece.width, this.highestPiece.height, 'my-export.png');

        // }, '')
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
        setTimeout(() => {
            this.highestPiece.visible = true;
            this.best.visible = true;
            this.badge.visible = true;
        }, 1);
    }
    startMatch() {
        this.highestPiece.visible = true;
        this.showPiece();
        this.setMoves(0);
    }

    private currentHighestPiece: number = -1;
    updateHighestPiece(highestPiece: number, viewData: PieceViewData) {
        this.highestPiece.reset(highestPiece, viewData)
        if (this.currentHighestPiece != highestPiece) {
            this.highestPiece.upgrade()
        }
        this.currentHighestPiece = highestPiece;
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