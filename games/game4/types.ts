import * as PIXI from "pixi.js";
import { JigsawCluster } from "./game/jigsaw/JigsawCluster";
import { JigsawPiece } from "./game/jigsaw/JigsawPiece";

export type PieceConnectedEvent =
    {
        movingPiece: JigsawPiece;
        staticPiece: JigsawPiece;

        // Clusters before merge
        fromCluster: JigsawCluster;
        toCluster: JigsawCluster;

        // Cluster after merge (the surviving one)
        mergedCluster: JigsawCluster;
    };

export type PuzzleCompletedEvent =
    {
        finalCluster: JigsawCluster;
        totalPieces: number;
    };

export type EdgeSide =
    {
        top: number;    // 0, +1, -1
        right: number;
        bottom: number;
        left: number;
    };

export type EdgeVariant =
    {
        /** Offset of connector center along the edge, normalized in [-1..+1], where 0 is centered. */
        offsetN: number;

        /** Shared seed for the seam, used for noise / variation. */
        seed: number;
    };
export type PieceEdgeVariants =
    {
        top?: EdgeVariant;
        right?: EdgeVariant;
        bottom?: EdgeVariant;
        left?: EdgeVariant;
    };
export type PieceDefinition =
    {
        id: string;
        col: number;
        row: number;

        // Texture for the piece pixels (usually a sub-texture rect)
        texture: PIXI.Texture;

        // Logical piece dimensions (core grid cell)
        pieceW: number;
        pieceH: number;

        // Padding around the core rect (for tabs that stick out)
        pad: number;

        // Edge definitions (tabs/holes) - generator decides meaning
        edges: EdgeSide;

        edgeVariants: PieceEdgeVariants;


        spriteOffsetX: number;
        spriteOffsetY: number;
    };

export type JigsawBuildOptions =
    {
        cols: number;
        rows: number;

        /**
         * If provided, pieces can be scattered within this rectangle in local board space.
         * If omitted, pieces are laid out in a neat grid.
         */
        scatterRect?: PIXI.Rectangle;

        /**
         * Random seed is optional (v1 uses Math.random).
         * You can add a seeded RNG later without changing the interface.
         */
    };
