import { ExtratedTiledTileData } from './ExtractTiledFile';
import TiledAutoPositionObject, { PinSettings, ScaleSettings } from './TiledAutoPositionObject';
export default class AutoPositionTiledContainer extends TiledAutoPositionObject {
    constructor(backgroundData: ExtratedTiledTileData, layers?: string[], scaleSettings?: ScaleSettings, pinSettings?: PinSettings) {
        super()
        this.build(backgroundData, layers, scaleSettings, pinSettings);
    }


}