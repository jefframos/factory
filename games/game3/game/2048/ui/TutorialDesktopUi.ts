import AutoPositionTiledContainer from '@core/tiled/AutoPositionTiledContainer';
import { ExtratedTiledTileData } from '@core/tiled/ExtractTiledFile';
import { ScaleMode } from '@core/tiled/TiledAutoPositionObject';
import * as PIXI from 'pixi.js';

export default class TutorialDesktopUi extends AutoPositionTiledContainer {


    constructor(mainMenuData: ExtratedTiledTileData, layers?: string[]) {
        super(mainMenuData, layers, { scaleMode: ScaleMode.FIT, matchRatio: 0 }, { pinAnchor: new PIXI.Point(0.5, 1) });


    }


}
