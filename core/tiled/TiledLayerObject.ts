import * as PIXI from 'pixi.js';
import { ExtradedTiledTile, FlipStates, TiledLayer, TiledObject, TiledTileset } from './ExtractTiledFile';

export default class TiledLayerObject extends PIXI.Container {
    protected backgroundData!: { layers: Map<string, TiledLayer>, tilesets: Map<string, TiledTileset> };
    protected layers: Map<string, { container: PIXI.Container, objects: (PIXI.Sprite | PIXI.NineSlicePlane)[] }> = new Map();
    public bounds = { width: 0, height: 0 };
    public localBounds = { width: 0, height: 0 };
    protected container: PIXI.Container;
    protected scaleToFit: boolean = false;
    protected objectToView: Map<TiledObject, PIXI.Sprite | PIXI.NineSlicePlane | undefined> = new Map();

    constructor() {
        super();
        this.container = new PIXI.Container();
    }

    build(backgroundData: ExtradedTiledTile, layers?: string[], scaleToFit: boolean = false): void {
        this.backgroundData = backgroundData;
        this.scaleToFit = scaleToFit;

        this.container.zIndex = -1;
        this.addChild(this.container);

        const filteredLayers = (layers && layers.length > 0)
            ? Array.from(this.backgroundData.layers.values()).filter(layer => layers.includes(layer.name))
            : Array.from(this.backgroundData.layers.values());

        filteredLayers.forEach(layerData => {
            const layer = new PIXI.Container();
            this.addChild(layer);

            const entities: (PIXI.Sprite | PIXI.NineSlicePlane)[] = [];

            layerData.objects?.forEach(obj => {
                this.objectToView.set(obj, undefined);
                const tilesets = Array.from(this.backgroundData.tilesets.values());
                const tileset = tilesets.find((ts, index) => {
                    const next = tilesets[index + 1];
                    const start = ts.firstgid;
                    const end = next ? next.firstgid : Number.POSITIVE_INFINITY;
                    return obj.gid >= start && obj.gid < end;
                });
                if (!tileset) return;

                const tile = tileset.tiles[obj.gid - tileset.firstgid];
                const rotation = obj.rotation * Math.PI / 180;
                const texture = PIXI.Texture.from(tile.image);

                let sprite: PIXI.Sprite | PIXI.NineSlicePlane;
                if (tile.properties?.nineSliced) {
                    sprite = new PIXI.NineSlicePlane(
                        texture,
                        tile.properties.nineSliced,
                        tile.properties.nineSliced,
                        tile.properties.nineSliced,
                        tile.properties.nineSliced
                    );
                    console.log(tile.properties)
                    sprite.pivot.set(0, sprite.height); // Top-left corner, Y offset to bottom
                    sprite.width = obj.width;
                    sprite.height = obj.height;
                } else {
                    sprite = new PIXI.Sprite(texture);
                    sprite.anchor.set(0, 1); // Bottom-left corner
                    sprite.scale.x = obj.width / sprite.width;
                    sprite.scale.y = obj.height / sprite.height;
                }

                sprite.rotation = rotation;


                this.sortFlip(sprite, obj.flipStates);

                if (obj.flipStates.horizontal) {
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

            this.layers.set(layerData.name, {
                container: layer,
                objects: entities,
            });
        });

        const settings = backgroundData.settings?.properties;
        if (settings?.screenWidth && settings?.screenHeight) {
            this.bounds.width = settings.screenWidth;
            this.bounds.height = settings.screenHeight;
        }
    }

    findFromProperties(propertyName: string, value: any): { object: TiledObject, view?: PIXI.Sprite } | undefined {
        for (const [obj, view] of this.objectToView.entries()) {
            if (obj.properties?.[propertyName] === value) {
                return { object: obj, view: view };
            }
        }
        return undefined;
    }

    sortFlip(view: PIXI.Sprite | PIXI.NineSlicePlane, flipStates: FlipStates): void {
        view.scale.x = flipStates.horizontal ? -Math.abs(view.scale.x) : Math.abs(view.scale.x);
        view.scale.y = flipStates.vertical ? -Math.abs(view.scale.y) : Math.abs(view.scale.y);
    }

    setOffset(x: number, y: number): void {
        this.container.x = x;
        this.container.y = y;
    }
}
