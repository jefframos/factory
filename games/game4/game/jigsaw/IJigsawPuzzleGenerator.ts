import { JigsawBuildOptions, PieceDefinition } from "games/game4/types";
import * as PIXI from "pixi.js";

export interface IJigsawPuzzleGenerator {
    /**
     * Returns piece definitions (textures + metadata) for a given source texture.
     * JigsawView / factory will turn these into actual display objects (JigsawPiece).
     */
    generate(sourceTexture: PIXI.Texture, options: JigsawBuildOptions): PieceDefinition[];
}
