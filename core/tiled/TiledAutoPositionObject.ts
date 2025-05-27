import { Game } from "@core/Game";
import * as PIXI from 'pixi.js';
import { ExtratedTiledTileData } from "./ExtractTiledFile";
import TiledLayerObject from "./TiledLayerObject";

export enum ScaleMode {
    FIT = "fit",
    ENVELOP = "envelop",
    MATCH = "match"
}

export enum PinMode {
    NONE = "none",
    BOTTOM = "bottom",
    TOP = "top",
    CENTER = "center"
}

export type ScaleSettings = {
    scaleMode: ScaleMode;
    matchRatio?: number; // 0 = match width, 1 = match height
};

export type PinSettings = {
    pinMode: PinMode;
};

export default class TiledAutoPositionObject extends TiledLayerObject {
    private scaleMode: ScaleMode = ScaleMode.MATCH;
    private matchRatio: number = 1;
    private pinMode: PinMode = PinMode.NONE;

    private db: PIXI.Graphics = new PIXI.Graphics().beginFill(0x00FF00).drawCircle(0, 0, 50);

    build(
        backgroundData: ExtratedTiledTileData,
        layers?: string[],
        scaleSettings: ScaleSettings = { scaleMode: ScaleMode.MATCH, matchRatio: 1 },
        pinSettings: PinSettings = { pinMode: PinMode.NONE }
    ): void {
        super.build(backgroundData, layers);

        // Read properties from layers or background data
        if (layers && layers.length === 1) {
            const props = this.tiledLayersProperties.get(layers[0])?.properties || {};
            this.scaleMode = props.scaleMode || scaleSettings.scaleMode;
            this.matchRatio = props.matchRatio ?? scaleSettings.matchRatio;
            this.pinMode = props.pinMode || pinSettings.pinMode;
        } else {
            const props = backgroundData.settings?.properties || {};
            this.scaleMode = props.scaleMode || scaleSettings.scaleMode;
            this.matchRatio = props.matchRatio ?? scaleSettings.matchRatio;
            this.pinMode = props.pinMode || pinSettings.pinMode;
        }

        // Set pivot to top-left (0,0)
        this.container.pivot.set(0, 0);

        // Add debug marker
        // this.addChild(this.db);

        // // Place a test object at DESIGN_HEIGHT (bottom of layout)
        // const zero = new PIXI.Graphics().beginFill(0xFF0000).drawCircle(0, 0, 20);
        // zero.y = Game.DESIGN_HEIGHT;
        // this.container.addChild(zero);
    }

    updateTransform(): void {
        super.updateTransform();
        this.update(Game.deltaTime);
    }

    update(delta: number): void {
        const cameraCenterX = Game.gameScreenData.center.x;
        const cameraCenterY = Game.gameScreenData.center.y;

        const scaleX = Game.overlayScreenData.bottomRight.x / this.bounds.width;
        const scaleY = Game.overlayScreenData.bottomRight.y / this.bounds.height;

        let targetScale: number;

        switch (this.scaleMode) {
            case ScaleMode.FIT:
                targetScale = Math.min(scaleX, scaleY);
                break;
            case ScaleMode.ENVELOP:
                targetScale = Math.max(scaleX, scaleY);
                break;
            case ScaleMode.MATCH:
                targetScale = scaleX * (1 - this.matchRatio) + scaleY * this.matchRatio;
                break;
        }

        this.container.scale.set(targetScale);
        this.container.x = cameraCenterX - (this.bounds.width / 2) * targetScale;

        // db at bottom of screen
        this.db.y = cameraCenterY + Game.overlayScreenData.bottomRight.y / 2;

        switch (this.pinMode) {
            case PinMode.TOP:
                this.container.y = cameraCenterY - (Game.DESIGN_HEIGHT / 2) * targetScale;
                break;

            case PinMode.BOTTOM:
                this.container.y = this.db.y - Game.DESIGN_HEIGHT * targetScale;
                break;

            case PinMode.CENTER:
                this.container.y = cameraCenterY - (this.bounds.height / 2) * targetScale;
                break;

            case PinMode.NONE:
            default:
                this.container.y = cameraCenterY - (this.bounds.height / 2) * targetScale;
                break;
        }
    }
}
