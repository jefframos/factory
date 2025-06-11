import Collider, { ColliderOptions } from '@core/collision/Collider';
import { ColliderDebugHelper } from '@core/collision/ColliderDebugHelper';
import { CollisionSystem } from '@core/collision/CollisionSystem';
import ViewUtils from '@core/utils/ViewUtils';
import * as PIXI from 'pixi.js';
import {
    createTextFromObject,
    ExtratedTiledTileData,
    FlipStates,
    TiledObject
} from './ExtractTiledFile';

export type TiledLayerTypes =
    | PIXI.Container
    | PIXI.NineSlicePlane
    | PIXI.Sprite
    | PIXI.BitmapText
    | PIXI.Text
    | PIXI.TilingSprite;

export type FoundTiledObject = { object: TiledObject, view?: TiledLayerTypes } | undefined;
export type LayerTypes = { container: PIXI.Container, objects: TiledLayerTypes[] };

export default class TiledLayerObject extends PIXI.Container {
    public bounds = { width: 0, height: 0 };
    public localBounds = { width: 0, height: 0 };

    protected tiledLayerData!: ExtratedTiledTileData;
    protected container: PIXI.Container;
    protected tiledLayers: Map<string, LayerTypes> = new Map();
    protected tiledLayersProperties: Map<string, any> = new Map();
    protected objectToView: Map<TiledObject, TiledLayerTypes | undefined> = new Map();
    protected polygonsToView: Map<TiledObject, TiledLayerTypes | undefined> = new Map();
    private objectToCollider: Map<TiledObject, Collider> = new Map();


    constructor() {
        super();
        this.container = new PIXI.Container();
    }

    public build(backgroundData: ExtratedTiledTileData, layers?: string[]): void {
        this.tiledLayerData = backgroundData;

        this.container.zIndex = -1;
        this.addChild(this.container);

        const filteredLayers = (layers?.length)
            ? Array.from(this.tiledLayerData.layers.values()).filter(layer => layers.includes(layer.name))
            : Array.from(this.tiledLayerData.layers.values());

        filteredLayers.forEach(layerData => {
            const layer = new PIXI.Container();
            this.addChild(layer);
            const entities: TiledLayerTypes[] = [];

            layerData.objects?.forEach(obj => {
                this.objectToView.set(obj, undefined);

                // Handle Text Object
                if (obj.text) {
                    const props = obj.properties || {};
                    const text = createTextFromObject(obj.text, obj.width, obj.height, props.isBitmapFont);

                    text.rotation = obj.rotation * Math.PI / 180;
                    if (obj.rotation !== 0) {
                        text.anchor.set(0, 1);
                        text.x = obj.x;
                        text.y = obj.y + obj.height / 2;
                    } else {
                        text.x = obj.x + obj.width * text.anchor.x;
                        text.y = obj.y + obj.height * text.anchor.y;
                    }

                    if (props.isBitmapFont) {
                        text.scale.set(ViewUtils.elementScalerBySize(text.width, text.height, obj.width, obj.height));
                    }

                    layer.addChild(text);
                    this.objectToView.set(obj, text);
                    entities.push(text);

                    this.localBounds.width = Math.max(this.localBounds.width, text.x + text.width);
                    this.localBounds.height = Math.max(this.localBounds.height, text.y);
                    return;
                }

                const tilesets = Array.from(this.tiledLayerData.tilesets.values());
                const tileset = tilesets.find((ts, index) => {
                    const next = tilesets[index + 1];
                    return obj.gid >= ts.firstgid && obj.gid < (next ? next.firstgid : Infinity);
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
                const texture = PIXI.Texture.from(tile.image);
                const rotation = obj.rotation * Math.PI / 180;
                const props = tile.properties || {};
                const defaultSlice = props.nineSliced as number | undefined;
                const isTiled = props.isTiled as number | undefined;

                obj.tile = tile;

                let sprite: TiledLayerTypes;

                if (isTiled !== undefined) {
                    const tilingSprite = new PIXI.TilingSprite(texture, obj.width, obj.height);
                    tilingSprite.tileScale.set(1);
                    sprite = tilingSprite;
                } else if (defaultSlice !== undefined) {
                    let { left, right, top, bottom } = props;

                    if (left === undefined && right === undefined && top === undefined && bottom === undefined) {
                        left = right = top = bottom = defaultSlice;
                    }

                    if (left !== undefined && right === undefined) right = left;
                    if (right !== undefined && left === undefined) left = right;
                    if (top !== undefined && bottom === undefined) bottom = top;
                    if (bottom !== undefined && top === undefined) top = bottom;

                    const nineSlice = new PIXI.NineSlicePlane(texture, left, top, right, bottom);
                    nineSlice.width = obj.width;
                    nineSlice.height = obj.height;
                    nineSlice.pivot.set(0, nineSlice.height);
                    sprite = nineSlice;
                } else {
                    const basicSprite = new PIXI.Sprite(texture);
                    basicSprite.anchor.set(0, 1);
                    basicSprite.scale.set(obj.width / basicSprite.width, obj.height / basicSprite.height);
                    sprite = basicSprite;
                }

                const anchorX = props.anchorX ?? 0.5;
                const anchorY = props.anchorY ?? 1;

                if (sprite instanceof PIXI.Sprite) {
                    sprite.anchor.set(anchorX, anchorY);
                } else {
                    sprite.pivot.set(obj.width * anchorX, obj.height * anchorY);
                }

                // Flip first
                this.sortFlip(sprite, obj.flipStates);

                // Rotation (radians)
                sprite.rotation = rotation;

                // STEP 1: delta from Tiled's (0,1) anchor to desired anchor
                const deltaAnchorX = 0 - anchorX;      // because Tiled uses anchorX = 0
                let deltaAnchorY = 1 - anchorY;      // because Tiled uses anchorY = 1
                if (obj.flipStates.vertical) {
                    deltaAnchorY += 1
                }

                const offsetX = obj.width * deltaAnchorX;
                const offsetY = obj.height * deltaAnchorY;

                // STEP 2: rotate that delta
                const cos = Math.cos(rotation);
                const sin = Math.sin(rotation);

                const rotatedOffsetX = offsetX * cos - offsetY * sin;
                const rotatedOffsetY = offsetX * sin + offsetY * cos;

                // STEP 3: apply to Tiled position
                sprite.x = obj.x - rotatedOffsetX;
                sprite.y = obj.y - rotatedOffsetY;

                // Optional: sort depth
                sprite.zIndex = sprite.y;

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
            this.tiledLayers.set(layerData.name, { container: layer, objects: entities });
        });

        const settings = backgroundData.settings?.properties;
        if (settings?.screenWidth && settings?.screenHeight) {
            this.bounds.width = settings.screenWidth;
            this.bounds.height = settings.screenHeight;
        }
    }
    public addColliders(layers?: string[]) {
        for (const [name, layer] of this.tiledLayers.entries()) {
            if (layers && !layers.includes(name)) continue;
            for (const spriteObject of layer.objects) {
                const viewObject = Array.from(this.objectToView.entries()).find(([key, value]) => value === spriteObject)?.[0];
                const polygon = viewObject?.tile?.polygon;
                if (polygon) {
                    if (polygon.type === 'polygon' && polygon.points) {
                        const points = polygon.points.map(p => new PIXI.Point(p.x, p.y));
                        if (!points) continue

                        const scaledPoints = ColliderDebugHelper.scalePolygonPoints(
                            points,
                            viewObject.tile?.imagewidth || viewObject.width,
                            viewObject.tile?.imageheight || viewObject.height,
                            viewObject.width,
                            viewObject.height,
                        );
                        const reversedPoints = ColliderDebugHelper.ensureAntiClockwise(ColliderDebugHelper.checkForFlip(scaledPoints, viewObject.width, viewObject.height, viewObject.flipStates))
                        const colliderOptions: ColliderOptions = {
                            shape: 'polygon',
                            points: reversedPoints,
                            position: { x: viewObject.x, y: viewObject.y - viewObject.height },
                        };
                        const collider = new Collider(colliderOptions);
                        CollisionSystem.addCollider(collider);
                        ColliderDebugHelper.addDebugGraphics(collider, this)
                        this.objectToCollider.set(viewObject, collider);

                    } else if (polygon.type === 'circle') {
                        const scaleX = spriteObject.scale.x;
                        const scaleY = spriteObject.scale.y;

                        const anchorX = spriteObject instanceof PIXI.Sprite ? spriteObject.anchor?.x ?? 0.5 : 0.5;
                        const anchorY = spriteObject instanceof PIXI.Sprite ? spriteObject.anchor?.y ?? 0 : 0;

                        const radius = (polygon.radius ?? 10) * scaleY;

                        // Step 1: Get anchor-adjusted sprite position
                        const spriteWorldX = viewObject.x //+ (viewObject.width * anchorX);
                        const spriteWorldY = viewObject.y - (viewObject.height * anchorY);

                        // Step 2: Add scaled polygon center
                        const position = new PIXI.Point(
                            spriteWorldX + (polygon.center?.x ?? 0) * scaleX,
                            spriteWorldY + (polygon.center?.y ?? 0) * scaleY
                        );

                        const colliderOptions: ColliderOptions = {
                            shape: 'circle',
                            radius,
                            position,
                        };

                        const collider = new Collider(colliderOptions);
                        CollisionSystem.addCollider(collider);
                        ColliderDebugHelper.addDebugGraphics(collider, this);
                        this.objectToCollider.set(viewObject, collider);

                    }
                }
            }
        }

    }
    public setActiveObjectByName(name: string, visible: boolean, enable?: boolean): void {
        for (const [obj, view] of this.objectToView.entries()) {
            if (obj.name === name) {
                if (view instanceof PIXI.DisplayObject) {
                    view.visible = visible;
                }
                const collider = this.objectToCollider.get(obj);
                if (collider) {
                    collider.enabled = enable ? enable : visible; // assuming Collider has an `enabled` flag
                }

                break;
            }
        }
    }
    public updateColliderStateForObject(obj: TiledObject): void {
        const view = this.objectToView.get(obj);
        const collider = this.objectToCollider.get(obj);
        if (collider && view instanceof PIXI.DisplayObject) {
            collider.enabled = view.visible;
        }
    }
    public addAtId(element: PIXI.Container, value: string, anchor?: PIXI.Point): void {
        const tiledElement = this.findAndGetFromProperties('id', value);
        if (tiledElement?.view) {
            tiledElement.view.addChild(element);
            if ((element as any).anchor && anchor) {
                (element as any).anchor.set(anchor);
                element.position.set(
                    tiledElement.object.width * anchor.x,
                    tiledElement.object.height * anchor.y
                );
            }
        }
    }

    public getLayerByName(value?: string): LayerTypes | undefined {
        return value ? this.tiledLayers.get(value) : Array.from(this.tiledLayers.values())[0];
    }

    public findAndGetByName(name: string): FoundTiledObject {
        for (const [obj, view] of this.objectToView.entries()) {
            if (obj.name === name) return { object: obj, view };
        }
        return undefined;
    }

    public findFromProperties(propertyName: string, value: any, callback: (result: FoundTiledObject) => void): FoundTiledObject {
        for (const [obj, view] of this.objectToView.entries()) {
            if (obj.properties?.[propertyName] === value) {
                callback({ object: obj, view })
            };
        }
        return undefined;
    }

    public findAndGetFromProperties(propertyName: string, value: any): FoundTiledObject {
        for (const [obj, view] of this.objectToView.entries()) {
            if (obj.properties?.[propertyName] === value) return { object: obj, view };
        }
        return undefined;
    }

    public setOffset(x: number, y: number): void {
        this.container.x = x;
        this.container.y = y;
    }

    protected sortFlip(view: TiledLayerTypes, flipStates: FlipStates): void {
        if (!flipStates) return;

        const scaleX = Math.abs(view.scale.x);
        const scaleY = Math.abs(view.scale.y);

        view.scale.x = flipStates.horizontal ? -scaleX : scaleX;
        view.scale.y = flipStates.vertical ? -scaleY : scaleY;
    }
}

