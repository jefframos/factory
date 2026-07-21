// BlockBodyTextureCache.ts

import { Game } from 'core/Game';
import * as PIXI from 'pixi.js';
import type { FaceTowerConfig } from './FaceTowerTypes';
import type { PieceDefinition } from './PieceStorage';

/**
 * Draws a block body shape (black outline, full white fill — square or
 * rounded depending on blockBevelRadius, sized to blockWidth/blockHeight
 * scaled by the piece's own `scale`, or the piece's own `polygon` outline
 * if it has one) once per piece.id and rasterizes it to a texture, instead
 * of every block re-drawing its own vector Graphics.
 * Callers apply a Sprite with `.tint` set to the piece's own color — white
 * multiplies to that color, black stays black — so one cached texture per
 * piece serves every block spawned from it with no per-block draw cost.
 *
 * Call invalidate() after changing blockWidth/blockHeight/blockBevelRadius/
 * blockStrokeWidth/blockStrokeColor at runtime (e.g. via the dev GUI) —
 * existing sprites keep the old texture until they're respawned.
 */
export class BlockBodyTextureCache {
    private readonly textures = new Map<string, PIXI.Texture>();

    public constructor(
        private readonly config: FaceTowerConfig,
    ) { }

    public getTexture(piece: PieceDefinition): PIXI.Texture {
        let texture = this.textures.get(piece.id);

        if (!texture) {
            texture = this.buildTexture(piece);
            this.textures.set(piece.id, texture);
        }

        return texture;
    }

    public invalidate(): void {
        for (const texture of this.textures.values()) {
            texture.destroy(true);
        }

        this.textures.clear();
    }

    public destroy(): void {
        this.invalidate();
    }

    private buildTexture(piece: PieceDefinition): PIXI.Texture {
        const { scale } = piece;
        const w = this.config.blockWidth * scale.x;
        const h = this.config.blockHeight * scale.y;
        const bevel = this.config.blockBevelRadius * Math.min(scale.x, scale.y);

        const graphic = new PIXI.Graphics();

        graphic.lineStyle(this.config.blockStrokeWidth, this.config.blockStrokeColor, 1);
        graphic.beginFill(0xffffff, 1);

        if (piece.polygon) {
            graphic.drawPolygon(piece.polygon.flatMap(p => [p.x * w, p.y * h]));
        } else if (bevel > 0) {
            graphic.drawRoundedRect(0, 0, w, h, bevel);
        } else {
            graphic.drawRect(0, 0, w, h);
        }

        graphic.endFill();

        const texture = Game.renderer.generateTexture(graphic);
        graphic.destroy();

        return texture;
    }
}
