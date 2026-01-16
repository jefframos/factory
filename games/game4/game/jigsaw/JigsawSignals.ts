import { Signal } from "signals";
import { JigsawCluster } from "./JigsawCluster";
import { JigsawPiece } from "./JigsawPiece";

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

export class JigsawSignals {
    /** Fired whenever a snap causes a merge between two different clusters. */
    public readonly onPieceConnected: Signal = new Signal();

    /** Fired once when the entire puzzle becomes a single cluster. */
    public readonly onPuzzleCompleted: Signal = new Signal();
}
