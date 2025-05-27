import * as PIXI from 'pixi.js';
import { ExtratedTiledTileData, FlipStates, TiledObject } from './ExtractTiledFile';

export type TiledLayerTypes = PIXI.Container | PIXI.NineSlicePlane | PIXI.Sprite;
export type FoundTiledObject = { object: TiledObject, view?: TiledLayerTypes } | undefined;

export default class TiledLayerObject extends PIXI.Container {
    protected tiledLayerData!: ExtratedTiledTileData;
    protected tiledLayers: Map<string, { container: PIXI.Container, objects: TiledLayerTypes[] }> = new Map();
    protected tiledLayersProperties: Map<string, any> = new Map();
    public bounds = { width: 0, height: 0 };
    public localBounds = { width: 0, height: 0 };
    protected container: PIXI.Container;
    protected objectToView: Map<TiledObject, TiledLayerTypes | undefined> = new Map();
    constructor() {
        super();
        this.container = new PIXI.Container();
    }

    build(backgroundData: ExtratedTiledTileData, layers?: string[]): void {
        this.tiledLayerData = backgroundData;

        this.container.zIndex = -1;
        this.addChild(this.container);

        const filteredLayers = (layers && layers.length > 0)
            ? Array.from(this.tiledLayerData.layers.values()).filter(layer => layers.includes(layer.name))
            : Array.from(this.tiledLayerData.layers.values());

        filteredLayers.forEach(layerData => {
            const layer = new PIXI.Container();
            this.addChild(layer);

            const entities: TiledLayerTypes[] = [];

            layerData.objects?.forEach(obj => {
                this.objectToView.set(obj, undefined);

                const tilesets = Array.from(this.tiledLayerData.tilesets.values());
                const tileset = tilesets.find((ts, index) => {
                    const next = tilesets[index + 1];
                    const start = ts.firstgid;
                    const end = next ? next.firstgid : Number.POSITIVE_INFINITY;
                    return obj.gid >= start && obj.gid < end;
                });

                if (!tileset) {
                    const empty = new PIXI.Container();
                    this.container.addChild(empty);
                    empty.x = obj.x;
                    empty.y = obj.y;
                    this.objectToView.set(obj, empty);
                    return;
                }

                const tile = tileset.tiles[obj.gid - tileset.firstgid];
                const rotation = obj.rotation * Math.PI / 180;
                const texture = PIXI.Texture.from(tile.image);

                let sprite: TiledLayerTypes;

                const nineSliceSize = tile.properties?.nineSliced as number | undefined;

                if (nineSliceSize) {
                    sprite = new PIXI.NineSlicePlane(
                        texture,
                        nineSliceSize,
                        nineSliceSize,
                        nineSliceSize,
                        nineSliceSize
                    );
                    sprite.pivot.set(0, sprite.height);
                    sprite.width = obj.width;
                    sprite.height = obj.height;
                } else {
                    sprite = new PIXI.Sprite(texture);
                    (sprite as PIXI.Sprite).anchor.set(0, 1);
                    sprite.scale.x = obj.width / sprite.width;
                    sprite.scale.y = obj.height / sprite.height;
                }

                sprite.rotation = rotation;
                this.sortFlip(sprite, obj.flipStates);

                if (obj.flipStates?.horizontal) {
                    obj.x += sprite.width;
                }

                sprite.x = obj.x;
                sprite.y = obj.y;
                sprite.zIndex = -1;

                this.container.addChild(sprite);
                this.objectToView.set(obj, sprite);
                entities.push(sprite);

                this.localBounds.width = Math.max(this.localBounds.width, sprite.x + sprite.width);
                this.localBounds.height = Math.max(this.localBounds.height, sprite.y);
            });

            if (layerData.properties?.width && layerData.properties?.height) {
                this.bounds.width = layerData.properties.width;
                this.bounds.height = layerData.properties.height;
            } else {
                this.bounds.width = this.localBounds.width;
                this.bounds.height = this.localBounds.height;
            }

            this.tiledLayersProperties.set(layerData.name, layerData.properties);
            this.tiledLayers.set(layerData.name, {
                container: layer,
                objects: entities,
            });
        });

        const settings = backgroundData.settings?.properties;
        if (settings?.screenWidth && settings?.screenHeight) {
            this.bounds.width = settings.screenWidth;
            this.bounds.height = settings.screenHeight;
        }

        console.log(this.objectToView)
    }

    findFromProperties(propertyName: string, value: any): FoundTiledObject {
        for (const [obj, view] of this.objectToView.entries()) {
            if (obj.properties?.[propertyName] === value) {
                return { object: obj, view };
            }
        }
        return undefined;
    }

    sortFlip(view: TiledLayerTypes, flipStates: FlipStates): void {
        view.scale.x = flipStates.horizontal ? -Math.abs(view.scale.x) : Math.abs(view.scale.x);
        view.scale.y = flipStates.vertical ? -Math.abs(view.scale.y) : Math.abs(view.scale.y);
    }

    setOffset(x: number, y: number): void {
        this.container.x = x;
        this.container.y = y;
    }
}
