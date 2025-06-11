import * as PIXI from 'pixi.js';
import { ExtratedTiledTileData } from './ExtractTiledFile';
import TiledAutoPositionObject, { PinSettings, ScaleMode, ScaleSettings } from './TiledAutoPositionObject';
import TiledLayerObject, { FoundTiledObject } from './TiledLayerObject';


export default class TiledGroup extends PIXI.Container {
    private layers: TiledLayerObject[] = [];

    constructor() {
        super();
    }

    public addLayer(backgroundData: ExtratedTiledTileData, layers?: string[]): TiledLayerObject {
        const layer = new TiledLayerObject();
        layer.build(backgroundData, layers);
        this.layers.push(layer);
        this.addChild(layer);
        return layer;
    }

    public addAutoPositionLayer(
        backgroundData: ExtratedTiledTileData,
        layers?: string[],
        scaleSettings: ScaleSettings = { scaleMode: ScaleMode.MATCH, matchRatio: 1 },
        pinSettings: PinSettings = {}
    ): TiledAutoPositionObject {
        const layer = new TiledAutoPositionObject();
        layer.build(backgroundData, layers, scaleSettings, pinSettings);
        this.layers.push(layer);
        this.addChild(layer);
        return layer;
    }


    public findFromProperties(propertyName: string, value: any): FoundTiledObject[] {
        const results: FoundTiledObject[] = [];

        for (const layer of this.layers) {
            const tiledObjects = layer.findAndGetFromProperties(propertyName, value)
            if (tiledObjects) {
                results.push(tiledObjects);
            }
        }

        return results;
    }
}
