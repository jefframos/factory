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
export interface TiledLayer {
    id: number;
    name: string;
    type: string;
    properties?: Record<string, any>;
    objects?: TiledObject[];
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

export interface TiledTile {
    id: number;
    image: string;
    atlas: string;
    animationId?: string;
    subpath: string[];
    imagewidth: number;
    imageheight: number;
    properties?: Record<string, any>;
}

export interface ExtratedTiledTileData {
    layers: Map<string, TiledLayer>,
    tilesets: Map<string, TiledTileset>,
    settings?: TiledLayer
}

export class ExtractTiledFile {
    static TiledData?: ExtratedTiledTileData;
    static parseTiledData(tiledData: any): ExtratedTiledTileData {
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

                const animatedId = props.animated && imagePath ? imagePath.subpath[0] : undefined;
                tiles[tile.id] = {
                    id: tile.id,
                    image: imagePath ? imagePath.image : "",
                    subpath: imagePath ? imagePath.subpath : [],
                    atlas: imagePath ? imagePath.atlas : "",
                    imagewidth: tile.imagewidth,
                    imageheight: tile.imageheight,
                    properties: props,
                    animationId: animatedId
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
        ExtractTiledFile.TiledData = { layers, tilesets, settings }
        return ExtractTiledFile.TiledData;
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
