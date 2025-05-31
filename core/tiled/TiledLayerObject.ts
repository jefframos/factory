import ViewUtils from '@core/utils/ViewUtils';
import * as PIXI from 'pixi.js';
import { createTextFromObject, ExtratedTiledTileData, FlipStates, TiledObject } from './ExtractTiledFile';

export type TiledLayerTypes = PIXI.Container | PIXI.NineSlicePlane | PIXI.Sprite | PIXI.BitmapText | PIXI.Text | PIXI.TilingSprite;
export type FoundTiledObject = { object: TiledObject, view?: TiledLayerTypes } | undefined;
export type LayerTypes = { container: PIXI.Container, objects: TiledLayerTypes[] };

export default class TiledLayerObject extends PIXI.Container {
    protected tiledLayerData!: ExtratedTiledTileData;
    protected tiledLayers: Map<string, LayerTypes> = new Map();
    protected tiledLayersProperties: Map<string, any> = new Map();
    public bounds = { width: 0, height: 0 };
    public localBounds = { width: 0, height: 0 };
    protected container: PIXI.Container;
    protected objectToView: Map<TiledObject, TiledLayerTypes | undefined> = new Map();


    constructor() {
        super();
        this.container = new PIXI.Container();
    }
    public getLayerByName(value?: string): LayerTypes | undefined {
        if (value) {
            return this.tiledLayers.get(value);
        }
        return Array.from(this.tiledLayers.values())[0];
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
                // ✅ If it's a TextObject
                if (obj.text) {
                    const props = obj.properties || {};
                    const text = createTextFromObject(obj.text, obj.width, obj.height, props.isBitmapFont)


                    text.rotation = obj.rotation * Math.PI / 180;
                    if (obj.rotation !== 0) {
                        // Set anchor to bottom-left (0, 1)
                        text.anchor.set(0, 1);
                        // Apply position at bottom-left
                        text.x = obj.x;
                        text.y = obj.y + obj.height / 2;
                    } else {
                        // Use anchor-based placement if no rotation
                        text.x = obj.x + obj.width * text.anchor.x;
                        text.y = obj.y + obj.height * text.anchor.y;
                    }


                    if (props.isBitmapFont) {
                        text.scale.set(ViewUtils.elementScalerBySize(text.width, text.height, obj.width, obj.height))
                    }

                    layer.addChild(text);
                    this.objectToView.set(obj, text);
                    entities.push(text);

                    this.localBounds.width = Math.max(this.localBounds.width, text.x + text.width);
                    this.localBounds.height = Math.max(this.localBounds.height, text.y);
                    return; // ✅ skip rest of logic since it's a text object
                }

                const tilesets = Array.from(this.tiledLayerData.tilesets.values());
                const tileset = tilesets.find((ts, index) => {
                    const next = tilesets[index + 1];
                    const start = ts.firstgid;
                    const end = next ? next.firstgid : Number.POSITIVE_INFINITY;
                    return obj.gid >= start && obj.gid < end;
                });

                if (!tileset) {
                    const empty = new PIXI.Container();
                    layer.addChild(empty);
                    empty.x = obj.x;
                    empty.y = obj.y;
                    this.objectToView.set(obj, empty);
                    return;
                }



                const tile = tileset.tiles[obj.gid - tileset.firstgid];

                const rotation = obj.rotation * Math.PI / 180;
                const texture = PIXI.Texture.from(tile.image);

                let sprite: TiledLayerTypes;

                const props = tile.properties || {};
                const defaultSlice = props.nineSliced as number | undefined;
                const isTiled = props.isTiled as number | undefined;
                if (isTiled !== undefined) {

                    const tilingSprite = new PIXI.TilingSprite(
                        texture,
                        obj.width,
                        obj.height
                    );
                    tilingSprite.tileScale.set(1); // optional: keep full texture scale
                    sprite = tilingSprite;

                } else if (defaultSlice !== undefined) {

                    let left = props.left as number | undefined;
                    let right = props.right as number | undefined;
                    let top = props.top as number | undefined;
                    let bottom = props.bottom as number | undefined;

                    if (left === undefined && right === undefined && top === undefined && bottom === undefined) {
                        left = right = top = bottom = defaultSlice;
                    }
                    if (left !== undefined && right === undefined) right = left;
                    if (right !== undefined && left === undefined) left = right;
                    if (top !== undefined && bottom === undefined) bottom = top;
                    if (bottom !== undefined && top === undefined) top = bottom;

                    // const sprite2 = new PIXI.NineSlicePlane(texture, left, top, right, bottom);


                    sprite = new PIXI.NineSlicePlane(
                        texture,
                        left, top, right, bottom
                    );
                    sprite.width = obj.width;
                    sprite.height = obj.height;
                    sprite.pivot.set(0, sprite.height);
                } else {
                    sprite = new PIXI.Sprite(texture);
                    (sprite as PIXI.Sprite).anchor.set(0, 1);
                    sprite.scale.x = obj.width / sprite.width;
                    sprite.scale.y = obj.height / sprite.height;
                }

                // Set pivot as always bottom-left (0,1)
                if (sprite instanceof PIXI.Sprite) {
                    sprite.anchor.set(0, 1);
                } else {
                    sprite.pivot.set(0, sprite.height); // same effect for NineSlice
                }



                sprite.rotation = rotation;
                this.sortFlip(sprite, obj.flipStates);

                if (obj.flipStates?.horizontal) {
                    obj.x += sprite.width;
                }
                if (obj.flipStates?.vertical) {
                    obj.y -= sprite.height;
                }
                // Correct position if rotated
                if (rotation !== 0) {
                    // Simulate rotation from bottom-left pivot
                    const cos = Math.cos(rotation);
                    const sin = Math.sin(rotation);
                    const dx = obj.width;
                    const dy = obj.height;

                    sprite.x = obj.x + dx * cos - dy * sin;
                    sprite.y = obj.y + dx * sin + dy * cos;
                } else {
                    sprite.x = obj.x;
                    sprite.y = obj.y;
                }

                sprite.zIndex = obj.y;

                if (props.anchorX) {
                    (sprite as PIXI.Sprite).anchor.x = props.anchorX;
                    sprite.x += obj.width * props.anchorX;
                }

                if (props.anchorY) {
                    (sprite as PIXI.Sprite).anchor.y = props.anchorY;
                }

                layer.addChild(sprite);
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
    }

    addAtId(element: PIXI.Container, value: string, anchor?: PIXI.Point) {
        const tiledElement = this.findFromProperties('id', value);
        if (tiledElement) {
            tiledElement.view?.addChild(element)


            if (element.anchor && anchor) {
                element.anchor.set(anchor); // PIXI v7+ only
                element.position.set(tiledElement.object.width * anchor.x, tiledElement.object.height * anchor.y);
            }
        }
    }

    findFromProperties(propertyName: string, value: any): FoundTiledObject {
        for (const [obj, view] of this.objectToView.entries()) {
            if (obj.properties?.[propertyName] === value) {
                return { object: obj, view };
            }
        }
        return undefined;
    }

    findByName(name: string): FoundTiledObject {
        for (const [obj, view] of this.objectToView.entries()) {
            if (obj.name === name) {
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
