
import AutoPositionTiledContainer from '@core/tiled/AutoPositionTiledContainer';
import { ExtratedTiledTileData } from '@core/tiled/ExtractTiledFile';
import { ScaleMode } from '@core/tiled/TiledAutoPositionObject';
import * as PIXI from 'pixi.js';
import { Fonts } from '../../character/Types';
import { GameManager } from '../manager/GameManager';

export default class GameplayHud extends PIXI.Container {
    public readonly hudRight: AutoPositionTiledContainer;
    public readonly hudLeft: AutoPositionTiledContainer;
    public readonly hudBottomLeft: AutoPositionTiledContainer;
    public readonly hudTopCenter: AutoPositionTiledContainer;

    constructor(uiSettings: ExtratedTiledTileData) {
        super();

        const gm = GameManager.instance;
        const level = gm.getLevelData();

        this.hudRight = new AutoPositionTiledContainer(
            uiSettings,
            ['HUD-Right'],
            { scaleMode: ScaleMode.MATCH, matchRatio: 1 },
            { pinAnchor: new PIXI.Point(1, 0) }
        );
        this.addChild(this.hudRight);

        this.hudLeft = new AutoPositionTiledContainer(
            uiSettings,
            ['HUD-Left'],
            { scaleMode: ScaleMode.MATCH, matchRatio: 1 },
            { pinAnchor: new PIXI.Point(0, 0) }
        );
        this.addChild(this.hudLeft);

        this.hudBottomLeft = new AutoPositionTiledContainer(
            uiSettings,
            ['HUD-BottomLeft'],
            { scaleMode: ScaleMode.MATCH, matchRatio: 1 },
            { pinAnchor: new PIXI.Point(0, 1) }
        );
        this.addChild(this.hudBottomLeft);

        this.hudTopCenter = new AutoPositionTiledContainer(
            uiSettings,
            ['HUD-TopCenter'],
            { scaleMode: ScaleMode.MATCH, matchRatio: 1 },
            { pinAnchor: new PIXI.Point(0.5, 0) }
        );
        this.addChild(this.hudTopCenter);


        this.hudRight.findFromProperties('id', 'current-money').then((obj) => {

            const currentSoftCurrency = new PIXI.BitmapText('0', {
                fontName: Fonts.MainFamily,
                fontSize: Fonts.Main.fontSize as number,
                align: 'right',
                letterSpacing: 2
            });
            currentSoftCurrency.text = level.soft.coins.value.toString();
            level.soft.coins.onChange.add((oldValue, newValue) => {
                currentSoftCurrency.text = newValue.toString();
            })
            obj?.view?.addChild(currentSoftCurrency)
            currentSoftCurrency.anchor.set(1, 0.5);
            currentSoftCurrency.x = (obj?.object?.width ?? 0) - 10;

        })


    }
}
