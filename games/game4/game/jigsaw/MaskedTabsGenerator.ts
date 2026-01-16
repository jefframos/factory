import { EdgeSide, JigsawBuildOptions, PieceDefinition } from "games/game4/types";
import * as PIXI from "pixi.js";
import { IJigsawPuzzleGenerator } from "./IJigsawPuzzleGenerator";

type EdgeVariant =
    {
        offsetN: number; // [-1..+1]
        seed: number;    // uint32
    };

type EdgeVariants =
    {
        top?: EdgeVariant;
        right?: EdgeVariant;
        bottom?: EdgeVariant;
        left?: EdgeVariant;
    };

export class MaskedTabsGenerator implements IJigsawPuzzleGenerator {
    public tabScale: number = 0.25;
    public bleedPx: number = 2;

    /**
     * How far along an edge we allow connector center to drift, as a fraction of edge length.
     * 0.0 = always centered. Typical: 0.25..0.45.
     */
    public maxOffsetFrac: number = 0.35;

    public generate(sourceTexture: PIXI.Texture, options: JigsawBuildOptions): PieceDefinition[] {
        const cols = options.cols | 0;
        const rows = options.rows | 0;

        const base = sourceTexture.baseTexture;
        const frame = sourceTexture.frame;

        const xCuts = this.buildCuts(frame.x, frame.width, cols);
        const yCuts = this.buildCuts(frame.y, frame.height, rows);

        const nominalW = frame.width / cols;
        const nominalH = frame.height / rows;

        const tab = Math.max(1, Math.round(Math.min(nominalW, nominalH) * this.tabScale));
        const bleed = Math.max(0, this.bleedPx | 0);

        // Total margin we want around the core cell
        const margin = tab + bleed;

        // --- NEW: deterministic RNG for seams ---
        // Add `seed?: number` to JigsawBuildOptions if you want stable regeneration.
        const puzzleSeed = ((options as any).seed ?? (Math.random() * 0xffffffff)) >>> 0;
        const rand = this.mulberry32(puzzleSeed);

        // --- NEW: build edge signs AND shared seam variants ---
        const { edgeMap, edgeVariantsMap } = this.buildEdgeMapWithVariants(cols, rows, rand);
        this.validateEdgeMap(edgeMap, cols, rows);

        const defs: PieceDefinition[] = [];

        for (let y = 0; y < rows; y++) {
            for (let x = 0; x < cols; x++) {
                const edges = edgeMap[y][x];
                const edgeVariants = edgeVariantsMap[y][x];

                const cellX0 = xCuts[x];
                const cellX1 = xCuts[x + 1];
                const cellY0 = yCuts[y];
                const cellY1 = yCuts[y + 1];

                // 1. Always expand the crop by the full margin
                let cropX0 = cellX0 - margin;
                let cropY0 = cellY0 - margin;
                let cropX1 = cellX1 + margin;
                let cropY1 = cellY1 + margin;

                // 2. Clamp to the actual image bounds
                cropX0 = Math.max(frame.x, cropX0);
                cropY0 = Math.max(frame.y, cropY0);
                cropX1 = Math.min(frame.x + frame.width, cropX1);
                cropY1 = Math.min(frame.y + frame.height, cropY1);

                const cropW = cropX1 - cropX0;
                const cropH = cropY1 - cropY0;

                const rect = new PIXI.Rectangle(cropX0, cropY0, cropW, cropH);
                const subTex = new PIXI.Texture(base, rect);

                // 3. Calculate where the "core" (0,0 of the piece) is relative to the crop
                const spriteOffsetX = cellX0 - cropX0;
                const spriteOffsetY = cellY0 - cropY0;

                defs.push({
                    id: `p_${x}_${y}`,
                    col: x,
                    row: y,
                    texture: subTex,
                    pieceW: nominalW,
                    pieceH: nominalH,
                    pad: margin,
                    edges,

                    // NEW: seam shared params (offset + seed) per side
                    // Add this field to PieceDefinition type.
                    edgeVariants,

                    spriteOffsetX: margin - spriteOffsetX,
                    spriteOffsetY: margin - spriteOffsetY,
                } as PieceDefinition);
            }
        }

        return defs;
    }

    // -----------------------------
    // NEW: Edge map that includes shared seam variants
    // -----------------------------
    private buildEdgeMapWithVariants(
        totalCols: number,
        totalRows: number,
        rand: () => number
    ): { edgeMap: EdgeSide[][]; edgeVariantsMap: EdgeVariants[][] } {
        const edgeMap: EdgeSide[][] = [];
        const edgeVariantsMap: EdgeVariants[][] = [];

        for (let r = 0; r < totalRows; r++) {
            edgeMap[r] = [];
            edgeVariantsMap[r] = [];

            for (let c = 0; c < totalCols; c++) {
                edgeMap[r][c] = { top: 0, right: 0, bottom: 0, left: 0 };
                edgeVariantsMap[r][c] = {};
            }
        }

        const randSign = (): 1 | -1 => (rand() < 0.5 ? 1 : -1);

        const randSeedU32 = (): number => {
            return (rand() * 0xffffffff) >>> 0;
        };

        const randOffsetN = (): number => {
            // normalized [-1..+1], but clamp to keep away from corners
            const t = (rand() * 2 - 1);
            const limit = 0.65;
            return Math.max(-limit, Math.min(limit, t));
        };

        // Vertical seams (Left/Right): seam between (c,r) and (c+1,r)
        for (let r = 0; r < totalRows; r++) {
            for (let c = 0; c < totalCols - 1; c++) {
                const s = randSign();
                const offsetN = randOffsetN();
                const seed = randSeedU32();

                // signs must oppose
                edgeMap[r][c].right = s;
                edgeMap[r][c + 1].left = -s;

                // shared seam params
                edgeVariantsMap[r][c].right = { offsetN, seed };
                edgeVariantsMap[r][c + 1].left = { offsetN, seed };
            }
        }

        // Horizontal seams (Top/Bottom): seam between (c,r) and (c,r+1)
        for (let r = 0; r < totalRows - 1; r++) {
            for (let c = 0; c < totalCols; c++) {
                const s = randSign();
                const offsetN = randOffsetN();
                const seed = randSeedU32();

                edgeMap[r][c].bottom = s;
                edgeMap[r + 1][c].top = -s;

                edgeVariantsMap[r][c].bottom = { offsetN, seed };
                edgeVariantsMap[r + 1][c].top = { offsetN, seed };
            }
        }

        return { edgeMap, edgeVariantsMap };
    }

    // -----------------------------
    // Helpers
    // -----------------------------
    private mulberry32(seed: number): () => number {
        let t = seed >>> 0;
        return () => {
            t += 0x6d2b79f5;
            let x = Math.imul(t ^ (t >>> 15), 1 | t);
            x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
            return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
        };
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

    private validateEdgeMap(edgeMap: EdgeSide[][], cols: number, rows: number): void {
        let ok = true;

        for (let y = 0; y < rows; y++) {
            for (let x = 0; x < cols; x++) {
                const a = edgeMap[y][x];

                if (x < cols - 1) {
                    const b = edgeMap[y][x + 1];
                    if (a.right !== -b.left) {
                        ok = false;
                        console.warn("EDGE MISMATCH (horizontal)", { x, y, aRight: a.right, bLeft: b.left });
                    }
                }

                if (y < rows - 1) {
                    const b = edgeMap[y + 1][x];
                    if (a.bottom !== -b.top) {
                        ok = false;
                        console.warn("EDGE MISMATCH (vertical)", { x, y, aBottom: a.bottom, bTop: b.top });
                    }
                }

                if (x === 0 && a.left !== 0) { ok = false; console.warn("BORDER not 0", { x, y, side: "left", v: a.left }); }
                if (x === cols - 1 && a.right !== 0) { ok = false; console.warn("BORDER not 0", { x, y, side: "right", v: a.right }); }
                if (y === 0 && a.top !== 0) { ok = false; console.warn("BORDER not 0", { x, y, side: "top", v: a.top }); }
                if (y === rows - 1 && a.bottom !== 0) { ok = false; console.warn("BORDER not 0", { x, y, side: "bottom", v: a.bottom }); }
            }
        }

        if (!ok) {
            throw new Error("EdgeMap validation failed. See warnings above.");
        }
    }
}
