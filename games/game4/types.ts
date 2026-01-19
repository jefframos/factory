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
        safeRect?: PIXI.Rectangle;
        allowRation?: boolean;
        isFirst?: boolean;

        /**
         * Random seed is optional (v1 uses Math.random).
         * You can add a seeded RNG later without changing the interface.
         */
    };

// types.ts
export type Difficulty = "easy" | "medium" | "hard";

export interface DifficultyProgress {
    completed: boolean;
    bestTimeMs?: number; // store best (lowest) time
    lastTimeMs?: number;
    completedAt?: number; // epoch ms
}

export interface LevelProgress {
    id: string; // unique across all sections
    difficulties: Record<Difficulty, DifficultyProgress>;
}

export interface SectionDefinition {
    id: string;
    name: string;

    // Which level image to use as the section cover (must exist in levels[])
    coverLevelId: string;
    type: number;

    levels: LevelDefinition[];
}

export interface LevelDefinition {
    id: string;
    sectionId: string;

    // Display name like "Puzzle 1" or "Level 1"
    name: string;

    // Texture id / url / asset key (whatever your loader uses)
    thumb?: string;
    imageSrc: string;

    unlockCost?: number;
    unlockSpecial?: number;
    // optional payload sent to game
    payload?: unknown;

    prize: number[],
    prizesSpecial: number[],

    isSpecial: boolean
}

export interface GameProgress {
    version: number;
    levels: Record<string, LevelProgress>; // key = levelId
    unlockedLevels?: Record<string, boolean>;
    coins: number;        // Normal currency
    gems: number;         // Special currency
}

