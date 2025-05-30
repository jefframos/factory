import { Game } from "@core/Game";
import * as PIXI from 'pixi.js';
import { ExtratedTiledTileData } from "./ExtractTiledFile";
import TiledLayerObject from "./TiledLayerObject";

export enum ScaleMode {
    FIT = "fit",
    ENVELOP = "envelop",
    MATCH = "match"
}

export type ScaleSettings = {
    scaleMode: ScaleMode;
    matchRatio?: number; // 0 = match width, 1 = match height
};

export type PinSettings = {
    pinAnchor?: PIXI.Point; // e.g., (0, 0) for top-left, (0.5, 1) for center-bottom
};

export default class TiledAutoPositionObject extends TiledLayerObject {
    private scaleMode: ScaleMode = ScaleMode.MATCH;
    private matchRatio: number = 1;
    private pinAnchor: PIXI.Point | undefined;

    // private db: PIXI.Graphics = new PIXI.Graphics().beginFill(0x00FF00).drawCircle(0, 0, 50);
    // private db2: PIXI.Graphics = new PIXI.Graphics().beginFill(0x00FFFF).drawCircle(0, 0, 50);

    build(
        backgroundData: ExtratedTiledTileData,
        layers?: string[],
        scaleSettings: ScaleSettings = { scaleMode: ScaleMode.MATCH, matchRatio: 1 },
        pinSettings: PinSettings = {}
    ): void {
        super.build(backgroundData, layers);

        if (layers && layers.length === 1) {
            const props = this.tiledLayersProperties.get(layers[0])?.properties || {};
            this.scaleMode = props.scaleMode || scaleSettings.scaleMode;
            this.matchRatio = props.matchRatio ?? scaleSettings.matchRatio;
            this.pinAnchor = props.pinAnchor ?? pinSettings.pinAnchor;
        } else {
            const props = backgroundData.settings?.properties || {};
            this.scaleMode = props.scaleMode || scaleSettings.scaleMode;
            this.matchRatio = props.matchRatio ?? scaleSettings.matchRatio;
            this.pinAnchor = props.pinAnchor ?? pinSettings.pinAnchor;
        }

        // Set pivot to top-left
        // this.container.pivot.set(0, 0);

        // // Debug helpers
        // this.addChild(this.db);
        // this.addChild(this.db2);
    }

    updateTransform(): void {
        super.updateTransform();
        this.update(Game.deltaTime);
    }

    update(delta: number): void {
        const screen = Game.overlayScreenData;
        const center = Game.gameScreenData.center;

        const scaleX = (screen.bottomRight.x - screen.topLeft.x) / this.bounds.width;
        const scaleY = (screen.bottomRight.y - screen.topLeft.y) / this.bounds.height;

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

        // Debug markers
        // this.db.y = screen.bottomRight.y;
        // this.db2.y = screen.topLeft.y;

        // Position using pinAnchor
        if (this.pinAnchor) {
            const pin = this.pinAnchor;
            const screenWidth = screen.bottomRight.x - screen.topLeft.x;
            const screenHeight = screen.bottomRight.y - screen.topLeft.y;

            this.container.x = screen.topLeft.x + screenWidth * pin.x - (this.bounds.width * targetScale * pin.x);
            this.container.y = screen.topLeft.y + screenHeight * pin.y - (this.bounds.height * targetScale * pin.y);
        } else {
            // Default: center
            this.container.x = center.x - (this.bounds.width / 2) * targetScale;
            this.container.y = center.y - (this.bounds.height / 2) * targetScale;
        }
    }
}
