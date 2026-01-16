import { JigsawBuildOptions } from "games/game4/types";
import * as PIXI from "pixi.js";
import { Signal } from "signals";
import { IJigsawPuzzleGenerator } from "./IJigsawPuzzleGenerator";
import { JigsawClusterManager } from "./JigsawClusterManager";
import { JigsawInputManager } from "./JigsawInputManager";
import { JigsawPiece } from "./JigsawPiece";
import { JigsawPuzzleFactory } from "./JigsawPuzzleFactory";

export default class JigsawView extends PIXI.Container {
    private piecesLayer: PIXI.Container = new PIXI.Container();
    private pieces: JigsawPiece[] = [];

    private clusterManager: JigsawClusterManager;
    private input?: JigsawInputManager;

    public readonly onPieceConnected: Signal = new Signal();
    public readonly onPuzzleCompleted: Signal = new Signal();


    public constructor() {
        super();
        this.addChild(this.piecesLayer);

        this.clusterManager = new JigsawClusterManager(this.piecesLayer);
    }

    public buildFromSprite(
        stage: PIXI.Container,
        targetSprite: PIXI.Sprite,
        generator: IJigsawPuzzleGenerator,
        options: JigsawBuildOptions
    ): void {
        this.piecesLayer.removeChildren();
        this.pieces = [];

        const built = JigsawPuzzleFactory.build(targetSprite.texture, generator, options);

        this.pieces = built.pieces;

        // Cluster manager needs the solved mapping
        this.clusterManager.registerPieces(this.pieces);

        this.clusterManager.signals.onPieceConnected.add((e) => this.onPieceConnected.dispatch(e));
        this.clusterManager.signals.onPuzzleCompleted.add((e) => this.onPuzzleCompleted.dispatch(e));

        // Create 1-piece clusters (piece positioned at 0,0 inside its cluster)
        const clusters = this.clusterManager.createInitialClusters(this.pieces);

        // Scatter clusters (NOT pieces)
        if (options.scatterRect) {
            for (const c of clusters) {
                c.container.position.set(
                    options.scatterRect.x + Math.random() * options.scatterRect.width,
                    options.scatterRect.y + Math.random() * options.scatterRect.height
                );
            }
        }
        else {
            // Neat solved layout: cluster placed at solved position
            for (const p of this.pieces) {
                p.cluster.container.position.set(p.definition.col * p.definition.pieceW, p.definition.row * p.definition.pieceH);
            }
        }

        // Input manager (drag clusters + snap on release)
        this.input?.destroy();
        this.input = new JigsawInputManager(stage, this.piecesLayer, this.clusterManager);
    }


}
