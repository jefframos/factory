import { EdgeSide, JigsawBuildOptions, PieceDefinition } from "games/game4/types";
import * as PIXI from "pixi.js";
import { IJigsawPuzzleGenerator } from "./IJigsawPuzzleGenerator";

export class SimpleTabsGenerator implements IJigsawPuzzleGenerator {
    public tabScale: number = 0.22;
    public bleedPx: number = 2;

    public generate(sourceTexture: PIXI.Texture, options: JigsawBuildOptions): PieceDefinition[] {
        const cols = options.cols | 0;
        const rows = options.rows | 0;

        const base = sourceTexture.baseTexture;
        const frame = sourceTexture.frame.clone();

        // Pixel-perfect cuts (recommended)
        const xCuts = this.buildCuts(frame.x, frame.width, cols);
        const yCuts = this.buildCuts(frame.y, frame.height, rows);

        const nominalW = frame.width / cols;
        const nominalH = frame.height / rows;

        const tab = Math.max(1, Math.round(Math.min(nominalW, nominalH) * this.tabScale));
        const bleed = Math.max(0, this.bleedPx | 0);

        const defs: PieceDefinition[] = [];

        for (let y = 0; y < rows; y++) {
            for (let x = 0; x < cols; x++) {
                const edges: EdgeSide =
                {
                    top: 0,
                    bottom: 0,
                    left: 0,
                    right: 0,
                };

                // Only horizontal connections:
                // If there is a neighbor to the right, current gets right tab +1.
                if (x < cols - 1) {
                    edges.right = +1;
                }

                // If there is a neighbor to the left, current gets left hole -1.
                if (x > 0) {
                    edges.left = -1;
                }

                // Integer cell bounds
                const cellX0 = xCuts[x];
                const cellX1 = xCuts[x + 1];
                const cellY0 = yCuts[y];
                const cellY1 = yCuts[y + 1];

                const cellW = cellX1 - cellX0;
                const cellH = cellY1 - cellY0;

                // Overdraw only for OUTWARD tabs (+1), plus bleed.
                // Holes (-1) do not need extra pixels outside the cell.
                const extraLeft = (edges.left > 0 ? tab : 0) + bleed;
                const extraRight = (edges.right > 0 ? tab : 0) + bleed;
                const extraTop = (edges.top > 0 ? tab : 0) + bleed;
                const extraBottom = (edges.bottom > 0 ? tab : 0) + bleed;

                let cropX0 = cellX0 - extraLeft;
                let cropY0 = cellY0 - extraTop;
                let cropX1 = cellX1 + extraRight;
                let cropY1 = cellY1 + extraBottom;

                // Clamp to frame
                const frameX0 = frame.x;
                const frameY0 = frame.y;
                const frameX1 = frame.x + frame.width;
                const frameY1 = frame.y + frame.height;

                cropX0 = Math.max(frameX0, cropX0);
                cropY0 = Math.max(frameY0, cropY0);
                cropX1 = Math.min(frameX1, cropX1);
                cropY1 = Math.min(frameY1, cropY1);

                const cropW = Math.max(1, cropX1 - cropX0);
                const cropH = Math.max(1, cropY1 - cropY0);

                const rect = new PIXI.Rectangle(cropX0, cropY0, cropW, cropH);
                const subTex = new PIXI.Texture(base, rect);

                // Core cell top-left within the cropped texture
                const coreInTexX = cellX0 - cropX0;
                const coreInTexY = cellY0 - cropY0;

                const spriteOffsetX = tab - coreInTexX;
                const spriteOffsetY = tab - coreInTexY;

                defs.push({
                    id: `p_${x}_${y}`,
                    col: x,
                    row: y,

                    texture: subTex,

                    pieceW: nominalW,
                    pieceH: nominalH,

                    pad: tab,
                    edges,

                    spriteOffsetX,
                    spriteOffsetY,
                    edgeVariants: {}
                });
            }
        }

        return defs;
    }

    private buildCuts(start: number, length: number, count: number): number[] {
        const cuts: number[] = new Array(count + 1);
        cuts[0] = start;

        for (let i = 1; i < count; i++) {
            cuts[i] = start + Math.round((length * i) / count);
        }

        cuts[count] = start + length;

        for (let i = 1; i <= count; i++) {
            if (cuts[i] < cuts[i - 1]) {
                cuts[i] = cuts[i - 1];
            }
        }

        return cuts;
    }
}
