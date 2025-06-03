
import * as PIXI from 'pixi.js';
export interface TiledMap {
    width: number;
    height: number;
    tilewidth: number;
    tileheight: number;
    layers: TiledLayer[];
    tilesets: TiledTileset[];
}
export interface FlipStates {
    horizontal: boolean;
    vertical: boolean;
    diagonal: boolean;
}
export type HorizontalAlign = 'left' | 'center' | 'right';
export type VerticalAlign = 'top' | 'center' | 'bottom';

export interface TextObject {
    halign: HorizontalAlign;
    valign: VerticalAlign;
    text: string;
    wrap: boolean;
}
export interface TiledLayer {
    id: number;
    name: string;
    type: string;
    properties?: Record<string, any>;
    objects?: TiledObject[];
}
export function createTextFromObject(textObject: TextObject, width: number, height: number, isBitmapFont?: string): PIXI.Text | PIXI.BitmapText {
    const { halign, valign, text = "" } = textObject;
    const { wrap = true } = textObject;

    const anchorX = halign === 'left' ? 0 : halign === 'center' ? 0.5 : 1;
    const anchorY = valign === 'top' ? 0 : valign === 'center' ? 0.5 : 1;

    if (isBitmapFont) {
        const bitmapText = new PIXI.BitmapText(text, {
            fontName: isBitmapFont
        });
        bitmapText.anchor.set(anchorX, anchorY);
        return bitmapText
    } else {
        const pixiText = new PIXI.Text(text, new PIXI.TextStyle({
            wordWrap: wrap,
            wordWrapWidth: width || 100,
            align: halign
        }));
        pixiText.anchor.set(anchorX, anchorY);
        return pixiText;
    }
}
export interface TiledObject {
    name?: string;
    id: number;
    gid: number;
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
    flipStates: FlipStates;
    text?: TextObject;
    polygon?: PIXI.Point[];
    visible: boolean;
    properties?: Record<string, any>;

}

export interface TiledTileset {
    firstgid: number;
    name: string;
    tilecount: number;
    tilewidth: number;
    tileheight: number;
    tiles: Record<number, TiledTile>;
}

export type PolygonType = 'polygon' | 'rect' | 'circle';

export interface TiledTile {
    id: number;
    image: string;
    atlas: string;
    animationId?: string;
    subpath: string[];
    imagewidth: number;
    imageheight: number;
    polygon?: { type: PolygonType, radius?: number, points: PIXI.Point[] };
    properties?: Record<string, any>;
}

export interface ExtratedTiledTileData {
    layers: Map<string, TiledLayer>,
    tilesets: Map<string, TiledTileset>,
    settings?: TiledLayer
}

export class ExtractTiledFile {
    static TiledData?: Record<string, ExtratedTiledTileData>;
    static parseTiledData(tiledData: any, tiledId: string) {
        let settings: TiledLayer | undefined;
        const layers = new Map<string, TiledLayer>();
        const tilesets = new Map<string, TiledTileset>();

        for (const layer of tiledData.layers) {
            const parsedLayer = this.parseLayer(layer);

            if (layer.name === "Settings" && layer.objects) {
                const screenObj = layer.objects.find((obj: any) => obj.name === "Screen");
                if (screenObj) {
                    parsedLayer.properties = {
                        ...parsedLayer.properties,
                        screenWidth: screenObj.width,
                        screenHeight: screenObj.height
                    };
                    settings = parsedLayer;
                    console.log("screenObj", screenObj, settings);
                }
            } else {
                layers.set(parsedLayer.name, parsedLayer);
            }
        }

        for (const tileset of tiledData.tilesets) {
            const tiles: Record<number, TiledTile> = {};
            for (const tile of tileset.tiles || []) {
                const imagePath = this.parse(tile.image);
                const props = this.parseProperties(tile.properties);
                if (tile.properties?.spine) {
                    props.spine = true;
                }
                if (!props.spine) {
                    if (!imagePath) {
                        continue;
                    }
                }


                let shapePolygon = this.checkForPolygon(tile)

                const animatedId = props.animated && imagePath ? imagePath.subpath[0] : undefined;
                console.log(shapePolygon)


                tiles[tile.id] = {
                    id: tile.id,
                    image: imagePath ? imagePath.image : "",
                    subpath: imagePath ? imagePath.subpath : [],
                    atlas: imagePath ? imagePath.atlas : "",
                    imagewidth: tile.imagewidth,
                    imageheight: tile.imageheight,
                    properties: props,
                    animationId: animatedId,
                    ...(shapePolygon ? { polygon: shapePolygon } : {})
                };
            }
            tilesets.set(tileset.name, {
                firstgid: tileset.firstgid,
                name: tileset.name,
                tilecount: tileset.tilecount,
                tilewidth: tileset.tilewidth,
                tileheight: tileset.tileheight,
                tiles
            });
        }
        ExtractTiledFile.TiledData = ExtractTiledFile.TiledData || {};
        ExtractTiledFile.TiledData[tiledId] = { layers, tilesets, settings };

    }
    private static checkForPolygon(tile: any): { type: PolygonType; points: PIXI.Point[]; radius?: number } | undefined {
        let shapePolygon: { type: PolygonType; points: PIXI.Point[]; radius?: number } | undefined = undefined;
        if (tile.objectgroup && Array.isArray(tile.objectgroup.objects)) {
            const shapeObject = tile.objectgroup.objects[0];
            if (shapeObject) {
                if (shapeObject.polygon) {
                    // Polygon type
                    const points = shapeObject.polygon.map((pt: any) =>
                        new PIXI.Point(pt.x + shapeObject.x, pt.y + shapeObject.y)
                    );
                    shapePolygon = {
                        type: 'polygon',
                        points
                    };
                } else if (shapeObject.ellipse) {
                    // Circle or ellipse type
                    const cx = shapeObject.x + shapeObject.width / 2;
                    const cy = shapeObject.y + shapeObject.height / 2;
                    const rx = shapeObject.width / 2;
                    const ry = shapeObject.height / 2;
                    const steps = 20;
                    const points: PIXI.Point[] = [];

                    for (let i = 0; i < steps; i++) {
                        const theta = (i / steps) * Math.PI * 2;
                        points.push(new PIXI.Point(
                            cx + rx * Math.cos(theta),
                            cy + ry * Math.sin(theta)
                        ));
                    }

                    shapePolygon = {
                        type: 'circle',
                        radius: Math.max(rx, ry), // or average if you want elliptical behavior
                        points
                    };
                } else {
                    // Rectangle type
                    const x = shapeObject.x;
                    const y = shapeObject.y;
                    const w = shapeObject.width;
                    const h = shapeObject.height;

                    const points = [
                        new PIXI.Point(x, y),
                        new PIXI.Point(x + w, y),
                        new PIXI.Point(x + w, y + h),
                        new PIXI.Point(x, y + h)
                    ];

                    shapePolygon = {
                        type: 'rect',
                        points
                    };
                }
            }
        }
        return shapePolygon
    }
    public static getTiledFrom(tiledId: string) {
        if (!(ExtractTiledFile.TiledData ?? {})[tiledId]) {
            console.warn("Warning: TiledData is undefined. Ensure that parseTiledData is called before accessing TiledData.");
            return undefined
        }
        return ExtractTiledFile.TiledData?.[tiledId];

    }
    private static parseLayer(layer: any): TiledLayer {
        return {
            id: layer.id,
            name: layer.name,
            type: layer.type,
            properties: this.parseProperties(layer.properties),
            objects: (layer.objects || []).map(this.parseObject)
        };
    }

    private static parseObject(obj: any): TiledObject {
        const gid = ExtractTiledFile.decodeGid(obj.gid);
        return {
            name: obj.name,
            id: obj.id,
            flipStates: gid.flipStates,
            polygon: obj.polygon,
            text: obj.text,
            properties: obj ? ExtractTiledFile.parseProperties(obj.properties) : {},
            gid: gid.tileId,
            rotation: obj.rotation,
            x: obj.x,
            y: obj.y,
            width: obj.width,
            height: obj.height,
            visible: obj.visible
        };
    }

    private static parseProperties(properties: any[]): Record<string, any> {
        return (properties || []).reduce((acc: Record<string, any>, prop: any) => {
            acc[prop.name] = prop.value;
            return acc;
        }, {});
    }

    static parse(path: string): { atlas: string; subpath: string[]; image: string } | null {
        const match = path.match(/images\/([^/]+)(?:\/(.*))?\/([^/]+)$/);
        if (!match) return null;

        const [, atlas, subfolders, imageFile] = match;
        return {
            atlas,
            subpath: subfolders ? subfolders.split("/") : [],
            image: this.removeExtension(imageFile)
        };
    }

    static removeExtension(filename: string): string {
        return filename.replace(/\.[^/.]+$/, "");
    }

    static findObjectByGid(gid: number, tilesets: Map<string, TiledTileset>): TiledTile | null {
        for (const tileset of tilesets.values()) {
            if (gid >= tileset.firstgid) {
                const tile = tileset.tiles[gid - tileset.firstgid];
                if (tile) return tile;
            }
        }
        return null;
    }
    static decodeGid(gid: number): { tileId: number; flipStates: FlipStates } {
        // Bitmasks for extracting flipping information
        const FLIPPED_HORIZONTALLY_FLAG = 0x80000000;
        const FLIPPED_VERTICALLY_FLAG = 0x40000000;
        const FLIPPED_DIAGONALLY_FLAG = 0x20000000;

        // Extract the actual tile ID by removing the flipping bits
        const tileId =
            gid &
            ~(
                FLIPPED_HORIZONTALLY_FLAG |
                FLIPPED_VERTICALLY_FLAG |
                FLIPPED_DIAGONALLY_FLAG
            );

        // Determine the flipping states
        const flipStates: FlipStates = {
            horizontal: (gid & FLIPPED_HORIZONTALLY_FLAG) !== 0,
            vertical: (gid & FLIPPED_VERTICALLY_FLAG) !== 0,
            diagonal: (gid & FLIPPED_DIAGONALLY_FLAG) !== 0,
        };

        return { tileId, flipStates };
    }
}
