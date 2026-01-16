import { JigsawBuildOptions, PieceDefinition } from "games/game4/types";
import * as PIXI from "pixi.js";
import { IJigsawPuzzleGenerator } from "./IJigsawPuzzleGenerator";
import { JigsawPiece } from "./JigsawPiece";

export type BuiltPuzzle =
    {
        pieces: JigsawPiece[];
        definitions: PieceDefinition[];
    };

export class JigsawPuzzleFactory {
    /**
     * Static builder:
     * - asks generator for piece definitions
     * - creates JigsawPiece display objects
     * - applies layout/scatter
     */
    public static build(
        sourceTexture: PIXI.Texture,
        generator: IJigsawPuzzleGenerator,
        options: JigsawBuildOptions
    ): BuiltPuzzle {
        const defs = generator.generate(sourceTexture, options);

        const pieces: JigsawPiece[] = defs.map((d) => {
            const p = new JigsawPiece(d);
            return p;
        });

        // Layout: grid or scatter.
        if (options.scatterRect) {
            for (const p of pieces) {

                p.position.set(
                    options.scatterRect.x + Math.random() * options.scatterRect.width,
                    options.scatterRect.y + Math.random() * options.scatterRect.height
                );
            }
        }
        else {
            // Neat grid: place by col/row using core size (not including pad)
            for (const p of pieces) {
                const d = p.definition;
                p.position.set(d.col * d.pieceW, d.row * d.pieceH);
            }
        }

        return { pieces, definitions: defs };
    }
}
