
import { BasePopup, PopupData } from '@core/popup/BasePopup';
import { ExtractTiledFile } from '@core/tiled/ExtractTiledFile';
import TiledLayerObject from '@core/tiled/TiledLayerObject';
import BaseButton from '@core/ui/BaseButton';
import { TimerConversionUtils } from '@core/utils/TimeConversionUtils';
import { gsap } from 'gsap';
import * as PIXI from 'pixi.js';
import MatchManager from '../2048/scene/MatchManager';
import { Piece } from '../2048/view/Piece';
import GameplayCharacterData from '../character/GameplayCharacterData';
import { Fonts } from '../character/Types';
interface GameOverPopupData extends PopupData {
    matchManager: MatchManager;
}

export class GameOverPopup extends BasePopup {

    private highestPiece: Piece = new Piece();

    private moves!: PIXI.BitmapText;
    private scoreText!: PIXI.BitmapText;
    private autoOfMoves!: PIXI.BitmapText;
    private timer!: PIXI.BitmapText;


    private layout: TiledLayerObject = new TiledLayerObject();

    constructor() {
        super();

        this.layout.build(ExtractTiledFile.getTiledFrom('2048')!, ['GameOverPopup'])
        this.addChild(this.layout);


        const background = this.layout.findFromProperties('id', 'background');
        if (background && background.view) {
            background.view.tint = 0xFC8492
        }
        const highest = this.layout.findFromProperties('id', 'highest-piece');
        if (highest) {

            highest.view?.addChild(this.highestPiece)

            this.highestPiece.build(highest.object.width, highest.object.height)
            this.highestPiece.reset(2, GameplayCharacterData.fetchById(0));
        }


        const yoffset = - 8
        const title = this.layout.findFromProperties('id', 'title-label');
        if (title) {
            this.autoOfMoves = new PIXI.BitmapText('Out of moves', {
                fontName: Fonts.MainFamily,
                fontSize: Fonts.Main.fontSize as number,
                letterSpacing: 3,
                align: 'center'
            });
            this.autoOfMoves.anchor.set(0.5); // PIXI v7+ only
            title.view?.addChild(this.autoOfMoves);
            this.autoOfMoves.position.set(title.object.width / 2, title.object.height / 2);
        }

        const containerScore = this.layout.findFromProperties('id', 'points');
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



        const timer = this.layout.findFromProperties('id', 'timer');
        if (timer) {
            this.timer = new PIXI.BitmapText('0', {
                fontName: Fonts.MainFamily,
                letterSpacing: 3,
                align: 'center'
            });
            this.timer.anchor.set(0.5);
            timer.view?.addChild(this.timer);
            this.timer.position.set(timer.object.width / 2, timer.object.height / 2 + yoffset);
        }
        const moves = this.layout.findFromProperties('id', 'total-moves');
        if (moves) {
            this.moves = new PIXI.BitmapText('0', {
                fontName: Fonts.MainFamily,
                letterSpacing: 3,
                align: 'center'
            });
            this.moves.anchor.set(0.5);
            moves.view?.addChild(this.moves);
            this.moves.position.set(moves.object.width / 2, moves.object.height / 2 + yoffset);
        }
        const continueButton = this.layout.findFromProperties('id', 'continue');
        if (continueButton) {
            const button = new BaseButton({
                standard: {
                    width: continueButton.object.width,
                    height: continueButton.object.height,
                    allPadding: 35,
                    texture: PIXI.Texture.from('Button01_s_Blue'),
                    fontStyle: new PIXI.TextStyle({
                        fontFamily: 'LEMONMILK-Bold',
                        fill: 0xffffff,
                        stroke: "#0c0808",
                        strokeThickness: 4,
                    }),
                    fitText: 0.8
                },
                over: {
                    texture: PIXI.Texture.from('Button01_s_Purple'),
                },
                click: {
                    callback: () => {
                        this.popupManager.hideCurrent()
                    }
                }
            });
            button.setLabel('Continue')
            continueButton.view?.addChild(button)
        }


    }

    async transitionIn(data: GameOverPopupData): Promise<void> {
        // if (!data) return;

        const power = Math.log2(data.matchManager.highestPiece) - 1;
        this.highestPiece.reset(data.matchManager.highestPiece, GameplayCharacterData.fetchById(power));
        this.moves.text = data.matchManager.moveCounter.toString();
        this.scoreText.text = data.matchManager.matchPoints.toString();
        this.timer.text = TimerConversionUtils.toUncappedMinutesSeconds(data.matchManager.matchTimer * 1000)
        this.visible = true;
        this.alpha = 0;
        await gsap.to(this, { alpha: 1, duration: 0.3 });
    }

    transitionInComplete(): void {
        // Could play sound or dispatch an event here if needed
    }

    async transitionOut(): Promise<void> {
        await gsap.to(this, { alpha: 0, duration: 0.3 });
    }

    hide(): void {
        this.visible = false;
        this.alpha = 0;
    }

    update(delta: number): void {
        // Not needed for this popup, but required by interface
    }
}
