import ViewUtils from "@core/utils/ViewUtils";
import * as PIXI from "pixi.js";
import MergeAssets from "../MergeAssets";

export interface TileData {
    id: string;      // Unique ID for saving/loading
    index: number;   // 0, 1, 2...
    row: number;
    col: number;
    occupantId: string | null; // ID of the BlockMergeEntity or Egg
}

export class MergeTile extends PIXI.Container {
    public data!: TileData;

    static COUNTER = Math.floor(Math.random() * MergeAssets.Textures.Extras.Mats.length);

    private sprite = PIXI.Sprite.from('mat-1')

    constructor() {
        super();
    }
    public init(size: number) {

        const id = MergeTile.COUNTER++ % MergeAssets.Textures.Extras.Mats.length
        this.sprite.texture = PIXI.Texture.from(MergeAssets.Textures.Extras.Mats[id])
        this.addChild(this.sprite);
        this.sprite.scale.set(ViewUtils.elementScaler(this.sprite, size))
        this.sprite.anchor.set(0.5)
    }
}