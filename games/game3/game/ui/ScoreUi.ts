import TiledLayerObject from '@core/tiled/TiledLayerObject';
import * as PIXI from 'pixi.js';
import { Fonts } from '../character/Types';
export default class ScoreUi extends PIXI.Container {

    private layer!: TiledLayerObject;
    private scoreText!: PIXI.Text;
    private highScore!: PIXI.Text;
    constructor(layer: TiledLayerObject) {
        super()

        this.layer = layer;

        this.addChild(this.layer)

        this.scoreText = new PIXI.Text('0', { ...Fonts.Main } as Partial<PIXI.TextStyle>);
        this.scoreText.anchor.set(0.5);
        this.addChild(this.scoreText);

        this.highScore = new PIXI.Text('0', { ...Fonts.Main } as Partial<PIXI.TextStyle>);
        this.highScore.anchor.set(0.5);
        this.addChild(this.highScore);

        const containerScore = this.layer.findFromProperties('id', 'current-score')
        if (containerScore) {
            this.scoreText.position.set(containerScore.object.x + containerScore.object.width / 2, containerScore.object.y + containerScore.object.height / 2);
        }

        const containerHighscore = this.layer.findFromProperties('id', 'highscore')
        if (containerHighscore) {
            this.highScore.position.set(containerHighscore.object.x + containerHighscore.object.width / 2, containerHighscore.object.y + containerHighscore.object.height / 2);
        }
    }
    updateScores(points: number, highScore: number) {
        this.scoreText.text = points
        this.highScore.text = highScore
    }
    build() {

    }
    update(delta: number, unscaledTime: number) {
    }
}