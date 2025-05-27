import AutoPositionTiledContainer from '@core/tiled/AutoPositionTiledContainer';
import { ExtratedTiledTileData } from '@core/tiled/ExtractTiledFile';
import { PinMode, ScaleMode } from '@core/tiled/TiledAutoPositionObject';
import * as PIXI from 'pixi.js';
import { Fonts } from '../character/Types';
export default class ScoreUi extends AutoPositionTiledContainer {

    private scoreText!: PIXI.Text;
    private highScore!: PIXI.Text;

    constructor(mainMenuData: ExtratedTiledTileData, layers?: string[]) {
        super(mainMenuData, layers, { scaleMode: ScaleMode.FIT, matchRatio: 0 }, { pinMode: PinMode.TOP });

        const containerScore = this.findFromProperties('id', 'current-score')
        if (containerScore) {
            this.scoreText = new PIXI.Text('0', { ...Fonts.Main } as Partial<PIXI.TextStyle>);
            this.scoreText.anchor.set(0.5);
            containerScore.view?.addChild(this.scoreText);

            this.scoreText.position.set(containerScore.object.width / 2, containerScore.object.height / 2);
        }

        const containerHighscore = this.findFromProperties('id', 'highscore')
        if (containerHighscore) {
            this.highScore = new PIXI.Text('0', { ...Fonts.Main } as Partial<PIXI.TextStyle>);
            this.highScore.anchor.set(0.5);
            containerHighscore.view?.addChild(this.highScore);
            this.highScore.position.set(containerHighscore.object.width / 2, containerHighscore.object.height / 2);
        }
    }


    updateScores(points: number, highScore: number) {
        if (this.scoreText) {
            this.scoreText.text = points
        }
        if (this.highScore) {
            this.highScore.text = highScore
        }
    }
}