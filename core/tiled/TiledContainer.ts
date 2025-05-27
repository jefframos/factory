import { ExtratedTiledTileData } from './ExtractTiledFile';
import TiledLayerObject from './TiledLayerObject';
export default class TiledContainer extends TiledLayerObject {
    constructor(backgroundData: ExtratedTiledTileData, layers?: string[]) {
        super()
        this.build(backgroundData, layers)
    }

}