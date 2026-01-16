import { JigsawBuildOptions, PieceDefinition } from "games/game4/types";
import * as PIXI from "pixi.js";
import { IJigsawPuzzleGenerator } from "./IJigsawPuzzleGenerator";

export class GridRectGenerator implements IJigsawPuzzleGenerator {
    public generate(sourceTexture: PIXI.Texture, options: JigsawBuildOptions): PieceDefinition[] {
        const cols = options.cols;
        const rows = options.rows;

        const base = sourceTexture.baseTexture;
        const frame = sourceTexture.frame.clone();

        const pieceW = frame.width / cols;
        const pieceH = frame.height / rows;

        const defs: PieceDefinition[] = [];

        for (let y = 0; y < rows; y++) {
            for (let x = 0; x < cols; x++) {
                const rect = new PIXI.Rectangle(
                    frame.x + x * pieceW,
                    frame.y + y * pieceH,
                    pieceW,
                    pieceH
                );

                const subTex = new PIXI.Texture(base, rect);

                defs.push({
                    id: `p_${x}_${y}`,
                    col: x,
                    row: y,
                    texture: subTex,
                    pieceW,
                    pieceH,
                    pad: 0,
                    edges: { top: 0, right: 0, bottom: 0, left: 0 },
                    spriteOffsetX: 0,
                    spriteOffsetY: 0,
                    edgeVariants: {}
                });
            }
        }

        return defs;
    }
}
